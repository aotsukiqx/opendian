/**
 * OpenCode SDK - Types
 *
 * Type definitions for OpenCode SDK integration.
 */

import type { ImageAttachment } from '../types';

/**
 * Query options for OpenCode.
 */
export interface OpencodeQueryOptions {
  model?: string;
  provider?: string;
  allowedTools?: string[];
  sessionId?: string;
  externalContextPaths?: string[];
  mcpServers?: Record<string, unknown>;
  images?: ImageAttachment[];
}

/**
 * Stream chunk from OpenCode.
 */
export interface OpencodeStreamChunk {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'done' | 'error' | 'usage' | 'session';
  content?: string;
  toolId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  result?: string;
  sessionId?: string;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}

/**
 * Server configuration.
 */
export interface OpencodeServerConfig {
  hostname: string;
  port: number;
  timeout: number;
  username?: string;  // For Basic Auth
  password?: string;  // For Basic Auth
}

/**
 * Session data types (re-exported for convenience)
 * Note: HeyAPI automatically handles the 'url' property, so we define
 * only the optional parts (body, path, query) that the caller provides.
 */
export type SessionCreateData = {
  body?: { parentID?: string; title?: string };
  path?: never;
  query?: { directory?: string };
};

export type SessionGetData = {
  body?: never;
  path: { id: string };
  query?: { directory?: string };
};

export type SessionDeleteData = {
  body?: never;
  path: { id: string };
  query?: { directory?: string };
};

export type SessionPromptData = {
  body?: {
    messageID?: string;
    model?: { providerID: string; modelID: string };
    agent?: string;
    noReply?: boolean;
    system?: string;
    tools?: Record<string, boolean>;
    parts: Array<{ type: 'text'; text: string } | { type: 'file'; id?: string; mime?: string; filename?: string; url: string }>;
  };
  path: { id: string };
  query?: { directory?: string };
};

export type SessionMessagesData = {
  body?: never;
  path: { id: string };
  query?: { directory?: string };
};

export type SessionAbortData = {
  body?: never;
  path: { id: string };
  query?: { directory?: string };
};

export type SessionShareData = {
  body?: never;
  path: { id: string };
  query?: { directory?: string };
};

export type SessionListData = {
  body?: never;
  path?: never;
  query?: { directory?: string };
};

export type ConfigGetData = {
  body?: never;
  path?: never;
  query?: { directory?: string };
};

export type ConfigProvidersData = {
  body?: never;
  path?: never;
  query?: { directory?: string };
};

export type GlobalHealthData = {
  body?: never;
  path?: never;
  query?: { directory?: string };
};

/**
 * Model cost information.
 */
export interface OpencodeModelCost {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  contextOver200k?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
}

/**
 * Model limits.
 */
export interface OpencodeModelLimit {
  context: number;
  output: number;
}

/**
 * Model information from OpenCode provider.
 */
export interface OpencodeModelInfo {
  id: string;
  name: string;
  release_date: string;
  attachment: boolean;
  reasoning: boolean;
  temperature: boolean;
  tool_call: boolean;
  cost?: OpencodeModelCost;
  limit: OpencodeModelLimit;
  modalities?: {
    input: string[];
    output: string[];
  };
  experimental?: boolean;
  status?: 'alpha' | 'beta' | 'deprecated';
}

/**
 * Provider information from OpenCode.
 */
export interface OpencodeProvider {
  api?: string;
  name: string;
  env: string[];
  id: string;
  npm?: string;
  models: Record<string, OpencodeModelInfo>;
}

/**
 * Model formatted for UI selector.
 */
export interface OpencodeModel {
  value: string;           // Format: "providerId:modelId"
  label: string;           // Display name
  description: string;     // Description with capabilities
  provider: string;        // Provider ID
  providerName: string;    // Provider name for display
  modelId: string;         // Model ID within provider
  reasoning: boolean;      // Supports reasoning/thinking
  temperature: boolean;    // Supports temperature setting
  contextLimit: number;
  outputLimit: number;
  cost?: OpencodeModelCost;
}
