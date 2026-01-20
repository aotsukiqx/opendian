/**
 * OpenCode SDK Service
 *
 * Main service for interacting with OpenCode via the SDK.
 * Handles client lifecycle, session management, and query execution.
 */

import type { OpencodeQueryOptions, OpencodeStreamChunk, OpencodeServerConfig, OpencodeProvider, OpencodeModel } from './types';
import type {
  SessionCreateData,
  SessionGetData,
  SessionDeleteData,
  SessionPromptData,
  SessionMessagesData,
  SessionAbortData,
  SessionShareData,
  SessionListData,
  ConfigProvidersData,
} from './types';

export type { OpencodeServerConfig, OpencodeProvider, OpencodeModel } from './types';

/**
 * Service for interacting with OpenCode via its SDK.
 */
export class OpencodeService {
  private config: OpencodeServerConfig;
  private client: unknown | null = null;
  private currentSessionId: string | null = null;
  private abortController: AbortController | null = null;
  private cachedProviders: OpencodeProvider[] | null = null;
  private cachedModels: OpencodeModel[] | null = null;

  constructor(config?: Partial<OpencodeServerConfig>) {
    this.config = {
      hostname: config?.hostname ?? '127.0.0.1',
      port: config?.port ?? 4096,
      timeout: config?.timeout ?? 5000,
    };
  }

