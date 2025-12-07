import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import type ClaudianPlugin from './main';
import { StreamChunk, ChatMessage, ToolCallInfo, SDKMessage, THINKING_BUDGETS } from './types';
import { SYSTEM_PROMPT } from './systemPrompt';
import { getVaultPath } from './utils';

export class ClaudianService {
  private plugin: ClaudianPlugin;
  private abortController: AbortController | null = null;
  private sessionId: string | null = null;
  private resolvedClaudePath: string | null = null;

  constructor(plugin: ClaudianPlugin) {
    this.plugin = plugin;
  }

  /**
   * Find the claude CLI binary by checking common installation locations
   */
  private findClaudeCLI(): string | null {
    // Common installation locations
    const homeDir = os.homedir();
    const commonPaths = [
      path.join(homeDir, '.claude', 'local', 'claude'),
      path.join(homeDir, '.local', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      path.join(homeDir, 'bin', 'claude'),
    ];

    for (const p of commonPaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return null;
  }

  /**
   * Send a query to Claude and stream the response
   * @param prompt The user's message
   * @param conversationHistory Optional message history for session expiration recovery
   */
  async *query(prompt: string, conversationHistory?: ChatMessage[]): AsyncGenerator<StreamChunk> {
    // Get vault path
    const vaultPath = getVaultPath(this.plugin.app);
    if (!vaultPath) {
      yield { type: 'error', content: 'Could not determine vault path' };
      return;
    }

    // Find claude CLI - cache the result
    if (!this.resolvedClaudePath) {
      this.resolvedClaudePath = this.findClaudeCLI();
    }

    if (!this.resolvedClaudePath) {
      yield { type: 'error', content: 'Claude CLI not found. Please install Claude Code CLI.' };
      return;
    }

    // Create abort controller for cancellation
    this.abortController = new AbortController();

    try {
      yield* this.queryViaSDK(prompt, vaultPath);
    } catch (error) {
      // Handle session expiration - rebuild context and retry
      if (this.isSessionExpiredError(error) && conversationHistory && conversationHistory.length > 0) {
        this.sessionId = null;

        // Rebuild context from history
        const historyContext = this.buildContextFromHistory(conversationHistory);
        const lastUserMessage = this.getLastUserMessage(conversationHistory);
        // Strip context prefix before comparison to avoid false mismatch
        // (prompt may have "Context files: [...]\n\n" prefix, but stored content doesn't)
        const actualPrompt = prompt.replace(/^Context files: \[.*?\]\n\n/, '');
        const shouldAppendPrompt = !lastUserMessage || lastUserMessage.content.trim() !== actualPrompt.trim();
        const fullPrompt = historyContext
          ? shouldAppendPrompt
            ? `${historyContext}\n\nUser: ${prompt}`
            : historyContext
          : prompt;

        // Retry without resume
        try {
          yield* this.queryViaSDK(fullPrompt, vaultPath);
        } catch (retryError) {
          const msg = retryError instanceof Error ? retryError.message : 'Unknown error';
          yield { type: 'error', content: msg };
        }
        return;
      }

      const msg = error instanceof Error ? error.message : 'Unknown error';
      yield { type: 'error', content: msg };
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Build conversation context from message history
   */
  private buildContextFromHistory(messages: ChatMessage[]): string {
    const parts: string[] = [];

    for (const message of messages) {
      if (message.role !== 'user' && message.role !== 'assistant') {
        continue;
      }

      if (message.role === 'assistant') {
        const hasContent = message.content && message.content.trim().length > 0;
        const hasToolResult = message.toolCalls?.some(tc => tc.result && tc.result.trim().length > 0);
        if (!hasContent && !hasToolResult) {
          continue;
        }
      }

      const role = message.role === 'user' ? 'User' : 'Assistant';
      const lines: string[] = [];
      const content = message.content?.trim();
      const contextLine = this.formatContextLine(message);
      const userPayload = contextLine
        ? content
          ? `${contextLine}\n\n${content}`
          : contextLine
        : content;
      lines.push(userPayload ? `${role}: ${userPayload}` : `${role}:`);

      if (message.role === 'assistant' && message.toolCalls?.length) {
        const toolLines = message.toolCalls
          .map(tc => this.formatToolCallForContext(tc))
          .filter(Boolean) as string[];
        if (toolLines.length > 0) {
          lines.push(...toolLines);
        }
      }

      parts.push(lines.join('\n'));
    }

    return parts.join('\n\n');
  }

  /**
   * Check if an error is a session expiration error
   * Only matches session-specific errors, not general "not found" or "invalid" errors
   */
  private isSessionExpiredError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message.toLowerCase() : '';
    return msg.includes('session expired') ||
           msg.includes('session not found') ||
           msg.includes('invalid session') ||
           msg.includes('session invalid') ||
           (msg.includes('session') && msg.includes('expired')) ||
           (msg.includes('resume') && (msg.includes('failed') || msg.includes('error')));
  }

  /**
   * Get the last user message in a conversation history
   */
  private getLastUserMessage(messages: ChatMessage[]): ChatMessage | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return messages[i];
      }
    }
    return undefined;
  }

