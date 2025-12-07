import { ItemView, WorkspaceLeaf, MarkdownRenderer, setIcon, TFile, Modal } from 'obsidian';
import type ClaudianPlugin from './main';
import { VIEW_TYPE_CLAUDIAN, ChatMessage, StreamChunk, ToolCallInfo, ContentBlock, CLAUDE_MODELS, ClaudeModel, THINKING_BUDGETS, ThinkingBudget, DEFAULT_THINKING_BUDGET, PermissionMode } from './types';
import type { ApprovalCallback } from './ClaudianService';
import { getVaultPath } from './utils';

export class ClaudianView extends ItemView {
  private plugin: ClaudianPlugin;
  private messages: ChatMessage[] = [];
  private messagesEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private isStreaming = false;
  private toolCallElements: Map<string, HTMLElement> = new Map();

  // For maintaining stream order
  private currentContentEl: HTMLElement | null = null;
  private currentTextEl: HTMLElement | null = null;
  private currentTextContent: string = '';

  // Thinking block tracking
  private currentThinkingEl: HTMLElement | null = null;
  private currentThinkingContent: string = '';
  private thinkingStartTime: number | null = null;
  private thinkingTimerInterval: ReturnType<typeof setInterval> | null = null;
  private thinkingLabelEl: HTMLElement | null = null;

  // Thinking indicator
  private thinkingEl: HTMLElement | null = null;

  // Conversation history UI
  private currentConversationId: string | null = null;
  private historyDropdown: HTMLElement | null = null;

  // File context state
  private attachedFiles: Set<string> = new Set();
  private lastSentFiles: Set<string> = new Set();  // Files sent with last message
  private sessionStarted: boolean = false;  // True after first query sent
  private mentionDropdown: HTMLElement | null = null;
  private mentionStartIndex: number = -1;
  private selectedMentionIndex: number = 0;
  private filteredFiles: TFile[] = [];
  private fileIndicatorEl: HTMLElement | null = null;
  private inputContainerEl: HTMLElement | null = null;
  private cachedMarkdownFiles: TFile[] = [];
  private filesCacheDirty = true;
  private cancelRequested = false;

  // Edited files tracking (session-only)
  private editedFilesThisSession: Set<string> = new Set();
  private editedFilesIndicatorEl: HTMLElement | null = null;

  // Model selector
  private modelSelectorEl: HTMLElement | null = null;
  private modelDropdownEl: HTMLElement | null = null;

  // Thinking budget selector
  private thinkingBudgetEl: HTMLElement | null = null;

  // Permission mode toggle
  private permissionToggleEl: HTMLElement | null = null;
  private permissionLabelEl: HTMLElement | null = null;

  private static readonly FLAVOR_TEXTS = [
    'Thinking...',
    'Ruminating...',
    'Pondering...',
    'Contemplating...',
    'Processing...',
    'Analyzing...',
    'Considering...',
    'Reflecting...',
    'Mulling it over...',
    'Working on it...',
    'Let me think...',
    'Hmm...',
    'One moment...',
    'On it...',
  ];

  constructor(leaf: WorkspaceLeaf, plugin: ClaudianPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_CLAUDIAN;
  }

  getDisplayText(): string {
    return 'Claudian';
  }