  /**
   * Initialize the OpenCode client and ensure server is running.
   * No authentication - server runs without password.
   */
  async initialize(): Promise<boolean> {
    try {
      const SDK = await import('@opencode-ai/sdk/client');
      const { createOpencodeClient } = SDK;

      const baseUrl = `http://${this.config.hostname}:${this.config.port}`;

      // Simple client configuration without authentication
      const clientOptions: Record<string, unknown> = {
        baseUrl,
      };

      const client = createOpencodeClient(clientOptions);

      this.client = client;

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if the OpenCode server is healthy.
   */
  async healthCheck(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const client = this.client as { global?: { health?: (options?: object) => Promise<{ data: { healthy: boolean } }> } };
      if (client.global?.health) {
        const health = await client.global.health();
        return health.data.healthy;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
    * Get the current server URL.
    */
  getServerUrl(): string {
    return `http://${this.config.hostname}:${this.config.port}`;
  }

  /**
    * Get available providers from OpenCode server.
    */
  async getProviders(): Promise<OpencodeProvider[]> {
    if (this.cachedProviders) {
      return this.cachedProviders;
    }

    if (!this.client) {
      return [];
    }

    try {
      // SDK /config/providers returns { providers: Provider[], default: {...} }
      const client = this.client as { config?: { providers?: (options?: ConfigProvidersData) => Promise<{ data: { providers: OpencodeProvider[]; default: Record<string, string> } }> } };
      if (!client.config?.providers) {
        return [];
      }

      const result = await client.config.providers();
      this.cachedProviders = result.data.providers;
      return this.cachedProviders;
    } catch {
      return [];
    }
  }

  /**
    * Get available models formatted for UI selector.
    * Format: "providerId:modelId" -> Display name with provider info
    */
  async getModels(): Promise<OpencodeModel[]> {
    if (this.cachedModels) {
      return this.cachedModels;
    }

    const providers = await this.getProviders();
    const models: OpencodeModel[] = [];

    for (const provider of providers) {
      for (const [modelId, model] of Object.entries(provider.models)) {
        // SDK model has capabilities.reasoning, not top-level reasoning
        const modelAny = model as any;
        const reasoning = modelAny.capabilities?.reasoning ?? modelAny.reasoning ?? false;
        
        models.push({
          value: `${provider.id}:${modelId}`,
          label: `${model.name} (${provider.name})`,
          description: `Context: ${model.limit?.context?.toLocaleString() ?? 'Unknown'} tokens${reasoning ? ' • Reasoning' : ''}`,
          provider: provider.id,
          providerName: provider.name,
          modelId,
          reasoning,
          temperature: model.temperature,
          contextLimit: model.limit?.context ?? 200000,
          outputLimit: model.limit?.output ?? 8192,
          cost: model.cost,
        });
      }
    }

    this.cachedModels = models;
    return models;
  }

  /**
    * Clear cached providers/models (call after config changes).
    */
  clearCache(): void {
    this.cachedProviders = null;
    this.cachedModels = null;
  }

  /**
     * Create a new session.
     */
   async createSession(title?: string): Promise<string | null> {
     if (!this.client) {
       console.error('[OpenCode] Client not initialized');
       return null;
     }

      try {
        // Cast client to access session methods
        const sessionClient = (this.client as { session?: { create?: (options: { body?: { title?: string } }) => Promise<{ data: { id: string } }> } }).session;

        if (!sessionClient?.create) {
          console.error('[OpenCode] session.create method not available');
          return null;
        }

        // Call the create function
        const result = await sessionClient.create({
          body: { title: title ?? 'OpenCode Session' },
        });

        this.currentSessionId = result.data.id;
        return result.data.id;
      } catch {
        return null;
      }
    }

    /**
     * Get an existing session by ID.
     */
   async getSession(sessionId: string): Promise<unknown | null> {
     if (!this.client) return null;

     try {
       const client = this.client as { session?: { get?: (options: SessionGetData) => Promise<{ data: unknown }> } };
       if (!client.session?.get) return null;

       const result = await client.session.get({ path: { id: sessionId } });
       return result.data;
     } catch {
       return null;
     }
   }

  /**
   * List all sessions.
   */
  async listSessions(): Promise<unknown[]> {
    if (!this.client) return [];

    try {
      const client = this.client as { session?: { list?: (options?: SessionListData) => Promise<{ data: unknown[] }> } };
      if (!client.session?.list) return [];

      const result = await client.session.list();
      return result.data;
    } catch {
      return [];
    }
  }

  /**
   * Delete a session.
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    if (!this.client) return false;

    try {
      const client = this.client as { session?: { delete?: (options: SessionDeleteData) => Promise<{ data: boolean }> } };
      if (!client.session?.delete) return false;

      const result = await client.session.delete({ path: { id: sessionId } });
      if (result.data && this.currentSessionId === sessionId) {
        this.currentSessionId = null;
      }
      return result.data;
    } catch {
      return false;
    }
  }

  /**
    * Send a query to OpenCode and stream the response.
    */
  async *query(
    prompt: string,
    options?: OpencodeQueryOptions
  ): AsyncGenerator<OpencodeStreamChunk> {
    if (!this.client) {
      yield { type: 'error', content: 'OpenCode client not initialized' };
      return;
    }

    const sessionId = options?.sessionId ?? this.currentSessionId;

    if (!sessionId) {
      yield { type: 'error', content: 'No session ID provided' };
      return;
    }

    const client = this.client as { session?: { prompt?: (options: SessionPromptData) => Promise<{ data: unknown }> } };
    if (!client.session?.prompt) {
      yield { type: 'error', content: 'Session prompt method not available' };
      return;
    }

    this.abortController = new AbortController();

    try {
      // Build parts array with text and images
      type Part = { type: 'text'; text: string } | { type: 'file'; id?: string; mime?: string; filename?: string; data?: string };
      const parts: Part[] = [
        { type: 'text', text: prompt },
      ];

      // Build model object from options
      // Model format: "providerId:modelId" -> { providerID, modelID }
      let modelBody: { providerID: string; modelID: string } | undefined;
      if (options?.model) {
        const [providerID, modelID] = options.model.split(':');
        if (providerID && modelID) {
          modelBody = { providerID, modelID };
        }
      }

      const result = await client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: parts as Array<{ type: 'text'; text: string } | { type: 'file'; id?: string; mime?: string; filename?: string; url: string }>,
          model: modelBody,
          noReply: false,
        },
      });

      // SDK response format: { info: AssistantMessage, parts: Array<Part> }
      const response = result.data as { info?: Record<string, unknown>; parts?: Array<Record<string, unknown>> };

      // Extract text from parts
      // Parts order: step-start, reasoning, text, step-finish
      // reasoning parts should be rendered as thinking (collapsible)
      // text parts are the final response

      if (Array.isArray(response.parts) && response.parts.length > 0) {
        for (let i = 0; i < response.parts.length; i++) {
          const part = response.parts[i];
          const partType = part.type as string;
          const partText = part.text as string | undefined;

          if (partType === 'reasoning' && partText) {
            // Yield thinking content
            yield {
              type: 'thinking',
              content: partText,
            };
          } else if (partType === 'text' && partText) {
            yield { type: 'text', content: partText };
          }
        }
      }

      yield { type: 'done' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      yield { type: 'error', content: msg };
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Get messages from a session.
   */
  async getMessages(sessionId: string): Promise<unknown[]> {
    if (!this.client) return [];

    try {
      const client = this.client as { session?: { messages?: (options: SessionMessagesData) => Promise<{ data: unknown[] }> } };
      if (!client.session?.messages) return [];

      const result = await client.session.messages({ path: { id: sessionId } });
      return result.data;
    } catch {
      return [];
    }
  }

  /**
   * Share a session.
   */
  async shareSession(sessionId: string): Promise<string | null> {
    if (!this.client) return null;

    try {
      const client = this.client as { session?: { share?: (options: SessionShareData) => Promise<{ data: { id: string } }> } };
      if (!client.session?.share) return null;

      const result = await client.session.share({ path: { id: sessionId } });
      return result.data.id;
    } catch {
      return null;
    }
  }

  /**
   * Abort the current query.
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
    }

    if (this.currentSessionId && this.client) {
      const client = this.client as { session?: { abort?: (options: SessionAbortData) => Promise<{ data: boolean }> } };
      if (client.session?.abort) {
        client.session.abort({ path: { id: this.currentSessionId } }).catch(() => {
          // Ignore abort errors
        });
      }
    }
  }

  /**
   * Set the current session ID.
   */
  setSessionId(id: string | null): void {
    this.currentSessionId = id;
  }

  /**
   * Get the current session ID.
   */
  getSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Clean up resources.
   */
  cleanup(): void {
    this.abort();
    this.client = null;
    this.currentSessionId = null;
  }
}
