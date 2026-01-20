# PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-16
**Project:** opencodian - Obsidian plugin embedding OpenCode as sidebar chat

## OVERVIEW

Obsidian plugin that embeds OpenCode Agent as sidebar chat. Vault becomes OpenCode's working directory with full agentic capabilities (file ops, bash, multi-step workflows). Core infrastructure decoupled from UI features.

## STRUCTURE

```
./src/
├── main.ts                      # Plugin entry point
├── core/                        # Infrastructure (no UI deps)
├── features/                    # Feature modules (UI + logic)
├── shared/                      # Shared UI primitives
├── utils/                       # Modular utilities
├── style/                       # CSS modules → styles.css
└── i18n/                        # 10 locales
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| OpenCode SDK | `core/opencode/` | OpencodeService, OpencodeServiceWrapper, types |
| Slash commands | `core/commands/` | Expansion, built-in commands |
| MCP servers | `core/mcp/` | Server manager, service, testing |
| OpenCode plugins | `core/plugins/` | Discovery, storage, command loading |
| Security/permissions | `core/security/` | Approval, blocklist, path validation |
| Chat UI | `features/chat/` | Main view, rendering, controllers |
| Inline edit | `features/inline-edit/` | Selection/cursor edit mode |
| Settings | `features/settings/` | Tab, UI components |
| @-mention dropdown | `shared/mention/` | Files, MCP, external contexts |

## CONVENTIONS

- **File naming**: `index.ts` for barrel exports, `*.ts` for modules
- **Class prefix**: `Plugin` suffix for main classes (`OpencodePlugin`, `OpencodeService`)
- **Controller pattern**: `*Controller.ts` for state-machine controllers
- **Service pattern**: `*Service.ts` for async operations
- **No console logs in prod**: Remove before commit; use Obsidian notifications
- **CSS prefix**: `.opencode-` for all classes

## ANTI-PATTERNS (THIS PROJECT)

- **DO NOT** use `console.log` in production code
- **DO NOT** put UI code in `core/` - keeps infrastructure testable
- **DO NOT** check in generated docs under `.agents/` or `dev/`
- **DO NOT** use SDK tools directly - wrap in `core/tools/`

## COMMANDS

```bash
npm run dev       # Watch mode, auto-reload
npm run build     # Production build
npm run typecheck # Type checking
npm run lint      # Linting
npm run test      # Unit + integration tests
```

## NOTES

- Hybrid storage: SDK-native (`~/.opencode/projects/`) + vault metadata (`.opencode/`)
- Multi-tab: Each tab has independent OpencodeService instance (lazy init)
- Path validation: Symlink-safe via `realpath` resolution
- Cross-platform: Windows path normalization, merged blocklists

## KEY PATTERNS

```typescript
// Persistent query (active chat)
OpencodeService.query(prompt, options);

// Cold-start query (one-off ops)
OpencodeService.coldStart(options);

// Security hook pattern
createBlocklistHook(context => matcher);
createVaultRestrictionHook(context => matcher);

// Storage hybrid
~/.opencode/projects/{vault}/{session}.jsonl  # SDK messages
vault/.opencode/{id}.meta.json                 # UI metadata
```
