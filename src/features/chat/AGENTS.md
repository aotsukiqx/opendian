# CHAT FEATURE

**Scope:** Main sidebar chat interface. Multi-tab, streaming, rendering, controllers.

## WHERE TO LOOK

| Concern | File | Role |
|---------|------|------|
| View shell | `OpencodeView.ts` | Lifecycle, TabManager coordination |
| Constants | `constants.ts` | Logo, flavor texts |
| State | `state/ChatState.ts` | Centralized state (messages, usage) |
| Controllers | `controllers/` | |
| → Conversation | `ConversationController.ts` | Message flow, tool calls |
| → Stream | `StreamController.ts` | Streaming response handling |
| → Input | `InputController.ts` | Input state, @mention, slash |
| → Selection | `SelectionController.ts` | Editor selection polling |
| → Navigation | `NavigationController.ts` | Vim-style key bindings |
| Rendering | `rendering/` | |
| → MessageRenderer | `MessageRenderer.ts` | Main render orchestrator |
| → ToolCallRenderer | `ToolCallRenderer.ts` | Tool result rendering |
| → DiffRenderer | `DiffRenderer.ts` | Line-based diff algorithm |
| → ThinkingBlock | `ThinkingBlockRenderer.ts` | Extended thinking display |
| → SubagentRenderer | `SubagentRenderer.ts` | Task rendering |
| → WriteEditRenderer | `WriteEditRenderer.ts` | fsWriteEdit diff previews |
| Services | `services/` | |
| → TitleGeneration | `TitleGenerationService.ts` | Async title generation |
| → AsyncSubagent | `AsyncSubagentManager.ts` | Background task management |
| → InstructionRefine | `InstructionRefineService.ts` | # instruction mode |
| Tabs | `tabs/` | |
| → TabManager | `TabManager.ts` | Multi-tab lifecycle |
| → TabBar | `TabBar.ts` | Tab strip UI |
| → Tab | `Tab.ts` | Per-tab state + wiring |
| → Types | `types.ts` | Tab interfaces, persistence |
| UI | `ui/` | |
| → InputToolbar | `InputToolbar.ts` | Model/thinking/MCP selectors |
| → FileContext | `FileContext.ts` | @-file chip management |
| → ImageContext | `ImageContext.ts` | Image chip management |
| → TodoPanel | `TodoPanel.ts` | Todo list display |
| → InstructionMode | `InstructionModeManager.ts` | # mode state machine |

## CONVENTIONS

- **Thin view**: `OpencodeView` only coordinates TabManager
- **Per-tab state**: `TabData` holds all per-conversation state
- **Controller pattern**: Each controller handles one aspect
- **Rendering**: `MessageRenderer` → specialized renderers
- **State**: Centralized in `ChatState`, exposed via callbacks

## KEY TYPES

```typescript
// Tab data (per-conversation)
 interface TabData {
   id: TabId;
   tabManager: TabManager;
   state: ChatState;
   controllers: {
     conversation: ConversationController;
     stream: StreamController;
     input: InputController;
     selection: SelectionController;
   };
   services: {
     titleGen: TitleGenerationService;
   };
   ui: {
     toolbar: InputToolbar;
     fileContext: FileContextManager;
   };
 }

// Message types
 type ContentBlock = TextContentBlock | ImageContentBlock | ToolUseBlock;
 interface ChatMessage {
   role: 'user' | 'assistant';
   content: ContentBlock[];
   usage?: UsageInfo;
 }
```

## STATE MANAGEMENT

```
ChatState (centralized)
├── messages: ChatMessage[]
├── pending: QueuedMessage[]
├── isStreaming: boolean
├── usageInfo: UsageInfo | null
└── titleGenerationStatus: 'pending' | 'success' | 'failed'

Updates via: state.updateState(), state.appendMessage(), etc.
Listeners: ChatStateCallbacks (controllers, services, UI)
```

## RENDERING PIPELINE

```
SDK Message
  → transformSDKMessage()
  → MessageRenderer.render()
  → Specialized renderer (ToolCallRenderer, etc.)
  → DOM (with .opencode-* classes)
```

## TEST STRUCTURE

```
tests/unit/features/chat/
├── controllers/
├── rendering/
├── services/
├── state/
├── tabs/
└── ui/
```