  getIcon(): string {
    return 'bot';
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('claudian-container');

    // Header
    const header = container.createDiv({ cls: 'claudian-header' });

    // Left side: Logo + Title
    const titleContainer = header.createDiv({ cls: 'claudian-title' });
    const logoEl = titleContainer.createSpan({ cls: 'claudian-logo' });
    logoEl.innerHTML = `<svg viewBox="0 0 100 100" width="16" height="16">
      <g fill="#D97757">
        ${Array.from({ length: 12 }, (_, i) => {
      const angle = (i * 30 - 90) * Math.PI / 180;
      const cx = 53, cy = 50;
      const x1 = cx + 15 * Math.cos(angle);
      const y1 = cy + 15 * Math.sin(angle);
      const x2 = cx + 45 * Math.cos(angle);
      const y2 = cy + 45 * Math.sin(angle);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#D97757" stroke-width="8" stroke-linecap="round"/>`;
    }).join('')}
      </g>
    </svg>`;
    titleContainer.createEl('h4', { text: 'Claudian' });

    // Right side: Header actions
    const headerActions = header.createDiv({ cls: 'claudian-header-actions' });

    // History dropdown container
    const historyContainer = headerActions.createDiv({ cls: 'claudian-history-container' });

    // Dropdown trigger (icon button)
    const trigger = historyContainer.createDiv({ cls: 'claudian-header-btn' });
    setIcon(trigger, 'history');
    trigger.setAttribute('aria-label', 'Chat history');

    // Dropdown menu
    this.historyDropdown = historyContainer.createDiv({ cls: 'claudian-history-menu' });

    // Toggle dropdown on trigger click
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleHistoryDropdown();
    });

    // Close dropdown when clicking outside
    this.registerDomEvent(document, 'click', () => {
      this.historyDropdown?.removeClass('visible');
    });

    // Keep cached file list fresh
    this.registerEvent(this.plugin.app.vault.on('create', () => this.markFilesCacheDirty()));
    this.registerEvent(this.plugin.app.vault.on('delete', () => this.markFilesCacheDirty()));
    this.registerEvent(this.plugin.app.vault.on('rename', () => this.markFilesCacheDirty()));
    this.registerEvent(this.plugin.app.vault.on('modify', () => this.markFilesCacheDirty()));

    // New conversation button
    const newBtn = headerActions.createDiv({ cls: 'claudian-header-btn' });
    setIcon(newBtn, 'plus');
    newBtn.setAttribute('aria-label', 'New conversation');
    newBtn.addEventListener('click', () => this.createNewConversation());

    // Messages area
    this.messagesEl = container.createDiv({ cls: 'claudian-messages' });

    // Input area
    this.inputContainerEl = container.createDiv({ cls: 'claudian-input-container' });

    // Edited files indicator (above file indicator - shows non-attached edited files)
    this.editedFilesIndicatorEl = this.inputContainerEl.createDiv({ cls: 'claudian-edited-files-indicator' });

    // File indicator (above textarea - shows attached files)
    this.fileIndicatorEl = this.inputContainerEl.createDiv({ cls: 'claudian-file-indicator' });

    // Input box wrapper (contains textarea + toolbar)
    const inputWrapper = this.inputContainerEl.createDiv({ cls: 'claudian-input-wrapper' });

    this.inputEl = inputWrapper.createEl('textarea', {
      cls: 'claudian-input',
      attr: {
        placeholder: 'Ask Claudian anything...\n\n(Enter to send, Shift+Enter for newline)',
        rows: '3',
      },
    });

    // Input toolbar (model selector + thinking budget + permission toggle)
    const inputToolbar = inputWrapper.createDiv({ cls: 'claudian-input-toolbar' });
    this.createModelSelector(inputToolbar);
    this.createThinkingBudgetSelector(inputToolbar);
    this.createPermissionToggle(inputToolbar);

    // Event handlers
    this.inputEl.addEventListener('keydown', (e) => {
      // Handle @ mention dropdown navigation
      if (this.mentionDropdown?.hasClass('visible')) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.navigateMentionDropdown(1);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.navigateMentionDropdown(-1);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          this.selectMentionItem();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          this.hideMentionDropdown();
          return;
        }
      }

      if (e.key === 'Escape' && this.isStreaming) {
        e.preventDefault();
        this.cancelStreaming();
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Listen for @ mentions
    this.inputEl.addEventListener('input', () => this.handleInputChange());

    // Close mention dropdown when clicking outside
    this.registerDomEvent(document, 'click', (e) => {
      if (!this.mentionDropdown?.contains(e.target as Node) && e.target !== this.inputEl) {
        this.hideMentionDropdown();
      }
    });

    // Listen for focus changes - update attachment before session starts
    // Also dismiss edited file indicator when user focuses on an edited file
    this.registerEvent(
      this.plugin.app.workspace.on('file-open', (file) => {
        if (file) {
          const normalizedPath = this.normalizePathForVault(file.path);
          if (!normalizedPath) return;

          // Dismiss edited indicator when file is focused
          if (this.isFileEdited(normalizedPath)) {
            this.dismissEditedFile(normalizedPath);
          }

          // Update attachment before session starts (skip if file has excluded tags)
          if (!this.sessionStarted) {
            this.attachedFiles.clear();
            if (!this.hasExcludedTag(file)) {
              this.attachedFiles.add(normalizedPath);
            }
            this.updateFileIndicator();
          }
        }
      })
    );

    // Set up approval callback for permission prompts
    this.plugin.agentService.setApprovalCallback(this.handleApprovalRequest.bind(this));

    // Load active conversation or create new
    await this.loadActiveConversation();
  }

  async onClose() {
    // Clean up thinking indicator interval
    this.hideThinkingIndicator();
    // Clean up thinking timer interval
    if (this.thinkingTimerInterval) {
      clearInterval(this.thinkingTimerInterval);
      this.thinkingTimerInterval = null;
    }
    // Remove approval callback
    this.plugin.agentService.setApprovalCallback(null);
    // Save current conversation before closing
    await this.saveCurrentConversation();
  }

  private async sendMessage() {
    const content = this.inputEl.value.trim();
    if (!content || this.isStreaming) return;

    this.inputEl.value = '';
    this.isStreaming = true;
    this.cancelRequested = false;

    // Mark session as started after first query
    this.sessionStarted = true;

    // Check if attached files have changed since last message
    const currentFiles = Array.from(this.attachedFiles);
    const filesChanged = this.hasFilesChanged(currentFiles);

    // Build prompt - only include context if files changed
    let promptToSend = content;
    let contextFilesForMessage: string[] | undefined;
    if (filesChanged) {
      if (currentFiles.length > 0) {
        const fileList = currentFiles.join(', ');
        promptToSend = `Context files: [${fileList}]\n\n${content}`;
        contextFilesForMessage = currentFiles;
      } else if (this.lastSentFiles.size > 0) {
        // Explicitly signal removal after a prior attachment
        promptToSend = `Context files: []\n\n${content}`;
        contextFilesForMessage = [];
      }
    }

    // Update lastSentFiles
    this.lastSentFiles = new Set(this.attachedFiles);

    // Add user message (display original content, send with context)
    const userMsg: ChatMessage = {
      id: this.generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
      contextFiles: contextFilesForMessage,
    };
    this.addMessage(userMsg);

    // Auto-generate title from first user message
    if (this.messages.length === 1 && this.currentConversationId) {
      const title = this.generateTitle(content);
      await this.plugin.renameConversation(this.currentConversationId, title);
    }

    // Create assistant message placeholder
    const assistantMsg: ChatMessage = {
      id: this.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
    };
    const msgEl = this.addMessage(assistantMsg);
    const contentEl = msgEl.querySelector('.claudian-message-content') as HTMLElement;

    // Reset streaming state
    this.toolCallElements.clear();
    this.currentContentEl = contentEl;
    this.currentTextEl = null;
    this.currentTextContent = '';

    // Show thinking indicator
    this.showThinkingIndicator(contentEl);

    try {
      // Pass conversation history for session expiration recovery
      // Use promptToSend which includes context files prefix
      for await (const chunk of this.plugin.agentService.query(promptToSend, this.messages)) {
        if (this.cancelRequested) {
          break;
        }
        await this.handleStreamChunk(chunk, assistantMsg);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.appendText(`\n\n**Error:** ${errorMsg}`);
    } finally {
      this.hideThinkingIndicator();
      this.isStreaming = false;
      this.cancelRequested = false;
      this.currentContentEl = null;

      // Finalize any remaining blocks
      this.finalizeCurrentThinkingBlock(assistantMsg);
      this.finalizeCurrentTextBlock(assistantMsg);

      // Auto-save after message completion
      await this.saveCurrentConversation();
    }
    // Note: attachedFiles persists for the session (not cleared after send)
  }

  private showThinkingIndicator(parentEl: HTMLElement) {
    // If already showing, don't create another
    if (this.thinkingEl) return;

    this.thinkingEl = parentEl.createDiv({ cls: 'claudian-thinking' });

    // Pick a random flavor text
    const texts = ClaudianView.FLAVOR_TEXTS;
    const randomText = texts[Math.floor(Math.random() * texts.length)];
    this.thinkingEl.setText(randomText);
  }

  private hideThinkingIndicator() {
    if (this.thinkingEl) {
      this.thinkingEl.remove();
      this.thinkingEl = null;
    }
  }

  private cancelStreaming() {
    if (!this.isStreaming) {
      return;
    }
    this.cancelRequested = true;
    this.plugin.agentService.cancel();
    this.hideThinkingIndicator();
  }

  private async handleStreamChunk(
    chunk: StreamChunk,
    msg: ChatMessage
  ) {
    // Hide thinking indicator when real content arrives
    if (chunk.type === 'text' || chunk.type === 'tool_use' || chunk.type === 'thinking') {
      this.hideThinkingIndicator();
    }

    switch (chunk.type) {
      case 'thinking':
        // Finalize any current text block first
        if (this.currentTextEl) {
          this.finalizeCurrentTextBlock(msg);
        }
        await this.appendThinking(chunk.content, msg);
        break;

      case 'text':
        // Finalize any current thinking block first
        if (this.currentThinkingEl) {
          this.finalizeCurrentThinkingBlock(msg);
        }
        msg.content += chunk.content;
        await this.appendText(chunk.content);
        break;

      case 'tool_use': {
        // Finalize current blocks before adding tool
        if (this.currentThinkingEl) {
          this.finalizeCurrentThinkingBlock(msg);
        }
        // Finalize current text block before adding tool
        this.finalizeCurrentTextBlock(msg);

        const toolCall: ToolCallInfo = {
          id: chunk.id,
          name: chunk.name,
          input: chunk.input,
          status: 'running',
          isExpanded: false,
        };
        msg.toolCalls = msg.toolCalls || [];
        msg.toolCalls.push(toolCall);

        if (this.plugin.settings.showToolUse) {
          // Add tool_use reference to contentBlocks when UI is shown
          msg.contentBlocks = msg.contentBlocks || [];
          msg.contentBlocks.push({ type: 'tool_use', toolId: chunk.id });
          this.renderToolCall(this.currentContentEl!, toolCall);
        }
        break;
      }

      case 'tool_result': {
        const existingToolCall = msg.toolCalls?.find(tc => tc.id === chunk.id);
        const isBlocked = this.isBlockedToolResult(chunk.content, chunk.isError);

        if (existingToolCall) {
          existingToolCall.status = isBlocked ? 'blocked' : (chunk.isError ? 'error' : 'completed');
          existingToolCall.result = chunk.content;

          if (this.plugin.settings.showToolUse) {
            this.updateToolCallResult(chunk.id, existingToolCall);
          }
        }

        // Track edited files for Write/Edit tools even when tool UI is hidden
        this.trackEditedFile(existingToolCall?.name, existingToolCall?.input || {}, chunk.isError || isBlocked);

        // Show thinking indicator again - Claude is processing the tool result
        if (this.currentContentEl) {
          this.showThinkingIndicator(this.currentContentEl);
        }
        break;
      }

      case 'blocked':
        await this.appendText(`\n\n⚠️ **Blocked:** ${chunk.content}`);
        break;

      case 'error':
        await this.appendText(`\n\n❌ **Error:** ${chunk.content}`);
        break;

      case 'done':
        break;
    }

    // Auto-scroll to bottom
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private async appendText(text: string) {
    if (!this.currentContentEl) return;

    // Create text block if needed
    if (!this.currentTextEl) {
      this.currentTextEl = this.currentContentEl.createDiv({ cls: 'claudian-text-block' });
      this.currentTextContent = '';
    }

    this.currentTextContent += text;
    await this.renderContent(this.currentTextEl, this.currentTextContent);
  }

  private finalizeCurrentTextBlock(msg?: ChatMessage) {
    // Save current text block to contentBlocks if there's content
    if (msg && this.currentTextContent) {
      msg.contentBlocks = msg.contentBlocks || [];
      msg.contentBlocks.push({ type: 'text', content: this.currentTextContent });
    }
    // Start fresh text block after tool call
    this.currentTextEl = null;
    this.currentTextContent = '';
  }

  private async appendThinking(content: string, msg: ChatMessage) {
    if (!this.currentContentEl) return;

    // Create thinking block if needed
    if (!this.currentThinkingEl) {
      const thinkingWrapper = this.currentContentEl.createDiv({ cls: 'claudian-thinking-block' });

      // Header (clickable to expand/collapse)
      const header = thinkingWrapper.createDiv({ cls: 'claudian-thinking-header' });

      // Chevron icon
      const chevron = header.createSpan({ cls: 'claudian-thinking-chevron' });
      setIcon(chevron, 'chevron-right');

      // Brain icon
      const iconEl = header.createSpan({ cls: 'claudian-thinking-icon' });
      setIcon(iconEl, 'brain');

      // Label with timer
      this.thinkingLabelEl = header.createSpan({ cls: 'claudian-thinking-label' });
      this.thinkingStartTime = Date.now();
      this.updateThinkingTimer();

      // Start timer interval to update label every second
      this.thinkingTimerInterval = setInterval(() => {
        this.updateThinkingTimer();
      }, 1000);

      // Collapsible content (starts collapsed)
      const contentEl = thinkingWrapper.createDiv({ cls: 'claudian-thinking-content' });
      contentEl.style.display = 'none';

      this.currentThinkingEl = contentEl;
      this.currentThinkingContent = '';

      // Toggle expand/collapse on header click
      let isExpanded = false;
      header.addEventListener('click', () => {
        isExpanded = !isExpanded;
        if (isExpanded) {
          contentEl.style.display = 'block';
          thinkingWrapper.addClass('expanded');
          setIcon(chevron, 'chevron-down');
        } else {
          contentEl.style.display = 'none';
          thinkingWrapper.removeClass('expanded');
          setIcon(chevron, 'chevron-right');
        }
      });
    }

    this.currentThinkingContent += content;
    await this.renderContent(this.currentThinkingEl, this.currentThinkingContent);
  }

  private updateThinkingTimer() {
    if (!this.thinkingLabelEl || !this.thinkingStartTime) return;
    const elapsed = Math.floor((Date.now() - this.thinkingStartTime) / 1000);
    this.thinkingLabelEl.setText(`Thinking for ${elapsed}s...`);
  }

  private finalizeCurrentThinkingBlock(msg?: ChatMessage) {
    // Stop the timer
    if (this.thinkingTimerInterval) {
      clearInterval(this.thinkingTimerInterval);
      this.thinkingTimerInterval = null;
    }

    // Update label to show final duration (without "...")
    if (this.thinkingLabelEl && this.thinkingStartTime) {
      const elapsed = Math.floor((Date.now() - this.thinkingStartTime) / 1000);
      this.thinkingLabelEl.setText(`Thought for ${elapsed}s`);
    }

    // Save current thinking block to contentBlocks if there's content
    if (msg && this.currentThinkingContent) {
      const durationSeconds = this.thinkingStartTime
        ? Math.floor((Date.now() - this.thinkingStartTime) / 1000)
        : undefined;
      msg.contentBlocks = msg.contentBlocks || [];
      msg.contentBlocks.push({ type: 'thinking', content: this.currentThinkingContent, durationSeconds });
    }

    // Reset thinking state
    this.currentThinkingEl = null;
    this.currentThinkingContent = '';
    this.thinkingStartTime = null;
    this.thinkingLabelEl = null;
  }

  private addMessage(msg: ChatMessage): HTMLElement {
    this.messages.push(msg);

    const msgEl = this.messagesEl.createDiv({
      cls: `claudian-message claudian-message-${msg.role}`,
    });

    const contentEl = msgEl.createDiv({ cls: 'claudian-message-content' });

    // For user messages, render content directly
    if (msg.role === 'user' && msg.content) {
      const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });
      this.renderContent(textEl, msg.content);
    }
    // For assistant messages, content will be added dynamically during streaming

    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    return msgEl;
  }

  private async renderContent(el: HTMLElement, markdown: string) {
    el.empty();
    await MarkdownRenderer.renderMarkdown(markdown, el, '', this);
  }

  private renderToolCall(parentEl: HTMLElement, toolCall: ToolCallInfo) {
    const toolEl = parentEl.createDiv({ cls: 'claudian-tool-call' });
    toolEl.dataset.toolId = toolCall.id;
    this.toolCallElements.set(toolCall.id, toolEl);

    // Header (clickable to expand/collapse)
    const header = toolEl.createDiv({ cls: 'claudian-tool-header' });

    // Chevron icon
    const chevron = header.createSpan({ cls: 'claudian-tool-chevron' });
    setIcon(chevron, 'chevron-right');

    // Tool icon
    const iconEl = header.createSpan({ cls: 'claudian-tool-icon' });
    this.setToolIcon(iconEl, toolCall.name);

    // Tool label
    const labelEl = header.createSpan({ cls: 'claudian-tool-label' });
    labelEl.setText(this.getToolLabel(toolCall.name, toolCall.input));

    // Status indicator
    const statusEl = header.createSpan({ cls: 'claudian-tool-status' });
    statusEl.addClass(`status-${toolCall.status}`);
    if (toolCall.status === 'running') {
      statusEl.createSpan({ cls: 'claudian-spinner' });
    }

    // Collapsible content
    const content = toolEl.createDiv({ cls: 'claudian-tool-content' });
    content.style.display = 'none';

    // Input parameters
    const inputSection = content.createDiv({ cls: 'claudian-tool-input' });
    inputSection.createDiv({ cls: 'claudian-tool-section-label', text: 'Input' });
    const inputCode = inputSection.createEl('pre', { cls: 'claudian-tool-code' });
    inputCode.setText(this.formatToolInput(toolCall.name, toolCall.input));

    // Result placeholder
    const resultSection = content.createDiv({ cls: 'claudian-tool-result' });
    resultSection.createDiv({ cls: 'claudian-tool-section-label', text: 'Result' });
    const resultCode = resultSection.createEl('pre', { cls: 'claudian-tool-code claudian-tool-result-code' });
    resultCode.setText('Running...');

    // Toggle expand/collapse on header click
    header.addEventListener('click', () => {
      toolCall.isExpanded = !toolCall.isExpanded;
      if (toolCall.isExpanded) {
        content.style.display = 'block';
        toolEl.addClass('expanded');
        setIcon(chevron, 'chevron-down');
      } else {
        content.style.display = 'none';
        toolEl.removeClass('expanded');
        setIcon(chevron, 'chevron-right');
      }
    });
  }

  private updateToolCallResult(toolId: string, toolCall: ToolCallInfo) {
    const toolEl = this.toolCallElements.get(toolId);
    if (!toolEl) return;

    // Update status indicator
    const statusEl = toolEl.querySelector('.claudian-tool-status');
    if (statusEl) {
      statusEl.className = 'claudian-tool-status';
      statusEl.addClass(`status-${toolCall.status}`);
      statusEl.empty();
      if (toolCall.status === 'completed') {
        setIcon(statusEl as HTMLElement, 'check');
      } else if (toolCall.status === 'error') {
        setIcon(statusEl as HTMLElement, 'x');
      } else if (toolCall.status === 'blocked') {
        setIcon(statusEl as HTMLElement, 'shield-off');
      }
    }

    // Update result content
    const resultCode = toolEl.querySelector('.claudian-tool-result-code');
    if (resultCode && toolCall.result) {
      const truncated = this.truncateResult(toolCall.result);
      resultCode.setText(truncated);
    }
  }

  private setToolIcon(el: HTMLElement, name: string) {
    const iconMap: Record<string, string> = {
      'Read': 'file-text',
      'Write': 'edit-3',
      'Edit': 'edit',
      'Bash': 'terminal',
      'Glob': 'folder-search',
      'Grep': 'search',
      'LS': 'list',
    };
    setIcon(el, iconMap[name] || 'wrench');
  }

  private getToolLabel(name: string, input: Record<string, unknown>): string {
    switch (name) {
      case 'Read':
        return `Read ${this.shortenPath(input.file_path as string) || 'file'}`;
      case 'Write':
        return `Write ${this.shortenPath(input.file_path as string) || 'file'}`;
      case 'Edit':
        return `Edit ${this.shortenPath(input.file_path as string) || 'file'}`;
      case 'Bash':
        const cmd = (input.command as string) || 'command';
        return `Bash: ${cmd.length > 40 ? cmd.substring(0, 40) + '...' : cmd}`;
      case 'Glob':
        return `Glob: ${input.pattern || 'files'}`;
      case 'Grep':
        return `Grep: ${input.pattern || 'pattern'}`;
      case 'LS':
        return `LS: ${this.shortenPath(input.path as string) || '.'}`;
      default:
        return name;
    }
  }

  private shortenPath(path: string | undefined): string {
    if (!path) return '';
    const parts = path.split('/');
    if (parts.length <= 3) return path;
    return '.../' + parts.slice(-2).join('/');
  }

  private formatToolInput(name: string, input: Record<string, unknown>): string {
    // Format nicely based on tool type
    switch (name) {
      case 'Read':
      case 'Write':
      case 'Edit':
        return input.file_path as string || JSON.stringify(input, null, 2);
      case 'Bash':
        return (input.command as string) || JSON.stringify(input, null, 2);
      case 'Glob':
      case 'Grep':
        return (input.pattern as string) || JSON.stringify(input, null, 2);
      default:
        return JSON.stringify(input, null, 2);
    }
  }

  private truncateResult(result: string, maxLines = 20, maxLength = 2000): string {
    if (result.length > maxLength) {
      result = result.substring(0, maxLength) + '\n... (truncated)';
    }
    const lines = result.split('\n');
    if (lines.length > maxLines) {
      return lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines)`;
    }
    return result;
  }

  private isBlockedToolResult(content: string, isError?: boolean): boolean {
    const lower = content.toLowerCase();
    if (lower.includes('blocked by blocklist')) return true;
    if (lower.includes('outside the vault')) return true;
    if (lower.includes('access denied')) return true;
    if (lower.includes('user denied')) return true;
    if (lower.includes('approval')) return true;
    if (isError && lower.includes('deny')) return true;
    return false;
  }

  /**
   * Create a new conversation
   */
  private async createNewConversation() {
    if (this.isStreaming) {
      return; // Don't switch while streaming
    }

    // Save current conversation first (if has messages)
    if (this.messages.length > 0) {
      await this.saveCurrentConversation();
    }

    // Create new conversation
    const conversation = await this.plugin.createConversation();

    this.currentConversationId = conversation.id;
    this.messages = [];
    this.messagesEl.empty();

    // Reset session state for new conversation
    this.sessionStarted = false;
    this.lastSentFiles.clear();
    this.attachedFiles.clear();
    this.clearEditedFiles();

    // Auto-attach currently focused file for new sessions (skip if file has excluded tags)
    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (activeFile && !this.hasExcludedTag(activeFile)) {
      const normalizedPath = this.normalizePathForVault(activeFile.path);
      if (normalizedPath) {
        this.attachedFiles.add(normalizedPath);
      }
    }
    this.updateFileIndicator();
  }

  /**
   * Load the active conversation on view open
   */
  private async loadActiveConversation() {
    let conversation = this.plugin.getActiveConversation();
    const isNewConversation = !conversation;

    if (!conversation) {
      conversation = await this.plugin.createConversation();
    }

    this.currentConversationId = conversation.id;
    this.messages = [...conversation.messages];
    this.clearEditedFiles();

    // Restore session ID
    this.plugin.agentService.setSessionId(conversation.sessionId);

    // Handle session state
    this.lastSentFiles.clear();
    this.attachedFiles.clear();

    if (isNewConversation || this.messages.length === 0) {
      // New session - focus changes update attachment, auto-attach current file (skip if file has excluded tags)
      this.sessionStarted = false;
      const activeFile = this.plugin.app.workspace.getActiveFile();
      if (activeFile && !this.hasExcludedTag(activeFile)) {
        const normalizedPath = this.normalizePathForVault(activeFile.path);
        if (normalizedPath) {
          this.attachedFiles.add(normalizedPath);
        }
      }
    } else {
      // Existing session with messages - session already started
      this.sessionStarted = true;
      // User must @ mention to add files
    }
    this.updateFileIndicator();

    // Render all stored messages
    this.renderMessages();
  }

  /**
   * Switch to a different conversation
   */
  private async onConversationSelect(id: string) {
    if (id === this.currentConversationId) return;
    if (this.isStreaming) {
      return; // Don't switch while streaming
    }

    // Save current conversation first
    await this.saveCurrentConversation();

    // Switch to selected conversation
    const conversation = await this.plugin.switchConversation(id);
    if (!conversation) return;

    this.currentConversationId = conversation.id;
    this.messages = [...conversation.messages];
    this.clearEditedFiles();

    // Reset file context state for switched conversation
    this.lastSentFiles.clear();
    this.attachedFiles.clear();
    // Existing conversation = session started (user must @ mention)
    this.sessionStarted = this.messages.length > 0;
    this.updateFileIndicator();

    // Render messages
    this.renderMessages();

    // Close dropdown
    this.historyDropdown?.removeClass('visible');
  }

  /**
   * Save current conversation state
   */
  private async saveCurrentConversation() {
    if (!this.currentConversationId) return;

    const sessionId = this.plugin.agentService.getSessionId();
    await this.plugin.updateConversation(this.currentConversationId, {
      messages: this.messages,
      sessionId: sessionId,
    });
  }

  /**
   * Render all messages for a loaded conversation
   */
  private renderMessages() {
    this.messagesEl.empty();

    for (const msg of this.messages) {
      this.renderStoredMessage(msg);
    }

    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  /**
   * Render a stored message (non-streaming)
   */
  private renderStoredMessage(msg: ChatMessage) {
    const msgEl = this.messagesEl.createDiv({
      cls: `claudian-message claudian-message-${msg.role}`,
    });

    const contentEl = msgEl.createDiv({ cls: 'claudian-message-content' });

    if (msg.role === 'user') {
      const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });
      this.renderContent(textEl, msg.content);
    } else if (msg.role === 'assistant') {
      // Use contentBlocks for proper ordering if available
      if (msg.contentBlocks && msg.contentBlocks.length > 0) {
        for (const block of msg.contentBlocks) {
          if (block.type === 'thinking') {
            this.renderStoredThinkingBlock(contentEl, block.content, block.durationSeconds);
          } else if (block.type === 'text') {
            const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });
            this.renderContent(textEl, block.content);
          } else if (block.type === 'tool_use' && this.plugin.settings.showToolUse) {
            const toolCall = msg.toolCalls?.find(tc => tc.id === block.toolId);
            if (toolCall) {
              this.renderStoredToolCall(contentEl, toolCall);
            }
          }
        }
      } else {
        // Fallback for old conversations without contentBlocks
        if (msg.content) {
          const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });
          this.renderContent(textEl, msg.content);
        }
        if (msg.toolCalls && this.plugin.settings.showToolUse) {
          for (const toolCall of msg.toolCalls) {
            this.renderStoredToolCall(contentEl, toolCall);
          }
        }
      }
    }
  }

  /**
   * Render a stored tool call (completed state)
   */
  private renderStoredToolCall(parentEl: HTMLElement, toolCall: ToolCallInfo) {
    const toolEl = parentEl.createDiv({ cls: 'claudian-tool-call' });

    // Header
    const header = toolEl.createDiv({ cls: 'claudian-tool-header' });

    // Chevron icon
    const chevron = header.createSpan({ cls: 'claudian-tool-chevron' });
    setIcon(chevron, 'chevron-right');

    // Tool icon
    const iconEl = header.createSpan({ cls: 'claudian-tool-icon' });
    this.setToolIcon(iconEl, toolCall.name);

    // Tool label
    const labelEl = header.createSpan({ cls: 'claudian-tool-label' });
    labelEl.setText(this.getToolLabel(toolCall.name, toolCall.input));

    // Status indicator (already completed)
    const statusEl = header.createSpan({ cls: 'claudian-tool-status' });
    statusEl.addClass(`status-${toolCall.status}`);
    if (toolCall.status === 'completed') {
      setIcon(statusEl, 'check');
    } else if (toolCall.status === 'error') {
      setIcon(statusEl, 'x');
    } else if (toolCall.status === 'blocked') {
      setIcon(statusEl, 'shield-off');
    }

    // Collapsible content
    const content = toolEl.createDiv({ cls: 'claudian-tool-content' });
    content.style.display = 'none';

    // Input parameters
    const inputSection = content.createDiv({ cls: 'claudian-tool-input' });
    inputSection.createDiv({ cls: 'claudian-tool-section-label', text: 'Input' });
    const inputCode = inputSection.createEl('pre', { cls: 'claudian-tool-code' });
    inputCode.setText(this.formatToolInput(toolCall.name, toolCall.input));

    // Result
    const resultSection = content.createDiv({ cls: 'claudian-tool-result' });
    resultSection.createDiv({ cls: 'claudian-tool-section-label', text: 'Result' });
    const resultCode = resultSection.createEl('pre', { cls: 'claudian-tool-code' });
    resultCode.setText(toolCall.result ? this.truncateResult(toolCall.result) : 'No result');

    // Toggle expand/collapse on header click
    let isExpanded = false;
    header.addEventListener('click', () => {
      isExpanded = !isExpanded;
      if (isExpanded) {
        content.style.display = 'block';
        toolEl.addClass('expanded');
        setIcon(chevron, 'chevron-down');
      } else {
        content.style.display = 'none';
        toolEl.removeClass('expanded');
        setIcon(chevron, 'chevron-right');
      }
    });
  }

  /**
   * Render a stored thinking block (non-streaming)
   */
  private renderStoredThinkingBlock(parentEl: HTMLElement, content: string, durationSeconds?: number) {
    const thinkingWrapper = parentEl.createDiv({ cls: 'claudian-thinking-block' });

    // Header (clickable to expand/collapse)
    const header = thinkingWrapper.createDiv({ cls: 'claudian-thinking-header' });

    // Chevron icon
    const chevron = header.createSpan({ cls: 'claudian-thinking-chevron' });
    setIcon(chevron, 'chevron-right');

    // Brain icon
    const iconEl = header.createSpan({ cls: 'claudian-thinking-icon' });
    setIcon(iconEl, 'brain');

    // Label with duration
    const labelEl = header.createSpan({ cls: 'claudian-thinking-label' });
    const labelText = durationSeconds !== undefined ? `Thought for ${durationSeconds}s` : 'Thinking';
    labelEl.setText(labelText);

    // Collapsible content (starts collapsed)
    const contentEl = thinkingWrapper.createDiv({ cls: 'claudian-thinking-content' });
    contentEl.style.display = 'none';
    this.renderContent(contentEl, content);

    // Toggle expand/collapse on header click
    let isExpanded = false;
    header.addEventListener('click', () => {
      isExpanded = !isExpanded;
      if (isExpanded) {
        contentEl.style.display = 'block';
        thinkingWrapper.addClass('expanded');
        setIcon(chevron, 'chevron-down');
      } else {
        contentEl.style.display = 'none';
        thinkingWrapper.removeClass('expanded');
        setIcon(chevron, 'chevron-right');
      }
    });
  }

  /**
   * Toggle history dropdown visibility
   */
  private toggleHistoryDropdown() {
    if (!this.historyDropdown) return;

    const isVisible = this.historyDropdown.hasClass('visible');
    if (isVisible) {
      this.historyDropdown.removeClass('visible');
    } else {
      this.updateHistoryDropdown();
      this.historyDropdown.addClass('visible');
    }
  }

  /**
   * Update history dropdown content
   */
  private updateHistoryDropdown() {
    if (!this.historyDropdown) return;

    this.historyDropdown.empty();

    // Header
    const dropdownHeader = this.historyDropdown.createDiv({ cls: 'claudian-history-header' });
    dropdownHeader.createSpan({ text: 'Conversations' });

    // Conversation list (exclude current session)
    const list = this.historyDropdown.createDiv({ cls: 'claudian-history-list' });
    const conversations = this.plugin.getConversationList()
      .filter(conv => conv.id !== this.currentConversationId);

    if (conversations.length === 0) {
      list.createDiv({ cls: 'claudian-history-empty', text: 'No other conversations' });
      return;
    }

    for (const conv of conversations) {
      const item = list.createDiv({ cls: 'claudian-history-item' });

      // Icon
      const iconEl = item.createDiv({ cls: 'claudian-history-item-icon' });
      setIcon(iconEl, 'message-square');

      // Content area (clickable to switch)
      const content = item.createDiv({ cls: 'claudian-history-item-content' });
      content.createDiv({ cls: 'claudian-history-item-title', text: conv.title });
      content.createDiv({
        cls: 'claudian-history-item-date',
        text: this.formatDate(conv.updatedAt),
      });

      content.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.onConversationSelect(conv.id);
      });

      // Action buttons
      const actions = item.createDiv({ cls: 'claudian-history-item-actions' });

      const renameBtn = actions.createEl('button', { cls: 'claudian-action-btn' });
      setIcon(renameBtn, 'pencil');
      renameBtn.setAttribute('aria-label', 'Rename');
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showRenameInput(item, conv.id, conv.title);
      });

      const deleteBtn = actions.createEl('button', { cls: 'claudian-action-btn claudian-delete-btn' });
      setIcon(deleteBtn, 'trash-2');
      deleteBtn.setAttribute('aria-label', 'Delete');
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (this.isStreaming) {
          return;
        }
        await this.plugin.deleteConversation(conv.id);
        this.updateHistoryDropdown();

        // If deleted current, reload the new active
        if (conv.id === this.currentConversationId) {
          await this.loadActiveConversation();
        }
      });
    }
  }

  /**
   * Show inline rename input
   */
  private showRenameInput(item: HTMLElement, convId: string, currentTitle: string) {
    const titleEl = item.querySelector('.claudian-history-item-title') as HTMLElement;
    if (!titleEl) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'claudian-rename-input';
    input.value = currentTitle;

    titleEl.replaceWith(input);
    input.focus();
    input.select();

    const finishRename = async () => {
      const newTitle = input.value.trim() || currentTitle;
      await this.plugin.renameConversation(convId, newTitle);

      // Update dropdown
      this.updateHistoryDropdown();
    };

    input.addEventListener('blur', finishRename);
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        input.blur();
      } else if (e.key === 'Escape') {
        input.value = currentTitle;
        input.blur();
      }
    });
  }

  /**
   * Generate title from first user message
   */
  private generateTitle(firstMessage: string): string {
    // Extract first sentence or first 50 chars
    const firstSentence = firstMessage.split(/[.!?\n]/)[0].trim();
    const autoTitle = firstSentence.substring(0, 50);
    const suffix = firstSentence.length > 50 ? '...' : '';

    return `${autoTitle}${suffix}`;
  }

  /**
   * Format date for display
   */
  private formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();

    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /**
   * Normalize a file path to be vault-relative with forward slashes
   */
  private normalizePathForVault(rawPath: string | undefined | null): string | null {
    if (!rawPath) return null;

    // Normalize separators first
    const unixPath = rawPath.replace(/\\/g, '/');
    const vaultPath = getVaultPath(this.plugin.app);

    if (vaultPath) {
      const normalizedVault = vaultPath.replace(/\\/g, '/').replace(/\/+$/, '');
      if (unixPath.startsWith(normalizedVault)) {
        const relative = unixPath.slice(normalizedVault.length).replace(/^\/+/, '');
        if (relative) {
          return relative;
        }
      }
    }

    return unixPath.replace(/^\/+/, '');
  }

  // ============================================
  // File Context Methods
  // ============================================

  /**
   * Check if attached files have changed since last sent
   */
  private hasFilesChanged(currentFiles: string[]): boolean {
    if (currentFiles.length !== this.lastSentFiles.size) return true;
    for (const file of currentFiles) {
      if (!this.lastSentFiles.has(file)) return true;
    }
    return false;
  }

  /**
   * Update the file indicator UI to show attached files
   */
  private updateFileIndicator() {
    if (!this.fileIndicatorEl) return;

    this.fileIndicatorEl.empty();

    if (this.attachedFiles.size === 0) {
      this.fileIndicatorEl.style.display = 'none';
      this.updateEditedFilesIndicator();
      return;
    }

    this.fileIndicatorEl.style.display = 'flex';

    for (const path of this.attachedFiles) {
      this.renderFileChip(path, () => {
        this.attachedFiles.delete(path);
        this.updateFileIndicator();
      });
    }

    // Keep edited files indicator in sync with attachment changes
    this.updateEditedFilesIndicator();
  }

  /**
   * Render a file chip in the indicator
   */
  private renderFileChip(path: string, onRemove: () => void) {
    if (!this.fileIndicatorEl) return;

    const chipEl = this.fileIndicatorEl.createDiv({ cls: 'claudian-file-chip' });

    // Add edited class if file was edited this session
    if (this.isFileEdited(path)) {
      chipEl.addClass('claudian-file-chip-edited');
    }

    const iconEl = chipEl.createSpan({ cls: 'claudian-file-chip-icon' });
    setIcon(iconEl, 'file-text');

    // Extract filename from path
    const filename = path.split('/').pop() || path;
    const nameEl = chipEl.createSpan({ cls: 'claudian-file-chip-name' });
    nameEl.setText(filename);
    nameEl.setAttribute('title', path); // Show full path on hover

    const removeEl = chipEl.createSpan({ cls: 'claudian-file-chip-remove' });
    removeEl.setText('\u00D7'); // × symbol
    removeEl.setAttribute('aria-label', 'Remove');

    // Click chip to open file (but not remove button)
    chipEl.addEventListener('click', async (e) => {
      if ((e.target as HTMLElement).closest('.claudian-file-chip-remove')) return;
      await this.openFileFromChip(path);
    });

    removeEl.addEventListener('click', (e) => {
      e.stopPropagation();
      onRemove();
    });
  }

  // ============================================
  // Edited Files Methods
  // ============================================

  /**
   * Track a file as edited when Write/Edit tool completes successfully
   */
  private trackEditedFile(toolName: string | undefined, toolInput: Record<string, unknown> | undefined, isError: boolean) {
    // Only track Write, Edit, NotebookEdit tools
    if (!toolName || !['Write', 'Edit', 'NotebookEdit'].includes(toolName)) return;

    // Don't track if there was an error
    if (isError) return;

    // Extract file path from tool input
    const rawPath = (toolInput?.file_path as string) || (toolInput?.notebook_path as string);
    const filePath = this.normalizePathForVault(rawPath);
    if (!filePath) return;

    this.editedFilesThisSession.add(filePath);
    this.updateEditedFilesIndicator();
    // Re-render attachment chips to show edited border if file is attached
    this.updateFileIndicator();
  }

  /**
   * Clear all tracked edited files (called on new session)
   */
  private clearEditedFiles() {
    this.editedFilesThisSession.clear();
    this.updateEditedFilesIndicator();
    this.updateFileIndicator();
  }

  /**
   * Dismiss a single edited file (called when file is focused)
   * Removes the border indicator and removes from "Edited:" section if not attached
   */
  private dismissEditedFile(path: string) {
    const normalizedPath = this.normalizePathForVault(path);
    if (normalizedPath && this.editedFilesThisSession.has(normalizedPath)) {
      this.editedFilesThisSession.delete(normalizedPath);
      this.updateEditedFilesIndicator();
      this.updateFileIndicator();
    }
  }

  /**
   * Check if a file was edited this session
   */
  private isFileEdited(path: string): boolean {
    const normalizedPath = this.normalizePathForVault(path);
    if (!normalizedPath) return false;
    return this.editedFilesThisSession.has(normalizedPath);
  }

  /**
   * Get edited files that are NOT in the attached files list
   */
  private getNonAttachedEditedFiles(): string[] {
    return [...this.editedFilesThisSession].filter(path => !this.attachedFiles.has(path));
  }

  /**
   * Check if the edited files section should be shown
   */
  private shouldShowEditedFilesSection(): boolean {
    return this.getNonAttachedEditedFiles().length > 0;
  }

  /**
   * Open a file from a chip click
   */
  private async openFileFromChip(path: string) {
    const normalizedPath = this.normalizePathForVault(path);
    if (!normalizedPath) return;

    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf('tab').openFile(file);
    }
  }

  /**
   * Update the edited files indicator UI
   */
  private updateEditedFilesIndicator() {
    if (!this.editedFilesIndicatorEl) return;

    this.editedFilesIndicatorEl.empty();

    if (!this.shouldShowEditedFilesSection()) {
      this.editedFilesIndicatorEl.style.display = 'none';
      return;
    }

    this.editedFilesIndicatorEl.style.display = 'flex';

    // Add label
    const label = this.editedFilesIndicatorEl.createSpan({ cls: 'claudian-edited-label' });
    label.setText('Edited:');

    // Render chips for non-attached edited files
    for (const path of this.getNonAttachedEditedFiles()) {
      this.renderEditedFileChip(path);
    }
  }

  /**
   * Render an edited file chip (clickable, no remove button)
   */
  private renderEditedFileChip(path: string) {
    if (!this.editedFilesIndicatorEl) return;

    const chipEl = this.editedFilesIndicatorEl.createDiv({ cls: 'claudian-file-chip claudian-file-chip-edited' });

    const iconEl = chipEl.createSpan({ cls: 'claudian-file-chip-icon' });
    setIcon(iconEl, 'file-text');

    // Extract filename from path
    const filename = path.split('/').pop() || path;
    const nameEl = chipEl.createSpan({ cls: 'claudian-file-chip-name' });
    nameEl.setText(filename);
    nameEl.setAttribute('title', path);

    // Click to open
    chipEl.addEventListener('click', async () => {
      await this.openFileFromChip(path);
    });
  }

  // ============================================
  // @ Mention Methods
  // ============================================

  /**
   * Handle input changes to detect @ mentions
   */
  private handleInputChange() {
    const text = this.inputEl.value;
    const cursorPos = this.inputEl.selectionStart || 0;

    // Find the last @ before cursor
    const textBeforeCursor = text.substring(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex === -1) {
      this.hideMentionDropdown();
      return;
    }

    // Check if @ is at start or after whitespace (valid trigger)
    const charBeforeAt = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
    if (!/\s/.test(charBeforeAt) && lastAtIndex !== 0) {
      this.hideMentionDropdown();
      return;
    }

    // Extract search text after @
    const searchText = textBeforeCursor.substring(lastAtIndex + 1);

    // Check if search text contains newlines (closed mention)
    if (/[\n]/.test(searchText)) {
      this.hideMentionDropdown();
      return;
    }

    this.mentionStartIndex = lastAtIndex;
    this.showMentionDropdown(searchText);
  }

  /**
   * Show the mention dropdown with filtered files
   */
  private showMentionDropdown(searchText: string) {
    // Get all markdown files (cached)
    const allFiles = this.getCachedMarkdownFiles();

    // Filter by search text
    const searchLower = searchText.toLowerCase();
    this.filteredFiles = allFiles
      .filter(file => {
        const pathLower = file.path.toLowerCase();
        const nameLower = file.name.toLowerCase();
        return pathLower.includes(searchLower) || nameLower.includes(searchLower);
      })
      .sort((a, b) => {
        // Prioritize name matches over path matches
        const aNameMatch = a.name.toLowerCase().startsWith(searchLower);
        const bNameMatch = b.name.toLowerCase().startsWith(searchLower);
        if (aNameMatch && !bNameMatch) return -1;
        if (!aNameMatch && bNameMatch) return 1;
        // Then sort by modification time (recent first)
        return b.stat.mtime - a.stat.mtime;
      })
      .slice(0, 10); // Limit to 10 results

    this.selectedMentionIndex = 0;
    this.renderMentionDropdown();
  }

  private getCachedMarkdownFiles(): TFile[] {
    if (this.filesCacheDirty || this.cachedMarkdownFiles.length === 0) {
      this.cachedMarkdownFiles = this.plugin.app.vault.getMarkdownFiles();
      this.filesCacheDirty = false;
    }
    return this.cachedMarkdownFiles;
  }

  private markFilesCacheDirty() {
    this.filesCacheDirty = true;
  }

  /**
   * Check if a file has any excluded tags (from settings)
   * Checks both frontmatter tags and inline tags
   */
  private hasExcludedTag(file: TFile): boolean {
    const excludedTags = this.plugin.settings.excludedTags;
    if (excludedTags.length === 0) return false;

    const cache = this.plugin.app.metadataCache.getFileCache(file);
    if (!cache) return false;

    // Collect all tags from the file
    const fileTags: string[] = [];

    // Frontmatter tags (cache.frontmatter?.tags)
    if (cache.frontmatter?.tags) {
      const fmTags = cache.frontmatter.tags;
      if (Array.isArray(fmTags)) {
        fileTags.push(...fmTags.map((t: string) => t.replace(/^#/, '')));
      } else if (typeof fmTags === 'string') {
        fileTags.push(fmTags.replace(/^#/, ''));
      }
    }

    // Inline tags (cache.tags)
    if (cache.tags) {
      fileTags.push(...cache.tags.map(t => t.tag.replace(/^#/, '')));
    }

    // Check if any file tag matches an excluded tag
    return fileTags.some(tag => excludedTags.includes(tag));
  }

  /**
   * Render the mention dropdown
   */
  private renderMentionDropdown() {
    if (!this.mentionDropdown) {
      this.mentionDropdown = this.inputContainerEl!.createDiv({ cls: 'claudian-mention-dropdown' });
    }

    this.mentionDropdown.empty();

    if (this.filteredFiles.length === 0) {
      const emptyEl = this.mentionDropdown.createDiv({ cls: 'claudian-mention-empty' });
      emptyEl.setText('No matching files');
    } else {
      for (let i = 0; i < this.filteredFiles.length; i++) {
        const file = this.filteredFiles[i];
        const itemEl = this.mentionDropdown.createDiv({ cls: 'claudian-mention-item' });

        if (i === this.selectedMentionIndex) {
          itemEl.addClass('selected');
        }

        const iconEl = itemEl.createSpan({ cls: 'claudian-mention-icon' });
        setIcon(iconEl, 'file-text');

        const pathEl = itemEl.createSpan({ cls: 'claudian-mention-path' });
        pathEl.setText(file.path);

        itemEl.addEventListener('click', () => {
          this.selectedMentionIndex = i;
          this.selectMentionItem();
        });

        itemEl.addEventListener('mouseenter', () => {
          this.selectedMentionIndex = i;
          this.updateMentionSelection();
        });
      }
    }

    this.mentionDropdown.addClass('visible');
  }

  /**
   * Navigate the mention dropdown with arrow keys
   */
  private navigateMentionDropdown(direction: number) {
    const maxIndex = this.filteredFiles.length - 1;
    this.selectedMentionIndex = Math.max(0, Math.min(maxIndex, this.selectedMentionIndex + direction));
    this.updateMentionSelection();
  }

  /**
   * Update the visual selection in the dropdown
   */
  private updateMentionSelection() {
    const items = this.mentionDropdown?.querySelectorAll('.claudian-mention-item');
    items?.forEach((item, index) => {
      if (index === this.selectedMentionIndex) {
        item.addClass('selected');
        (item as HTMLElement).scrollIntoView({ block: 'nearest' });
      } else {
        item.removeClass('selected');
      }
    });
  }

  /**
   * Select the current mention item
   */
  private selectMentionItem() {
    if (this.filteredFiles.length === 0) return;

    const selectedFile = this.filteredFiles[this.selectedMentionIndex];
    if (!selectedFile) return;

    // Add to attached files
    const normalizedPath = this.normalizePathForVault(selectedFile.path);
    if (normalizedPath) {
      this.attachedFiles.add(normalizedPath);
    }

    // Replace @search text with @filename in input
    const text = this.inputEl.value;
    const beforeAt = text.substring(0, this.mentionStartIndex);
    const afterCursor = text.substring(this.inputEl.selectionStart || 0);
    const filename = selectedFile.name;
    const replacement = `@${filename} `;
    this.inputEl.value = beforeAt + replacement + afterCursor;
    this.inputEl.selectionStart = this.inputEl.selectionEnd = beforeAt.length + replacement.length;

    this.hideMentionDropdown();
    this.updateFileIndicator();
    this.inputEl.focus();
  }

  /**
   * Hide the mention dropdown
   */
  private hideMentionDropdown() {
    this.mentionDropdown?.removeClass('visible');
    this.mentionStartIndex = -1;
  }

  // ============================================
  // Model Selector Methods
  // ============================================

  private createModelSelector(parentEl: HTMLElement) {
    const container = parentEl.createDiv({ cls: 'claudian-model-selector' });

    // Current model button (display only, dropdown shows on hover via CSS)
    this.modelSelectorEl = container.createDiv({ cls: 'claudian-model-btn' });
    this.updateModelDisplay();

    // Dropdown menu (shown on hover via CSS)
    this.modelDropdownEl = container.createDiv({ cls: 'claudian-model-dropdown' });
    this.renderModelOptions();
  }

  private updateModelDisplay() {
    if (!this.modelSelectorEl) return;
    const currentModel = this.plugin.settings.model;
    const modelInfo = CLAUDE_MODELS.find(m => m.value === currentModel);
    this.modelSelectorEl.empty();

    const labelEl = this.modelSelectorEl.createSpan({ cls: 'claudian-model-label' });
    labelEl.setText(modelInfo?.label || 'Haiku');

    const chevronEl = this.modelSelectorEl.createSpan({ cls: 'claudian-model-chevron' });
    setIcon(chevronEl, 'chevron-up');
  }

  private renderModelOptions() {
    if (!this.modelDropdownEl) return;
    this.modelDropdownEl.empty();

    for (const model of CLAUDE_MODELS) {
      const option = this.modelDropdownEl.createDiv({ cls: 'claudian-model-option' });
      if (model.value === this.plugin.settings.model) {
        option.addClass('selected');
      }

      option.createSpan({ text: model.label });

      option.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.selectModel(model.value);
      });
    }
  }

  private async selectModel(model: ClaudeModel) {
    this.plugin.settings.model = model;
    // Update thinking budget to default for the selected model
    this.plugin.settings.thinkingBudget = DEFAULT_THINKING_BUDGET[model];
    await this.plugin.saveSettings();
    this.updateModelDisplay();
    this.updateThinkingBudgetDisplay();
    this.renderModelOptions(); // Refresh selection state
  }

  // ============================================
  // Thinking Budget Selector Methods
  // ============================================

  private createThinkingBudgetSelector(parentEl: HTMLElement) {
    const container = parentEl.createDiv({ cls: 'claudian-thinking-selector' });

    // Label
    const labelEl = container.createSpan({ cls: 'claudian-thinking-label-text' });
    labelEl.setText('Thinking:');

    // Gear buttons container (expandable on hover)
    this.thinkingBudgetEl = container.createDiv({ cls: 'claudian-thinking-gears' });
    this.renderThinkingBudgetGears();
  }

  private renderThinkingBudgetGears() {
    if (!this.thinkingBudgetEl) return;
    this.thinkingBudgetEl.empty();

    const currentBudget = this.plugin.settings.thinkingBudget;
    const currentBudgetInfo = THINKING_BUDGETS.find(b => b.value === currentBudget);

    // Current selection (visible when collapsed)
    const currentEl = this.thinkingBudgetEl.createDiv({ cls: 'claudian-thinking-current' });
    currentEl.setText(currentBudgetInfo?.label || 'Off');

    // All options (visible when expanded)
    const optionsEl = this.thinkingBudgetEl.createDiv({ cls: 'claudian-thinking-options' });

    for (const budget of THINKING_BUDGETS) {
      const gearEl = optionsEl.createDiv({ cls: 'claudian-thinking-gear' });
      gearEl.setText(budget.label);
      gearEl.setAttribute('title', budget.tokens > 0 ? `${budget.tokens.toLocaleString()} tokens` : 'Disabled');

      if (budget.value === currentBudget) {
        gearEl.addClass('selected');
      }

      gearEl.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.selectThinkingBudget(budget.value);
      });
    }
  }

  private updateThinkingBudgetDisplay() {
    this.renderThinkingBudgetGears();
  }

  private async selectThinkingBudget(budget: ThinkingBudget) {
    this.plugin.settings.thinkingBudget = budget;
    await this.plugin.saveSettings();
    this.updateThinkingBudgetDisplay();
  }

  // ============================================
  // Permission Mode Toggle Methods
  // ============================================

  private createPermissionToggle(parentEl: HTMLElement) {
    const container = parentEl.createDiv({ cls: 'claudian-permission-toggle' });

    // Label
    this.permissionLabelEl = container.createSpan({ cls: 'claudian-permission-label' });

    // Toggle switch
    this.permissionToggleEl = container.createDiv({ cls: 'claudian-toggle-switch' });

    // Update display
    this.updatePermissionToggle();

    // Toggle on click
    this.permissionToggleEl.addEventListener('click', () => this.togglePermissionMode());
  }

  private updatePermissionToggle() {
    if (!this.permissionToggleEl || !this.permissionLabelEl) return;

    const isYolo = this.plugin.settings.permissionMode === 'yolo';

    // Update toggle state
    if (isYolo) {
      this.permissionToggleEl.addClass('active');
    } else {
      this.permissionToggleEl.removeClass('active');
    }

    // Update label
    this.permissionLabelEl.setText(isYolo ? 'Yolo' : 'Safe');
  }

  private async togglePermissionMode() {
    const current = this.plugin.settings.permissionMode;
    this.plugin.settings.permissionMode = current === 'yolo' ? 'normal' : 'yolo';
    await this.plugin.saveSettings();
    this.updatePermissionToggle();
  }

  private generateId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  // ============================================
  // Approval Dialog Methods
  // ============================================

  /**
   * Handle approval request from the service
   */
  private async handleApprovalRequest(
    toolName: string,
    input: Record<string, unknown>,
    description: string
  ): Promise<'allow' | 'allow-always' | 'deny'> {
    return new Promise((resolve) => {
      const modal = new ApprovalModal(this.plugin.app, toolName, input, description, resolve);
      modal.open();
    });
  }
}

/**
 * Modal for approving tool actions
 */
class ApprovalModal extends Modal {
  private toolName: string;
  private input: Record<string, unknown>;
  private description: string;
  private resolve: (value: 'allow' | 'allow-always' | 'deny') => void;
  private resolved = false;

  constructor(
    app: import('obsidian').App,
    toolName: string,
    input: Record<string, unknown>,
    description: string,
    resolve: (value: 'allow' | 'allow-always' | 'deny') => void
  ) {
    super(app);
    this.toolName = toolName;
    this.input = input;
    this.description = description;
    this.resolve = resolve;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('claudian-approval-modal');

    // Title
    contentEl.createEl('h2', { text: 'Permission Required', cls: 'claudian-approval-title' });

    // Tool info
    const infoEl = contentEl.createDiv({ cls: 'claudian-approval-info' });

    const toolEl = infoEl.createDiv({ cls: 'claudian-approval-tool' });
    const iconEl = toolEl.createSpan({ cls: 'claudian-approval-icon' });
    setIcon(iconEl, this.getToolIcon(this.toolName));
    toolEl.createSpan({ text: this.toolName, cls: 'claudian-approval-tool-name' });

    // Description
    const descEl = contentEl.createDiv({ cls: 'claudian-approval-desc' });
    descEl.setText(this.description);

    // Details (collapsible)
    const detailsEl = contentEl.createEl('details', { cls: 'claudian-approval-details' });
    detailsEl.createEl('summary', { text: 'Show details' });
    const codeEl = detailsEl.createEl('pre', { cls: 'claudian-approval-code' });
    codeEl.setText(JSON.stringify(this.input, null, 2));

    // Buttons
    const buttonsEl = contentEl.createDiv({ cls: 'claudian-approval-buttons' });

    const denyBtn = buttonsEl.createEl('button', { text: 'Deny', cls: 'claudian-approval-btn claudian-deny-btn' });
    denyBtn.addEventListener('click', () => this.handleDecision('deny'));

    const allowBtn = buttonsEl.createEl('button', { text: 'Allow Once', cls: 'claudian-approval-btn claudian-allow-btn' });
    allowBtn.addEventListener('click', () => this.handleDecision('allow'));

    const alwaysBtn = buttonsEl.createEl('button', { text: 'Always Allow', cls: 'claudian-approval-btn claudian-always-btn' });
    alwaysBtn.addEventListener('click', () => this.handleDecision('allow-always'));
  }

  private getToolIcon(toolName: string): string {
    const iconMap: Record<string, string> = {
      'Read': 'file-text',
      'Write': 'edit-3',
      'Edit': 'edit',
      'Bash': 'terminal',
      'Glob': 'folder-search',
      'Grep': 'search',
      'LS': 'list',
    };
    return iconMap[toolName] || 'wrench';
  }

  private handleDecision(decision: 'allow' | 'allow-always' | 'deny') {
    if (!this.resolved) {
      this.resolved = true;
      this.resolve(decision);
      this.close();
    }
  }

  onClose() {
    // If closed without decision, treat as deny
    if (!this.resolved) {
      this.resolved = true;
      this.resolve('deny');
    }
    this.contentEl.empty();
  }
}
