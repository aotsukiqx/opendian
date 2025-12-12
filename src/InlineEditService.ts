/**
 * Claudian - Inline edit service
 *
 * Lightweight Claude query service for inline text editing.
 * Uses read-only tools only and supports multi-turn clarification.
 */

import { query, type Options, type HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk';
import type ClaudianPlugin from './main';
import { THINKING_BUDGETS } from './types';
import { getVaultPath, parseEnvironmentVariables, findClaudeCLIPath, isPathWithinVault as isPathWithinVaultUtil } from './utils';
import { getInlineEditSystemPrompt } from './systemPrompt';

export type InlineEditMode = 'selection' | 'cursor';

export interface CursorContext {
  beforeCursor: string;
  afterCursor: string;
  isInbetween: boolean;
  line: number;
  column: number;
}

export interface InlineEditSelectionRequest {
  mode: 'selection';
  instruction: string;
  notePath: string;
  selectedText: string;
}

export interface InlineEditCursorRequest {
  mode: 'cursor';
  instruction: string;
  notePath: string;
  cursorContext: CursorContext;
}

export type InlineEditRequest = InlineEditSelectionRequest | InlineEditCursorRequest;

export interface InlineEditResult {
  success: boolean;
  editedText?: string;      // replacement (selection mode)
  insertedText?: string;    // insertion (cursor mode)
  clarification?: string;
  error?: string;
}

const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch'] as const;

/** Helper to find nearest non-empty line in a direction. */
function findNearestNonEmptyLine(
  getLine: (line: number) => string,
  lineCount: number,
  startLine: number,
  direction: 'before' | 'after'
): string {
  const step = direction === 'before' ? -1 : 1;
  for (let i = startLine + step; i >= 0 && i < lineCount; i += step) {
    const content = getLine(i);
    if (content.trim().length > 0) {
      return content;
    }
  }
  return '';
}

/**
 * Builds cursor context for inline edit cursor mode.
 * @param getLine Function to get line content by index (0-indexed)
 * @param lineCount Total number of lines in document
 * @param line Cursor line (0-indexed)
 * @param column Cursor column
 */
export function buildCursorContext(
  getLine: (line: number) => string,
  lineCount: number,
  line: number,
  column: number
): CursorContext {
  const lineContent = getLine(line);
  const beforeCursor = lineContent.substring(0, column);
  const afterCursor = lineContent.substring(column);

  const lineIsEmpty = lineContent.trim().length === 0;
  const nothingBefore = beforeCursor.trim().length === 0;
  const nothingAfter = afterCursor.trim().length === 0;
  const isInbetween = lineIsEmpty || (nothingBefore && nothingAfter);

  let contextBefore = beforeCursor;
  let contextAfter = afterCursor;

  if (isInbetween) {
    // Find nearest non-empty line before cursor
    contextBefore = findNearestNonEmptyLine(getLine, lineCount, line, 'before');
    // Find nearest non-empty line after cursor
    contextAfter = findNearestNonEmptyLine(getLine, lineCount, line, 'after');
  }

  return { beforeCursor: contextBefore, afterCursor: contextAfter, isInbetween, line, column };
}

/** Service for inline text editing with Claude using read-only tools. */
export class InlineEditService {
  private plugin: ClaudianPlugin;
  private abortController: AbortController | null = null;
  private resolvedClaudePath: string | null = null;
  private sessionId: string | null = null;

  constructor(plugin: ClaudianPlugin) {
    this.plugin = plugin;
  }

  /** Resets conversation state for a new edit session. */
  resetConversation(): void {
    this.sessionId = null;
  }

  private findClaudeCLI(): string | null {
    return findClaudeCLIPath();
  }

  /** Edits text according to instructions (initial request). */
  async editText(request: InlineEditRequest): Promise<InlineEditResult> {
    this.sessionId = null;
    const prompt = this.buildPrompt(request);
    return this.sendMessage(prompt);
  }

  /** Continues conversation with a follow-up message. */
  async continueConversation(message: string): Promise<InlineEditResult> {
    if (!this.sessionId) {
      return { success: false, error: 'No active conversation to continue' };
    }
    return this.sendMessage(message);
  }

  private async sendMessage(prompt: string): Promise<InlineEditResult> {
    const vaultPath = getVaultPath(this.plugin.app);
    if (!vaultPath) {
      return { success: false, error: 'Could not determine vault path' };
    }

    if (!this.resolvedClaudePath) {
      this.resolvedClaudePath = this.findClaudeCLI();
    }

    if (!this.resolvedClaudePath) {
      return { success: false, error: 'Claude CLI not found. Please install Claude Code CLI.' };
    }

    this.abortController = new AbortController();

    // Parse custom environment variables
    const customEnv = parseEnvironmentVariables(this.plugin.getActiveEnvironmentVariables());

    const options: Options = {
      cwd: vaultPath,
      systemPrompt: getInlineEditSystemPrompt(),
      model: this.plugin.settings.model,
      abortController: this.abortController,
      pathToClaudeCodeExecutable: this.resolvedClaudePath,
      env: {
        ...process.env,
        ...customEnv,
      },
      allowedTools: [...READ_ONLY_TOOLS],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      hooks: {
        PreToolUse: [
          this.createReadOnlyHook(),
          this.createVaultRestrictionHook(vaultPath),
        ],
      },
    };

    if (this.sessionId) {
      options.resume = this.sessionId;
    }

    const budgetSetting = this.plugin.settings.thinkingBudget;
    const budgetConfig = THINKING_BUDGETS.find(b => b.value === budgetSetting);
    if (budgetConfig && budgetConfig.tokens > 0) {
      options.maxThinkingTokens = budgetConfig.tokens;
    }

    try {
      const response = query({ prompt, options });
      let responseText = '';

      for await (const message of response) {
        if (this.abortController?.signal.aborted) {
          await response.interrupt();
          return { success: false, error: 'Cancelled' };
        }

        if (message.type === 'system' && message.subtype === 'init' && message.session_id) {
          this.sessionId = message.session_id;
        }

        const text = this.extractTextFromMessage(message);
        if (text) {
          responseText += text;
        }
      }

      return this.parseResponse(responseText);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: msg };
    } finally {
      this.abortController = null;
    }
  }

  /** Parses response text for <replacement> or <insertion> tag. */
  private parseResponse(responseText: string): InlineEditResult {
    const replacementMatch = responseText.match(/<replacement>([\s\S]*?)<\/replacement>/);
    if (replacementMatch) {
      return { success: true, editedText: replacementMatch[1] };
    }

    const insertionMatch = responseText.match(/<insertion>([\s\S]*?)<\/insertion>/);
    if (insertionMatch) {
      return { success: true, insertedText: insertionMatch[1] };
    }

    const trimmed = responseText.trim();
    if (trimmed) {
      return { success: true, clarification: trimmed };
    }

    return { success: false, error: 'Empty response' };
  }

  private buildPrompt(request: InlineEditRequest): string {
    if (request.mode === 'cursor') {
      return this.buildCursorPrompt(request);
    }
    // Selection mode
    return [
      `File: ${request.notePath}`,
      '',
      '---',
      request.selectedText,
      '---',
      '',
      `Request: ${request.instruction}`,
    ].join('\n');
  }

  private buildCursorPrompt(request: InlineEditCursorRequest): string {
    const ctx = request.cursorContext;

    if (ctx.isInbetween) {
      // For #inbetween, include surrounding context lines
      const parts = [`File: ${request.notePath}`, '', '---'];
      if (ctx.beforeCursor) parts.push(ctx.beforeCursor);
      parts.push('| #inbetween');
      if (ctx.afterCursor) parts.push(ctx.afterCursor);
      parts.push('---', '', `Request: ${request.instruction}`);
      return parts.join('\n');
    }

    // For #inline, show the cursor position within the line
    return [
      `File: ${request.notePath}`,
      '', '---',
      `${ctx.beforeCursor}|${ctx.afterCursor} #inline`,
      '---', '',
      `Request: ${request.instruction}`,
    ].join('\n');
  }

  /** Creates PreToolUse hook to enforce read-only mode. */
  private createReadOnlyHook(): HookCallbackMatcher {
    return {
      hooks: [
        async (hookInput) => {
          const input = hookInput as {
            tool_name: string;
            tool_input: Record<string, unknown>;
          };
          const toolName = input.tool_name;

          if (READ_ONLY_TOOLS.includes(toolName as typeof READ_ONLY_TOOLS[number])) {
            return { continue: true };
          }

          return {
            continue: false,
            hookSpecificOutput: {
              hookEventName: 'PreToolUse' as const,
              permissionDecision: 'deny' as const,
              permissionDecisionReason: `Inline edit mode: tool "${toolName}" is not allowed (read-only)`,
            },
          };
        },
      ],
    };
  }

  /** Creates PreToolUse hook to restrict file tools to the vault. */
  private createVaultRestrictionHook(vaultPath: string): HookCallbackMatcher {
    const fileTools = ['Read', 'Glob', 'Grep', 'LS'];

    return {
      hooks: [
        async (hookInput) => {
          const input = hookInput as {
            tool_name: string;
            tool_input: Record<string, unknown>;
          };

          const toolName = input.tool_name;
          if (!fileTools.includes(toolName)) {
            return { continue: true };
          }

          const filePath = this.getPathFromToolInput(toolName, input.tool_input);
          if (filePath && !isPathWithinVaultUtil(filePath, vaultPath)) {
            return {
              continue: false,
              hookSpecificOutput: {
                hookEventName: 'PreToolUse' as const,
                permissionDecision: 'deny' as const,
                permissionDecisionReason: `Access denied: Path "${filePath}" is outside the vault. Inline edit is restricted to vault directory only.`,
              },
            };
          }

          return { continue: true };
        },
      ],
    };
  }

  private getPathFromToolInput(toolName: string, toolInput: Record<string, unknown>): string | null {
    switch (toolName) {
      case 'Read':
        return (toolInput.file_path as string) || null;
      case 'Glob':
      case 'Grep':
        return (toolInput.path as string) || (toolInput.pattern as string) || null;
      case 'LS':
        return (toolInput.path as string) || null;
      default:
        return null;
    }
  }

  private extractTextFromMessage(message: any): string | null {
    if (message.type === 'assistant' && message.message?.content) {
      for (const block of message.message.content) {
        if (block.type === 'text' && block.text) {
          return block.text;
        }
      }
    }

    if (message.type === 'stream_event') {
      const event = message.event;
      if (event?.type === 'content_block_start' && event.content_block?.type === 'text') {
        return event.content_block.text || null;
      }
      if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        return event.delta.text || null;
      }
    }

    return null;
  }

  /** Cancels the current edit operation. */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }
}
