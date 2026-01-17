/**
 * Agent module barrel export.
 *
 * Provides the Claude Agent SDK wrapper, OpenCode SDK wrapper, and unified interface.
 */

export { type ApprovalCallback, ClaudianService, type QueryOptions } from './ClaudianService';
export { MessageChannel } from './MessageChannel';
export {
  type ColdStartQueryContext,
  type PersistentQueryContext,
  QueryOptionsBuilder,
  type QueryOptionsContext,
} from './QueryOptionsBuilder';
export { SessionManager } from './SessionManager';
export type {
  ClosePersistentQueryOptions,
  PersistentQueryConfig,
  ResponseHandler,
  SDKContentBlock,
  SessionState,
} from './types';
export * from './IAgentService';
