# OpenCode

![Preview](Preview.png)

An Obsidian plugin that embeds OpenCode Agent as a sidebar chat interface. Your vault becomes OpenCode's working directory, giving it full agentic capabilities: file read/write, search, bash commands, and multi-step workflows.

## Features

- **Full Agentic Capabilities**: Leverage OpenCode's power to read, write, and edit files, search, and execute bash commands, all within your Obsidian vault.
- **Context-Aware**: Automatically attach the focused note, mention files with `@`, exclude notes by tag, include editor selection (Highlight), and access external directories for additional context.
- **Vision Support**: Analyze images by sending them via drag-and-drop, paste, or file path.
- **Inline Edit**: Edit selected text or insert content at cursor position directly in notes with word-level diff preview and read-only tool access for context.
- **Instruction Mode (`#`)**: Add refined custom instructions to your system prompt directly from the chat input, with review/edit in a modal.
- **Slash Commands**: Create reusable prompt templates triggered by `/command`, with argument placeholders, `@file` references, and optional inline bash substitutions.
- **Skills**: Extend OpenCode with reusable capability modules that are automatically invoked based on context, compatible with OpenCode's skill format.
- **OpenCode Plugins**: Enable OpenCode plugins installed via the CLI, with automatic discovery from `~/.opencode/plugins` and per-vault configuration. Plugin skills and slash commands integrate seamlessly.
- **MCP Support**: Connect external tools and data sources via Model Context Protocol servers (stdio, SSE, HTTP) with context-saving mode and `@`-mention activation.
- **Advanced Model Control**: Select between supported models, configure custom models via environment variables, and fine-tune thinking budget.
- **Security**: Permission modes (YOLO/Safe), safety blocklist, and vault confinement with symlink-safe checks.
- **Multi-Tab Support**: Run multiple concurrent chat sessions with independent streaming, lazy service initialization, and configurable tab limits (3-10 tabs).

## Requirements

- [OpenCode CLI](https://opencode.com) installed
- Obsidian v1.8.9+
- Desktop only (macOS, Linux, Windows)

## Installation

### From GitHub Release (recommended)

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/YishenTu/opendian/releases/latest)
2. Create a folder called `opendian` in your vault's plugins folder:
   ```
   /path/to/vault/.obsidian/plugins/opendian/
   ```
3. Copy the downloaded files into the `opendian` folder
4. Enable the plugin in Obsidian:
   - Settings → Community plugins → Enable "OpenCode"

### Using BRAT

