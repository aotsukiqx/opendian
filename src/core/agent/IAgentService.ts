/**
 * Agent Service Interface
 *
 * Unified interface for agent backends (Claude Code, OpenCode).
 * Allows switching between backends while maintaining the same API.
 */

import type { ChatMessage, ImageAttachment, StreamChunk } from '../types';

/**
 * Query options for agent services.
 */
export interface AgentQueryOptions {
  allowedTools?: string[];
  model?: string;
  mcpMentions?: Set<string>;
  enabledMcpServers?: Set<string>;
  forceColdStart?: boolean;
  externalContextPaths?: string[];
}

/**
 * Approval callback for permission prompts.
 */
export type AgentApprovalCallback = (
  toolName: string,
  input: Record<string, unknown>,
  description: string
) => Promise<'allow' | 'allow-always' | 'deny' | 'deny-always' | 'cancel'>;

/**
 * Unified agent backend type.
 */
export type AgentBackend = 'claude-code' | 'opencode';

/**
 * Backend configuration.
 */
export interface AgentBackendConfig {
  backend: AgentBackend;
  opencode?: {
    hostname?: string;
    port?: number;
    timeout?: number;
  };
  claudeCode?: {
    cliPath?: string;
  };
}

/**
 * Model information from provider.
 */
export interface ProviderModelInfo {
  id: string;
  name: string;
  releaseDate: string;
  attachment: boolean;
  reasoning: boolean;
  temperature: boolean;
  toolCall: boolean;
  contextLimit: number;
  outputLimit: number;
  cost?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  modalities?: {
    input: string[];
    output: string[];
  };
  experimental?: boolean;
  status?: 'alpha' | 'beta' | 'deprecated';
}

/**
 * Provider information.
 */
export interface ProviderInfo {
  id: string;
  name: string;
  api?: string;
  env: string[];
  models: Record<string, ProviderModelInfo>;
  npm?: string;
}

/**
 * Unified model selector item.
 */
export interface ModelSelectorItem {
  value: string;        // Format: "providerId:modelId"
  label: string;        // Display name (e.g., "Claude Sonnet 4")
  description: string;  // Model description or cost info
  provider: string;     // Provider ID
  modelId: string;      // Model ID within provider
  reasoning: boolean;   // Supports reasoning/thinking
  temperature: boolean; // Supports temperature setting
}

/**
 * Backend configuration.
 */
export interface AgentBackendConfig {
  backend: AgentBackend;
  opencode?: {
    hostname?: string;
    port?: number;
    timeout?: number;
  };
  claudeCode?: {
    cliPath?: string;
  };
}

/**
 * Unified interface for agent services.
 * Implement this to add new backends.
 */
export interface IAgentService {
  /** Get the backend type */
  getBackendType(): AgentBackend;

  /** Initialize the service */
  initialize(): Promise<boolean>;

  /** Health check */
  healthCheck(): Promise<boolean>;

  /** Set the approval callback */
  setApprovalCallback(callback: AgentApprovalCallback | null): void;

  /** Set the vault path */
  setVaultPath(path: string): void;

  /** Create a new session */
  createSession(title?: string): Promise<string | null>;

  /** Get the current session ID */
  getSessionId(): string | null;

  /** Set the session ID */
  setSessionId(id: string | null): void;

  /** Query the agent and stream response */
  query(
    prompt: string,
    images?: ImageAttachment[],
    conversationHistory?: ChatMessage[],
    queryOptions?: AgentQueryOptions
  ): AsyncGenerator<StreamChunk>;

  /** Cancel the current streaming query */
  cancel(): void;

  /** Consume session invalidation (marks the invalidation as handled) */
  consumeSessionInvalidation(): void;

  /** Load Claude Code permissions (Claude Code only) */
  loadCCPermissions(): Promise<void>;

  /** Pre-warm the SDK with external context paths */
  preWarm(externalContextPaths?: string[], persistentExternalContextPaths?: string[]): Promise<void>;

  /** Close the persistent query */
  closePersistentQuery(reason: string): void;

  /** Reload MCP servers configuration */
  reloadMcpServers(): Promise<void>;

  /** Restart the persistent query (used after settings changes) */
  restartPersistentQuery(): Promise<void>;

  /** Abort the current query */
  abort(): void;

  /** Reset the session */
  resetSession(): void;

  /** Get available providers with models (for model selector) */
  getProviders(): Promise<{ providers: ProviderInfo[]; default: Record<string, string> }>;

  /** Get available models formatted for UI selector */
  getModels(): Promise<ModelSelectorItem[]>;

  /** Get messages from a session */
  getMessages(sessionId: string): Promise<unknown[]>;

  /** List all sessions */
  listSessions(): Promise<unknown[]>;

  /** Delete a session */
  deleteSession(sessionId: string): Promise<boolean>;

  /** Get server URL (if applicable) */
  getServerUrl(): string | null;

  /** Clean up resources */
  cleanup(): void;
}

/**
 * Factory for creating agent services.
 */
export class AgentServiceFactory {
  private static service: IAgentService | null = null;

  /**
   * Create an agent service based on backend type.
   */
  static create(config: AgentBackendConfig): IAgentService {
    if (config.backend === 'opencode') {
      // Lazy import to avoid issues during build
      const { OpencodeService, OpencodeServiceWrapper } = require('../opencode');
      const opencodeService = new OpencodeService(config.opencode);
      return new OpencodeServiceWrapper(opencodeService);
    } else {
      // Default to Claude Code (existing implementation)
      const { ClaudianService } = require('../agent');
      // Note: This would need to be adapted for the interface
      throw new Error('Claude Code backend not yet adapted to IAgentService');
    }
  }

  /**
   * Set the current service instance.
   */
  static setService(service: IAgentService | null): void {
    this.service = service;
  }

  /**
   * Get the current service instance.
   */
  static getService(): IAgentService | null {
    return this.service;
  }
}
