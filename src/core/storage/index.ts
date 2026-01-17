/**
 * Storage module barrel export.
 */

// CC-compatible settings (shared with Claude Code CLI)
export { CC_SETTINGS_PATH, CCSettingsStorage, isLegacyPermissionsFormat } from './CCSettingsStorage';

// OpenCode-specific settings
export {
  OPENCODE_SETTINGS_PATH,
  OpencodeSettingsStorage,
  type StoredOpencodeSettings,
} from './OpencodeSettingsStorage';

// Other storage modules
export { MCP_CONFIG_PATH, McpStorage } from './McpStorage';
export { SESSIONS_PATH, SessionStorage } from './SessionStorage';
export { COMMANDS_PATH, SlashCommandStorage } from './SlashCommandStorage';

// Main storage coordinator
export {
  CLAUDE_PATH,
  type CombinedSettings,
  SETTINGS_PATH,
  StorageService,
} from './StorageService';
export { VaultFileAdapter } from './VaultFileAdapter';
