/**
 * OpenCode Service Wrapper
 *
 * Adapts OpenCode SDK to the IAgentService interface.
 */

import type { ChatMessage, ImageAttachment, StreamChunk } from '../types';
import type { OpencodeService } from './OpencodeService';
import type { OpencodeServerConfig } from './types';
import { AgentApprovalCallback, AgentQueryOptions, type IAgentService, type ProviderInfo, type ModelSelectorItem } from '../agent/IAgentService';

/**
 * Wrapper that adapts OpenCode SDK to IAgentService interface.
 */
export class OpencodeServiceWrapper implements IAgentService {
  private opencodeService: OpencodeService;
  private approvalCallback: AgentApprovalCallback | null = null;
  private currentSessionId: string | null = null;
  private vaultPath: string | null = null;

  constructor(opencodeService: OpencodeService) {
    this.opencodeService = opencodeService;
  }

  /** Get the backend type */
  getBackendType(): 'opencode' {
    return 'opencode';
  }

  /**
   * Initialize the service.
   */
  async initialize(): Promise<boolean> {
    return this.opencodeService.initialize();
  }

  /**
   * Check if the service is ready.
   */
  async healthCheck(): Promise<boolean> {
    return this.opencodeService.healthCheck();
  }

  /**
   * Set the approval callback for permission prompts.
   */
  setApprovalCallback(callback: AgentApprovalCallback | null): void {
    this.approvalCallback = callback;
  }

  /**
   * Set the current vault path.
   */
  setVaultPath(path: string): void {
    this.vaultPath = path;
  }

   /**
     * Create a new session.
     */
    async createSession(title?: string): Promise<string | null> {
      const sessionId = await this.opencodeService.createSession(title);

      if (sessionId) {
        this.currentSessionId = sessionId;
        this.opencodeService.setSessionId(sessionId);
      }
      return sessionId;
    }

  /**
   * Get the current session ID.
   */
  getSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Set the session ID.
   */
  setSessionId(id: string | null): void {
    this.currentSessionId = id;
    this.opencodeService.setSessionId(id);
  }

  /**
   * Query OpenCode and stream the response.
   */
  async *query(
    prompt: string,
    images?: ImageAttachment[],
    _conversationHistory?: ChatMessage[],
    queryOptions?: AgentQueryOptions
  ): AsyncGenerator<StreamChunk> {
    if (!this.currentSessionId) {
      const sessionId = await this.createSession();
      if (!sessionId) {
        yield { type: 'error', content: 'Failed to create OpenCode session' };
        return;
      }
    }

    try {
      for await (const chunk of this.opencodeService.query(prompt, {
        sessionId: this.currentSessionId ?? undefined,
        model: queryOptions?.model,
        images,
      })) {
        yield this.convertChunk(chunk);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      yield { type: 'error', content: msg };
    }
  }

  /**
   * Convert OpenCode stream chunk to internal format.
   */
  private convertChunk(chunk: { type: string; content?: string; metadata?: Record<string, unknown>; id?: string; name?: string; input?: Record<string, unknown>; result?: string; usage?: { inputTokens: number; outputTokens: number }; sessionId?: string; error?: string }): StreamChunk {
    switch (chunk.type) {
      case 'text':
        return { type: 'text', content: chunk.content ?? '' };

      case 'thinking':
      case 'reasoning':
        // Render reasoning as thinking (collapsible)
        return { type: 'thinking', content: chunk.content ?? '' };

      case 'tool_use':
        return {
          type: 'tool_use',
          id: chunk.id ?? '',
          name: chunk.name ?? 'unknown',
          input: chunk.input ?? {},
        };

      case 'tool_result':
        return {
          type: 'tool_result',
          id: chunk.id ?? '',
          content: chunk.result ?? '',
          isError: false,
        };

      case 'error':
        return { type: 'error', content: chunk.error ?? 'Unknown error' };

      case 'usage':
        return {
          type: 'usage',
          usage: {
            model: undefined,
            inputTokens: chunk.usage?.inputTokens ?? 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            contextWindow: 0,
            contextTokens: 0,
            percentage: 0,
          },
        };

      case 'session':
        return { type: 'text', content: `[Session: ${chunk.sessionId}]` };

      case 'done':
        return { type: 'done' };

      default:
        return { type: 'text', content: '' };
    }
  }

  /**
   * Abort the current query.
   */
  abort(): void {
    this.opencodeService.abort();
  }

  /**
   * Reset the session.
   */
  resetSession(): void {
    this.currentSessionId = null;
    this.opencodeService.setSessionId(null);
  }

  /**
   * Get available providers with models.
   */
  async getProviders(): Promise<{ providers: ProviderInfo[]; default: Record<string, string> }> {
    try {
      const providers = await this.opencodeService.getProviders();
      const providerInfos: ProviderInfo[] = providers.map(p => ({
        id: p.id,
        name: p.name,
        api: p.api,
        env: p.env,
        models: {},
        npm: p.npm,
      }));

      // Get defaults by calling providers again (the API returns defaults in the response)
      // For now, return empty defaults - the UI can use the first model of each provider
      return {
        providers: providerInfos,
        default: {},
      };
    } catch {
      return { providers: [], default: {} };
    }
  }

  /**
   * Get available models formatted for UI selector.
   */
  async getModels(): Promise<ModelSelectorItem[]> {
    try {
      const models = await this.opencodeService.getModels();
      return models.map(m => ({
        value: m.value,
        label: m.label,
        description: m.description,
        provider: m.provider,
        modelId: m.modelId,
        reasoning: m.reasoning,
        temperature: m.temperature,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get messages from a session.
   */
  async getMessages(sessionId: string): Promise<unknown[]> {
    return this.opencodeService.getMessages(sessionId);
  }

  /**
   * List all sessions.
   */
  async listSessions(): Promise<unknown[]> {
    return this.opencodeService.listSessions();
  }

  /**
   * Delete a session.
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const result = await this.opencodeService.deleteSession(sessionId);
    if (result && this.currentSessionId === sessionId) {
      this.currentSessionId = null;
    }
    return result;
  }

  /**
   * Get the server URL.
   */
  getServerUrl(): string | null {
    return this.opencodeService.getServerUrl();
  }

  /**
   * Clean up resources.
   */
  cleanup(): void {
    this.opencodeService.cleanup();
    this.currentSessionId = null;
    this.approvalCallback = null;
  }

  // ============================================
  // Claude Code-specific methods (no-ops for OpenCode)
  // ============================================

  /** Cancel the current streaming query */
  cancel(): void {
    this.abort();
  }

  /** Consume session invalidation (marks the invalidation as handled) */
  consumeSessionInvalidation(): void {
    // OpenCode doesn't have session invalidation concept
  }

  /** Load Claude Code permissions (Claude Code only) */
  async loadCCPermissions(): Promise<void> {
    // No-op for OpenCode
  }

  /** Pre-warm the SDK with external context paths */
  async preWarm(_externalContextPaths?: string[], _persistentExternalContextPaths?: string[]): Promise<void> {
    // OpenCode doesn't need pre-warming
  }

  /** Close the persistent query */
  closePersistentQuery(_reason: string): void {
    this.resetSession();
  }

  /** Reload MCP servers configuration */
  async reloadMcpServers(): Promise<void> {
    // MCP is handled separately in Claudian, not through the agent service
  }

  /** Restart the persistent query (used after settings changes) */
  async restartPersistentQuery(): Promise<void> {
    // No persistent query concept in OpenCode
  }
}
