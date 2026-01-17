# CORE INFRASTRUCTURE

**Scope:** Infrastructure layer with no UI dependencies. Pure TypeScript, Obsidian-agnostic where possible.

## WHERE TO LOOK

| Concern | File | Role |
|---------|------|------|
| OpenCode SDK | `opencode/OpencodeService.ts` | OpenCode HTTP client, session management |
| OpenCode Wrapper | `opencode/OpencodeServiceWrapper.ts` | Adapter to IAgentService interface |
| Server Manager | `opencode/OpencodeServerManager.ts` | Server process lifecycle, auto-start |
| Session management | `opencode/SessionManager.ts` | Session lifecycle, resume |
| Message channel | `agent/MessageChannel.ts` | Queue, turn management |
| CLI detection | `utils/opencodeCli.ts` | OpenCode CLI path resolution |
| Slash commands | `commands/SlashCommandManager.ts` | Expansion, placeholders, inline bash |
| Built-in commands | `commands/builtInCommands.ts` | `/clear`, `/command` detection |
| Pre/post hooks | `hooks/` | Security, diff tracking |
| Image handling | `images/` | SHA-256 caching, dedup |
| MCP servers | `mcp/McpServerManager.ts` | Config, lifecycle |
| MCP service | `mcp/McpService.ts` | Tool invocation, SSE/HTTP |
| MCP testing | `mcp/McpTester.ts` | Connection verification |
| Plugin discovery | `plugins/PluginManager.ts` | Registry scan, manifest parsing |
| Plugin storage | `plugins/PluginStorage.ts` | Scoped (user/project) persistence |
| System prompts | `prompts/mainAgent.ts` | Dynamic prompt building |
| SDK transformation | `sdk/transformSDKMessage.ts` | Message → UI blocks |
| Security hooks | `security/SecurityHooks.ts` | Blocklist, vault restriction |
| Approval manager | `security/ApprovalManager.ts` | Permission rules |
| Storage service | `storage/StorageService.ts` | Unified storage facade |
| Settings storage | `storage/OpencodeSettingsStorage.ts` | Plugin settings |
| Session storage | `storage/SessionStorage.ts` | Legacy JSONL storage |
| MCP storage | `storage/McpStorage.ts` | Server configs |
| Slash storage | `storage/SlashCommandStorage.ts` | Command files |
| Tool names | `tools/toolNames.ts` | Canonical tool identifiers |
| Type definitions | `types/` | SDK, chat, MCP, plugins, settings |

## CONVENTIONS

- **No UI imports**: `core/` must not import Obsidian UI components
- **Hook pattern**: `create*Hook(getContext) → HookCallbackMatcher`
- **Storage pattern**: `*Storage.ts` classes with CRUD methods
- **MCP abstraction**: `McpServerManager` → `McpService` separation
- **Permission rules**: Pattern strings, `matchesRulePattern()` matching
- **OpenCode integration**: HTTP client via `@opencode-ai/sdk` on configurable port

## KEY TYPES

```typescript
// Query options (persistent vs cold-start)
 interface QueryOptions {
   model: string;
   thinkingBudget: ThinkingBudget;
   permissionMode: 'yolo' | 'normal';
   mcpServers?: string[];
   systemPrompt?: string;
 }

// OpenCode service configuration
 interface OpencodeServiceConfig {
   hostname: string;  // default: '127.0.0.1'
   port: number;      // default: 4096
   timeout: number;   // default: 5000
 }

// OpenCode server configuration
 interface OpencodeServerConfig {
   hostname: string;
   port: number;
   autoStart: boolean;
   enableMdns: boolean;
   corsOrigins: string[];
   externalServer: boolean;
 }

// Permission rule pattern
 type PermissionRule = string;  // e.g., "Bash(git *)"

// MCP server config (discriminated union)
 type McpServerConfig =
   | { type: 'stdio'; command: string; args: string[] }
   | { type: 'sse'; url: string; headers?: Record<string, string> }
   | { type: 'http'; url: string; method?: 'GET' | 'POST' };
```

## STORAGE LOCATIONS

```
~/.opencode/
├── projects/{encoded-vault}/{sessionId}.jsonl  # SDK messages
└── plugins/installed_plugins.json              # Plugin registry

vault/.opencode/
├── settings.json          # Plugin settings
├── mcp.json               # MCP configs
├── commands/              # Slash command .md files
└── sessions/
    ├── {id}.meta.json     # UI metadata
    └── {id}.jsonl         # Legacy sessions
```

## OPENCODE INTEGRATION

```typescript
// OpenCode SDK initialization
import { createOpencode } from '@opencode-ai/sdk';

const { client } = await createOpencode({
  hostname: '127.0.0.1',
  port: 4096,
  timeout: 5000,
});

// Send prompt to session
const result = await client.session.prompt(
  { path: { id: sessionId } },
  { body: { parts: [{ type: 'text', text: prompt }] } }
);

// Server auto-start
import { OpencodeServerManager } from './opencode/OpencodeServerManager';

const server = new OpencodeServerManager(vaultPath, config, password);
await server.start();
```

## TEST STRUCTURE

```
tests/unit/core/
├── opencode/        # OpenCode SDK tests
├── commands/
├── hooks/
├── mcp/
├── plugins/
├── prompts/
├── sdk/
├── security/
└── storage/
```