[BRAT](https://github.com/TfTHacker/obsidian42-brat) (Beta Reviewers Auto-update Tester) allows you to install and automatically update plugins directly from GitHub.

1. Install the BRAT plugin from Obsidian Community Plugins
2. Enable BRAT in Settings → Community plugins
3. Open BRAT settings and click "Add Beta plugin"
4. Enter the repository URL: `https://github.com/YishenTu/opendian`
5. Click "Add Plugin" and BRAT will install OpenCode automatically
6. Enable OpenCode in Settings → Community plugins

> **Tip**: BRAT will automatically check for updates and notify you when a new version is available.

### From source (development)

1. Clone this repository into your vault's plugins folder:
   ```bash
   cd /path/to/vault/.obsidian/plugins
   git clone https://github.com/YishenTu/opendian.git
   cd opendian
   ```

2. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```

3. Enable the plugin in Obsidian:
   - Settings → Community plugins → Enable "OpenCode"

### Development

```bash
# Watch mode
npm run dev

# Production build
npm run build
```

> **Tip**: Create `.env.local` in the root directory with `OBSIDIAN_VAULT=<your vault path>` to auto-copy files to your vault during development.

## Usage

**Two modes:**
1. Click the bot icon in ribbon or use command palette to open chat
2. Select text + hotkey for inline edit

Use it like OpenCode—read, write, edit, search files in your vault.

### Context

- **File**: Auto-attaches focused note; type `@` to attach other files
- **@-mention dropdown**: Type `@` to see active MCP servers, external contexts, and vault files
  - `@mcp-server` enables context-saving MCP servers
  - `@folder/` filters to files from that external context (e.g., `@workspace/`)
  - Vault files shown by default
- **Selection**: Select text in editor, then chat—selection included automatically
- **Images**: Drag-drop, paste, or type path; configure media folder for `![[image]]` embeds
- **External contexts**: Click folder icon in toolbar for access to directories outside vault

### Features

- **Inline Edit**: Select text + hotkey to edit directly in notes with word-level diff preview
- **Instruction Mode**: Type `#` to add refined instructions to system prompt
- **Slash Commands**: Type `/` for custom prompt templates (Settings → Slash Commands)
- **Skills**: Add `SKILL.md` files to `~/.opencode/skills/` or `{vault}/.opencode/skills/`, recommended to use OpenCode to manage skills
- **OpenCode Plugins**: Enable plugins via Settings → OpenCode Plugins, recommended to use OpenCode to manage plugins
- **MCP**: Add external tools via Settings → MCP Servers; use `@mcp-server` in chat to activate

## Configuration

### Settings

**Customization**
- **User name**: Your name for personalized greetings
- **Excluded tags**: Tags that prevent notes from auto-loading (e.g., `sensitive`, `private`)
- **Media folder**: Configure where vault stores attachments for embedded image support (e.g., `attachments`)
- **Custom system prompt**: Additional instructions appended to the default system prompt (Instruction Mode `#` saves here)
- **Auto-generate conversation titles**: Toggle AI-powered title generation after first exchange
- **Title generation model**: Model used for auto-generating conversation titles (default: Auto)
- **Vim-style navigation mappings**: Configure key bindings with lines like `map w scrollUp`, `map s scrollDown`, `map i focusInput`

**Hotkeys**
- **Inline edit hotkey**: Hotkey to trigger inline edit on selected text
- **Open chat hotkey**: Hotkey to open the chat sidebar

**Slash Commands**
- Create/edit/import/export custom `/commands` (optionally override model and allowed tools)

**MCP Servers**
- Add/edit/verify/delete MCP server configurations with context-saving mode

**OpenCode Plugins**
- Enable/disable OpenCode plugins discovered from `~/.opencode/plugins`
- User-scoped plugins available in all vaults; project-scoped plugins only in matching vault

**Safety**
- **Load user settings**: Load `~/.opencode/settings.json` (user's permission rules may bypass Safe mode)
- **Enable command blocklist**: Block dangerous bash commands (default: on)
- **Blocked commands**: Patterns to block (supports regex, platform-specific)
- **Allowed export paths**: Paths outside the vault where files can be exported (default: `~/Desktop`, `~/Downloads`). Supports `~`, `$VAR`, `${VAR}`, and `%VAR%` (Windows).

**Environment**
- **Custom variables**: Environment variables for OpenCode SDK (KEY=VALUE format)
- **Environment snippets**: Save and restore environment variable configurations

**Advanced**
- **OpenCode CLI path**: Custom path to OpenCode CLI (leave empty for auto-detection)

## Safety and Permissions

| Scope | Access |
|-------|--------|
| **Vault** | Full read/write (symlink-safe via `realpath`) |
| **Export paths** | Write-only (e.g., `~/Desktop`, `~/Downloads`) |
| **External contexts** | Full read/write (session-only, added via folder icon) |

- **YOLO mode**: No approval prompts; all tool calls execute automatically (default)
- **Safe mode**: Approval modal per tool call; Bash requires exact match, file tools allow prefix match

## Privacy & Data Use

- **Sent to API**: Your input, attached files, images, and tool call outputs. Default: OpenCode server; custom endpoint via `OPENCODE_BASE_URL`.
- **Local storage**: Settings, session metadata, and commands stored in `vault/.opencode/`; session messages in `~/.opencode/projects/` (SDK-native); legacy sessions in `vault/.opencode/sessions/`.
- **No telemetry**: No tracking beyond your configured API provider.

## Troubleshooting

### OpenCode CLI not found

If you encounter `spawn opencode ENOENT` or `OpenCode CLI not found`, the plugin can't auto-detect your OpenCode installation. Common with Node version managers (nvm, fnm, volta).

**Solution**: Find your CLI path and set it in Settings → Advanced → OpenCode CLI path.

| Platform | Command | Example Path |
|----------|---------|--------------|
| macOS/Linux | `which opencode` | `/Users/you/.volta/bin/opencode` |
| Windows (native) | `where.exe opencode` | `C:\Users\you\AppData\Local\OpenCode\opencode.exe` |
| Windows (npm) | `npm root -g` | `{root}\opencode\cli.js` |

> **Note**: On Windows, avoid `.cmd` wrappers. Use `opencode.exe` or `cli.js`.

**Alternative**: Add your Node.js bin directory to PATH in Settings → Environment → Custom variables.

### npm CLI and Node.js not in same directory

If using npm-installed CLI, check if `opencode` and `node` are in the same directory:
```bash
dirname $(which opencode)
dirname $(which node)
```

If different, GUI apps like Obsidian may not find Node.js.

**Solutions**:
1. Install native binary (recommended)
2. Add Node.js path to Settings → Environment: `PATH=/path/to/node/bin`

**Still having issues?** [Open a GitHub issue](https://github.com/YishenTu/opendian/issues) with your platform, CLI path, and error message.

## Architecture

```
src/
├── main.ts                      # Plugin entry point
├── core/                        # Core infrastructure
│   ├── agent/                   # Agent SDK wrapper (OpencodeService)
│   ├── commands/                # Slash command management (SlashCommandManager)
│   ├── hooks/                   # PreToolUse/PostToolUse hooks
│   ├── images/                  # Image caching and loading
│   ├── mcp/                     # MCP server config, service, and testing
│   ├── opencode/                # OpenCode SDK integration
│   ├── plugins/                 # OpenCode plugin discovery and management
│   ├── prompts/                 # System prompts for agents
│   ├── sdk/                     # SDK message transformation
│   ├── security/                # Approval, blocklist, path validation
│   ├── storage/                 # Distributed storage system
│   ├── tools/                   # Tool constants and utilities
│   └── types/                   # Type definitions
├── features/                    # Feature modules
│   ├── chat/                    # Main chat view + UI, rendering, controllers, tabs
│   ├── inline-edit/             # Inline edit service + UI
│   └── settings/                # Settings tab UI
├── shared/                      # Shared UI components and modals
│   ├── components/              # Input toolbar bits, dropdowns, selection highlight
│   ├── mention/                 # @-mention dropdown controller
│   ├── modals/                  # Approval + instruction modals
│   └── icons.ts                 # Shared SVG icons
├── i18n/                        # Internationalization (10 locales)
├── utils/                       # Modular utility functions
└── style/                       # Modular CSS (→ styles.css)
```

## Roadmap

- [x] OpenCode Plugin support
- [ ] Hooks and other advanced features
- [ ] More to come!

## License

Licensed under the [MIT License](LICENSE).

## Acknowledgments

- [Obsidian](https://obsidian.md) for the plugin API
- [OpenCode](https://opencode.com) for the Agent SDK
