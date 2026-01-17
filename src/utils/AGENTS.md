# UTILITIES

**Scope:** Modular utility functions. Pure TypeScript, Obsidian-agnostic where possible.

## FILES

| File | Exports | Purpose |
|------|---------|---------|
| `path.ts` | `getVaultPath`, `expandHomePath`, `isPathWithinVault`, `getPathAccessType`, `normalizePath*` | Path resolution, validation, access control |
| `env.ts` | `findNodeDirectory`, `parseEnvironmentVariables`, `getEnhancedPath`, `getModelsFromEnvironment` | Env vars, Node.js detection, CLI resolution |
| `date.ts` | `getTodayDate` | Date formatting |
| `context.ts` | `formatCurrentNote`, `prependCurrentNote`, `stripCurrentNotePrefix`, `prependContextFiles` | Prompt context building |
| `editor.ts` | `getEditorView`, `buildCursorContext`, `formatEditorContext`, `prependEditorContext` | Editor state extraction |
| `session.ts` | `isSessionExpiredError`, `buildContextFromHistory`, `getLastUserMessage`, `buildPromptWithHistoryContext` | Session message handling |
| `sdkSession.ts` | `encodeVaultPathForSDK`, `parseSDKMessageToChat`, `getSDKSessionPath` | SDK-native session handling |
| `markdown.ts` | `appendMarkdownSnippet` | Prompt chunking |
| `fileLink.ts` | `extractLinkTarget`, `registerFileLinkHandler`, `processFileLinks` | Wiki-link processing |
| `imageEmbed.ts` | `replaceImageEmbedsWithHtml` | Image embed → HTML |
| `slashCommand.ts` | `parseSlashCommandContent`, `formatSlashCommandWarnings` | Slash command parsing |
| `mcp.ts` | `extractMcpMentions`, `transformMcpMentions`, `parseCommand`, `waitForRpcResponse` | MCP mention handling, RPC |
| `externalContext.ts` | `findConflictingPath`, `isValidDirectoryPath`, `filterValidPaths` | External context validation |
| `externalContextScanner.ts` | `ExternalContextScanner` | File scanning for external dirs |
| `inlineEdit.ts` | `normalizeInsertionText`, `escapeHtml` | Inline edit text processing |
| `claudeCli.ts` | `ClaudeCliResolver`, `resolveClaudeCliPath` | CLI detection |

## PATTERNS

- **Pure functions**: Most exports are standalone functions
- **Obsidian types**: Some require `App`, `Editor`, `EditorView` params
- **No side effects**: Functions don't modify params
- **Return types**: Explicit, no `any` unless unavoidable

## KEY FUNCTIONS

```typescript
// Path access classification
 getPathAccessType(path: string, vaultPath: string): PathAccessType;
 // Returns: 'vault' | 'readwrite' | 'context' | 'export' | 'none'

// Session prompt building
 buildContextFromHistory(messages: ChatMessage[]): string;
 buildPromptWithHistoryContext(prompt: string, messages: ChatMessage[]): string;

// Environment model detection
 getModelsFromEnvironment(envVars: Record<string, string>): { value, label, description }[];

// CLI resolution
 resolveClaudeCliPath(pathValue?: string): string | null;
```

## CROSS-CUTTING

| Utility | Used By |
|---------|---------|
| `path.ts` | security/, storage/, core hooks |
| `env.ts` | agent/, settings |
| `context.ts` | agent/, chat controllers |
| `editor.ts` | chat controllers, inline-edit |
| `session.ts` | agent/, chat services |
| `mcp.ts` | core/mcp/, shared mention |