  /**
   * Format a tool call line for inclusion in recovery context
   */
  private formatToolCallForContext(toolCall: ToolCallInfo): string {
    const status = toolCall.status ?? 'completed';
    const base = `[Tool ${toolCall.name} status=${status}]`;
    const hasResult = typeof toolCall.result === 'string' && toolCall.result.trim().length > 0;

    if (!hasResult) {
      return base;
    }

    const result = this.truncateToolResultForContext(toolCall.result as string);
    return `${base} result: ${result}`;
  }

  /**
   * Truncate tool result to avoid overloading recovery prompt
   */
  private truncateToolResultForContext(result: string, maxLength = 800): string {
    if (result.length > maxLength) {
      return `${result.slice(0, maxLength)}... (truncated)`;
    }
    return result;
  }

  /**
   * Format a context line for user messages when rebuilding history
   */
  private formatContextLine(message: ChatMessage): string | null {
    if (!message.contextFiles) {
      return null;
    }
    const fileList = message.contextFiles.join(', ');
    return `Context files: [${fileList}]`;
  }

  private async *queryViaSDK(prompt: string, cwd: string): AsyncGenerator<StreamChunk> {
    const selectedModel = this.plugin.settings.model;

    const options: Options = {
      cwd,
      systemPrompt: SYSTEM_PROMPT,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      model: selectedModel,
      abortController: this.abortController ?? undefined,
      pathToClaudeCodeExecutable: this.resolvedClaudePath!,
    };

    // Enable extended thinking based on thinking budget setting
    const budgetSetting = this.plugin.settings.thinkingBudget;
    const budgetConfig = THINKING_BUDGETS.find(b => b.value === budgetSetting);
    if (budgetConfig && budgetConfig.tokens > 0) {
      options.maxThinkingTokens = budgetConfig.tokens;
    }

    // Resume previous session if we have a session ID
    if (this.sessionId) {
      options.resume = this.sessionId;
    }

    try {
      const response = query({ prompt, options });

      for await (const message of response) {
        // Check for cancellation
        if (this.abortController?.signal.aborted) {
          await response.interrupt();
          break;
        }

        // transformSDKMessage now yields multiple chunks
        for (const chunk of this.transformSDKMessage(message)) {
          // Check blocklist for bash commands
          if (chunk.type === 'tool_use' && chunk.name === 'Bash') {
            const command = chunk.input?.command as string || '';
            if (this.shouldBlockCommand(command)) {
              yield { type: 'blocked', content: `Blocked command: ${command}` };
              continue;
            }
          }
          yield chunk;
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      yield { type: 'error', content: msg };
    }

    yield { type: 'done' };
  }

  /**
   * Transform SDK message to our StreamChunk format
   * Returns an array since one SDK message can contain multiple chunks
   * (e.g., assistant message with both text and tool_use blocks)
   *
   * SDK Message Types:
   * - 'system' - init, status, etc.
   * - 'assistant' - assistant response with content blocks (text, tool_use)
   * - 'user' - user messages, includes tool_use_result for tool outputs
   * - 'stream_event' - streaming deltas
   * - 'result' - final result
   */
  private *transformSDKMessage(message: SDKMessage): Generator<StreamChunk> {
    switch (message.type) {
      case 'system':
        // Capture session ID from init message
        if (message.subtype === 'init' && message.session_id) {
          this.sessionId = message.session_id;
        }
        // Don't yield system messages to the UI
        break;

      case 'assistant':
        // Extract ALL content blocks - text, tool_use, and thinking
        if (message.message?.content && Array.isArray(message.message.content)) {
          for (const block of message.message.content) {
            if (block.type === 'thinking' && block.thinking) {
              yield { type: 'thinking', content: block.thinking };
            } else if (block.type === 'text' && block.text) {
              yield { type: 'text', content: block.text };
            } else if (block.type === 'tool_use') {
              yield {
                type: 'tool_use',
                id: block.id || `tool-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
                name: block.name || 'unknown',
                input: block.input || {},
              };
            }
          }
        }
        break;

      case 'user':
        // User messages can contain tool results
        if (message.tool_use_result !== undefined && message.parent_tool_use_id) {
          yield {
            type: 'tool_result',
            id: message.parent_tool_use_id,
            content: typeof message.tool_use_result === 'string'
              ? message.tool_use_result
              : JSON.stringify(message.tool_use_result, null, 2),
            isError: false,
          };
        }
        // Also check message.message.content for tool_result blocks
        if (message.message?.content && Array.isArray(message.message.content)) {
          for (const block of message.message.content) {
            if (block.type === 'tool_result') {
              yield {
                type: 'tool_result',
                id: block.tool_use_id || message.parent_tool_use_id || '',
                content: typeof block.content === 'string'
                  ? block.content
                  : JSON.stringify(block.content, null, 2),
                isError: block.is_error || false,
              };
            }
          }
        }
        break;

      case 'stream_event':
        // Handle streaming events for real-time updates
        const event = message.event;
        if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          yield {
            type: 'tool_use',
            id: event.content_block.id || `tool-${Date.now()}`,
            name: event.content_block.name || 'unknown',
            input: event.content_block.input || {},
          };
        } else if (event?.type === 'content_block_start' && event.content_block?.type === 'thinking') {
          if (event.content_block.thinking) {
            yield { type: 'thinking', content: event.content_block.thinking };
          }
        } else if (event?.type === 'content_block_start' && event.content_block?.type === 'text') {
          if (event.content_block.text) {
            yield { type: 'text', content: event.content_block.text };
          }
        } else if (event?.type === 'content_block_delta') {
          if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
            yield { type: 'thinking', content: event.delta.thinking };
          } else if (event.delta?.type === 'text_delta' && event.delta.text) {
            yield { type: 'text', content: event.delta.text };
          }
        }
        break;

      case 'result':
        // Final result - no text to extract, result is a string summary
        break;

      case 'error':
        if (message.error) {
          yield { type: 'error', content: message.error };
        }
        break;
    }
  }

  /**
   * Check if a bash command should be blocked
   */
  private shouldBlockCommand(command: string): boolean {
    if (!this.plugin.settings.enableBlocklist) {
      return false;
    }

    return this.plugin.settings.blockedCommands.some(pattern => {
      try {
        return new RegExp(pattern, 'i').test(command);
      } catch {
        // Invalid regex, try simple includes
        return command.toLowerCase().includes(pattern.toLowerCase());
      }
    });
  }

  /**
   * Cancel the current query
   */
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Reset the conversation session
   * Call this when clearing the chat to start fresh
   */
  resetSession() {
    this.sessionId = null;
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Set the session ID (for restoring from saved conversation)
   */
  setSessionId(id: string | null): void {
    this.sessionId = id;
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.cancel();
    this.resetSession();
  }
}
