/**
 * OpenCode - Input toolbar components (model selector, variant selector, permission toggle).
 */

import { Notice, setIcon } from 'obsidian';

import type { McpService } from '../../../core/mcp/McpService';
import type {
  ClaudeModel,
  ClaudianMcpServer,
  PermissionMode,
  ThinkingBudget,
  UsageInfo
} from '../../../core/types';
import {
  DEFAULT_CLAUDE_MODELS,
  THINKING_BUDGETS
} from '../../../core/types';
import { CHECK_ICON_SVG, MCP_ICON_SVG } from '../../../shared/icons';
import { getModelsFromEnvironment, parseEnvironmentVariables } from '../../../utils/env';
import { filterValidPaths, findConflictingPath, isDuplicatePath, isValidDirectoryPath } from '../../../utils/externalContext';

/** Settings access interface for toolbar components. */
export interface ToolbarSettings {
  model: ClaudeModel;
  thinkingBudget: ThinkingBudget;
  permissionMode: PermissionMode;
  show1MModel?: boolean;
  agentBackend?: 'claude-code' | 'opencode';
  opencodeModels?: Array<{
    value: string;
    label: string;
    description: string;
    provider: string;
    modelId: string;
    reasoning: boolean;
    temperature: boolean;
  }>;
  opencodeAgents?: Array<{
    value: string;
    name: string;
    description: string;
  }>;
  currentAgent?: string;
}

/** Callback interface for toolbar changes. */
export interface ToolbarCallbacks {
  onModelChange: (model: ClaudeModel) => Promise<void>;
  onThinkingBudgetChange: (budget: ThinkingBudget) => Promise<void>;
  onPermissionModeChange: (mode: PermissionMode) => Promise<void>;
  onAgentChange?: (agent: string) => Promise<void>;
  onImageUploadClick?: () => void;
  onSendClick?: () => void;
  getSettings: () => ToolbarSettings;
  getEnvironmentVariables?: () => string;
}

/** Model selector dropdown component. */
export class ModelSelector {
  private container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'opencode-model-selector' });
    this.render();
  }

  /** Returns available models (custom from env vars, OpenCode, or defaults). */
  private getAvailableModels() {
    const settings = this.callbacks.getSettings();

    // Use OpenCode models if backend is OpenCode and models are cached
    if (settings.agentBackend === 'opencode' && settings.opencodeModels && settings.opencodeModels.length > 0) {
      return settings.opencodeModels;
    }

    // Fall back to environment or default models
    let models: { value: string; label: string; description: string }[] = [];

    if (this.callbacks.getEnvironmentVariables) {
      const envVarsStr = this.callbacks.getEnvironmentVariables();
      const envVars = parseEnvironmentVariables(envVarsStr);
      const customModels = getModelsFromEnvironment(envVars);

      if (customModels.length > 0) {
        models = customModels;
      } else {
        models = [...DEFAULT_CLAUDE_MODELS];
      }
    } else {
      models = [...DEFAULT_CLAUDE_MODELS];
    }

    // When 1M context is enabled, update sonnet label to show "(1M)"
    if (settings.show1MModel) {
      models = models.map(m =>
        m.value === 'sonnet' ? { ...m, label: 'Sonnet (1M)' } : m
      );
    }

    return models;
  }

  private render() {
    this.container.empty();

    this.buttonEl = this.container.createDiv({ cls: 'opencode-model-btn' });
    this.updateDisplay();

    this.dropdownEl = this.container.createDiv({ cls: 'opencode-model-dropdown' });
    this.renderOptions();
  }

  updateDisplay() {
    if (!this.buttonEl) return;
    const currentModel = this.callbacks.getSettings().model;
    const models = this.getAvailableModels();
    const modelInfo = models.find(m => m.value === currentModel);

    const displayModel = modelInfo || models[0];

    this.buttonEl.empty();

    const labelEl = this.buttonEl.createSpan({ cls: 'opencode-model-label' });
    labelEl.setText(displayModel?.label || 'Unknown');
  }

  renderOptions() {
    if (!this.dropdownEl) return;
    this.dropdownEl.empty();

    const currentModel = this.callbacks.getSettings().model;
    const models = this.getAvailableModels();

    for (const model of [...models].reverse()) {
      const option = this.dropdownEl.createDiv({ cls: 'opencode-model-option' });
      if (model.value === currentModel) {
        option.addClass('selected');
      }

      option.createSpan({ text: model.label });
      if (model.description) {
        option.setAttribute('title', model.description);
      }

      option.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.callbacks.onModelChange(model.value);
        this.updateDisplay();
        this.renderOptions();
      });
    }
  }
}

/** OpenCode provider/model selector component (replaces ModelSelector for OpenCode). */
export class ProviderModelSelector {
  private container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'opencode-provider-model-selector' });
    this.render();
  }

  private render() {
    this.container.empty();

    this.buttonEl = this.container.createDiv({ cls: 'opencode-provider-model-btn' });
    this.updateDisplay();

    this.dropdownEl = this.container.createDiv({ cls: 'opencode-provider-model-dropdown' });
    this.renderOptions();
  }

  private getProviderModels(): Array<{
    value: string;
    label: string;
    provider: string;
    providerLabel: string;
    description: string;
  }> {
    const settings = this.callbacks.getSettings();

    if (settings.agentBackend === 'opencode' && settings.opencodeModels && settings.opencodeModels.length > 0) {
      return settings.opencodeModels.map(m => ({
        value: m.value,
        label: m.label,
        provider: m.provider,
        providerLabel: m.provider.charAt(0).toUpperCase() + m.provider.slice(1),
        description: m.description,
      }));
    }

    return [];
  }

  updateDisplay() {
    if (!this.buttonEl) return;
    const settings = this.callbacks.getSettings();
    const models = this.getProviderModels();
    const currentModel = models.find(m => m.value === settings.model);
    const displayModel = currentModel || models[0];

    this.buttonEl.empty();

    // Provider label (left side)
    const providerEl = this.buttonEl.createSpan({ cls: 'opencode-provider-label' });
    providerEl.setText(displayModel?.providerLabel || 'Provider');

    // Model label (right side)
    const modelEl = this.buttonEl.createSpan({ cls: 'opencode-model-label' });
    modelEl.setText(displayModel?.label || 'Select model');

    // Chevron
    const chevronEl = this.buttonEl.createDiv({ cls: 'opencode-provider-chevron' });
    setIcon(chevronEl, 'chevron-down');
  }

  private renderOptions() {
    if (!this.dropdownEl) return;
    this.dropdownEl.empty();

    const settings = this.callbacks.getSettings();
    const models = this.getProviderModels();
    const currentModel = settings.model;

    // Group by provider
    const byProvider = new Map<string, typeof models>();
    for (const model of models) {
      const existing = byProvider.get(model.provider);
      if (existing) {
        existing.push(model);
      } else {
        byProvider.set(model.provider, [model]);
      }
    }

    for (const [provider, providerModels] of byProvider) {
      // Provider header
      const header = this.dropdownEl.createDiv({ cls: 'opencode-provider-header' });
      header.setText(provider.charAt(0).toUpperCase() + provider.slice(1));

      // Models for this provider
      for (const model of [...providerModels].reverse()) {
        const option = this.dropdownEl.createDiv({ cls: 'opencode-provider-model-option' });
        if (model.value === currentModel) {
          option.addClass('selected');
        }

        const labelEl = option.createSpan({ cls: 'opencode-provider-model-option-label' });
        labelEl.setText(model.label);

        if (model.description) {
          option.setAttribute('title', model.description);
        }

        option.addEventListener('click', async (e) => {
          e.stopPropagation();
          await this.callbacks.onModelChange(model.value);
          this.updateDisplay();
          this.renderOptions();
        });
      }
    }

    if (models.length === 0) {
      const emptyEl = this.dropdownEl.createDiv({ cls: 'opencode-provider-model-empty' });
      emptyEl.setText('No models available');
    }
  }
}

/** Thinking budget selector component. */
export class ThinkingBudgetSelector {
  private container: HTMLElement;
  private gearsEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'opencode-thinking-selector' });
    this.render();
  }

  /** Check if the current model supports reasoning/variants. */
  private currentModelSupportsReasoning(): boolean {
    const settings = this.callbacks.getSettings();

    // Check if using OpenCode backend
    if (settings.agentBackend === 'opencode') {
      if (settings.opencodeModels && settings.opencodeModels.length > 0) {
        const currentModel = settings.opencodeModels.find(m => m.value === settings.model);
        
        if (!currentModel?.reasoning) {
          return false;
        }

        // OpenCode excludes certain providers even if capabilities.reasoning is true
        // See: opencode/packages/opencode/src/provider/transform.ts variants()
        const excludedProviders = ['deepseek', 'minimax', 'glm', 'mistral'];
        const providerId = currentModel.provider.toLowerCase();
        const modelId = currentModel.modelId.toLowerCase();
        
        const isExcluded = excludedProviders.some(p => 
          providerId.includes(p) || modelId.includes(p)
        );
        
        if (isExcluded) {
          return false;
        }

        return true;
      }

      // If no models loaded, default to enabled (allow user to retry)
      return true;
    }

    // For Claude Code, all models support thinking
    return true;
  }

  private render() {
    this.container.empty();

    const labelEl = this.container.createSpan({ cls: 'opencode-thinking-label-text' });
    
    // Show "Variant" for OpenCode (uses variants instead of thinking budget)
    const settings = this.callbacks.getSettings();
    if (settings.agentBackend === 'opencode') {
      labelEl.setText('Variant:');
    } else {
      labelEl.setText('Thinking:');
    }

    this.gearsEl = this.container.createDiv({ cls: 'opencode-thinking-gears' });
    this.renderGears();
  }

  private renderGears() {
    if (!this.gearsEl) return;
    this.gearsEl.empty();

    const settings = this.callbacks.getSettings();
    const supportsReasoning = this.currentModelSupportsReasoning();

    // If current model doesn't support reasoning, show "N/A"
    if (!supportsReasoning) {
      const currentEl = this.gearsEl.createDiv({ cls: 'opencode-thinking-current' });
      currentEl.setText('N/A');
      currentEl.style.opacity = '0.5';
      return;
    }

    const currentBudget = settings.thinkingBudget;
    const currentBudgetInfo = THINKING_BUDGETS.find(b => b.value === currentBudget);

    const currentEl = this.gearsEl.createDiv({ cls: 'opencode-thinking-current' });
    currentEl.setText(currentBudgetInfo?.label || 'Off');

    const optionsEl = this.gearsEl.createDiv({ cls: 'opencode-thinking-options' });

    for (const budget of [...THINKING_BUDGETS].reverse()) {
      const gearEl = optionsEl.createDiv({ cls: 'opencode-thinking-gear' });
      gearEl.setText(budget.label);
      gearEl.setAttribute('title', budget.tokens > 0 ? `${budget.tokens.toLocaleString()} tokens` : 'Disabled');

      if (budget.value === currentBudget) {
        gearEl.addClass('selected');
      }

      gearEl.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.callbacks.onThinkingBudgetChange(budget.value);
        this.updateDisplay();
      });
    }
  }

  updateDisplay() {
    this.renderGears();
  }
}

/** Permission mode toggle (YOLO/Safe). */
export class PermissionToggle {
  private container: HTMLElement;
  private toggleEl: HTMLElement | null = null;
  private labelEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'opencode-permission-toggle' });
    this.render();
  }

  private render() {
    this.container.empty();

    this.labelEl = this.container.createSpan({ cls: 'opencode-permission-label' });
    this.toggleEl = this.container.createDiv({ cls: 'opencode-toggle-switch' });

    this.updateDisplay();

    this.toggleEl.addEventListener('click', () => this.toggle());
  }

  updateDisplay() {
    if (!this.toggleEl || !this.labelEl) return;

    const isYolo = this.callbacks.getSettings().permissionMode === 'yolo';

    if (isYolo) {
      this.toggleEl.addClass('active');
    } else {
      this.toggleEl.removeClass('active');
    }

    this.labelEl.setText(isYolo ? 'YOLO' : 'Safe');
  }

  private async toggle() {
    const current = this.callbacks.getSettings().permissionMode;
    const newMode: PermissionMode = current === 'yolo' ? 'normal' : 'yolo';
    await this.callbacks.onPermissionModeChange(newMode);
    this.updateDisplay();
  }
}

/** External context selector component (folder icon). */
export class ExternalContextSelector {
  private container: HTMLElement;
  private iconEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  /**
   * Current external context paths. May contain:
   * - Persistent paths only (new sessions via clearExternalContexts)
   * - Restored session paths (loaded sessions via setExternalContexts)
   * - Mixed paths during active sessions
   */
  private externalContextPaths: string[] = [];
  /** Paths that persist across all sessions (stored in settings). */
  private persistentPaths: Set<string> = new Set();
  private onChangeCallback: ((paths: string[]) => void) | null = null;
  private onPersistenceChangeCallback: ((paths: string[]) => void) | null = null;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'opencode-external-context-selector' });
    this.render();
  }

  /** Set callback for when external context paths change. */
  setOnChange(callback: (paths: string[]) => void): void {
    this.onChangeCallback = callback;
  }

  /** Set callback for when persistent paths change (to save to settings). */
  setOnPersistenceChange(callback: (paths: string[]) => void): void {
    this.onPersistenceChangeCallback = callback;
  }

  /** Get current external context paths. */
  getExternalContexts(): string[] {
    return [...this.externalContextPaths];
  }

  /** Get current persistent paths. */
  getPersistentPaths(): string[] {
    return [...this.persistentPaths];
  }

  /** Set persistent paths (call on initialization from settings). */
  setPersistentPaths(paths: string[]): void {
    // Validate paths - remove non-existent directories
    const validPaths = filterValidPaths(paths);
    const invalidPaths = paths.filter(p => !validPaths.includes(p));

    this.persistentPaths = new Set(validPaths);
    // Merge persistent paths into external context paths
    this.mergePersistentPaths();
    this.updateDisplay();
    this.renderDropdown();

    // If invalid paths were removed, notify user and save updated list
    if (invalidPaths.length > 0) {
      const pathNames = invalidPaths.map(p => this.shortenPath(p)).join(', ');
      new Notice(`Removed ${invalidPaths.length} invalid external context path(s): ${pathNames}`, 5000);
      this.onPersistenceChangeCallback?.([...this.persistentPaths]);
    }
  }

  /** Toggle persistence for a path. */
  togglePersistence(path: string): void {
    if (this.persistentPaths.has(path)) {
      this.persistentPaths.delete(path);
    } else {
      // Validate path still exists before persisting
      if (!isValidDirectoryPath(path)) {
        new Notice(`Cannot persist "${this.shortenPath(path)}" - directory no longer exists`, 4000);
        return;
      }
      this.persistentPaths.add(path);
    }
    this.onPersistenceChangeCallback?.([...this.persistentPaths]);
    this.renderDropdown();
  }

  /** Merge persistent paths into externalContextPaths without duplicates. */
  private mergePersistentPaths(): void {
    const pathSet = new Set(this.externalContextPaths);
    for (const path of this.persistentPaths) {
      pathSet.add(path);
    }
    this.externalContextPaths = [...pathSet];
  }

  /**
   * Restore exact external context paths from a saved conversation.
   * Does NOT merge with persistent paths - preserves the session's historical state.
   * Use clearExternalContexts() for new sessions to start with current persistent paths.
   */
  setExternalContexts(paths: string[]): void {
    this.externalContextPaths = [...paths];
    this.updateDisplay();
    this.renderDropdown();
  }

  /**
   * Remove a path from external contexts (and persistent paths if applicable).
   * Exposed for testing the remove button behavior.
   */
  removePath(pathStr: string): void {
    this.externalContextPaths = this.externalContextPaths.filter(p => p !== pathStr);
    // Also remove from persistent paths if it was persistent
    if (this.persistentPaths.has(pathStr)) {
      this.persistentPaths.delete(pathStr);
      this.onPersistenceChangeCallback?.([...this.persistentPaths]);
    }
    this.onChangeCallback?.(this.externalContextPaths);
    this.updateDisplay();
    this.renderDropdown();
  }

  /**
   * Clear session-only external context paths (call on new conversation).
   * Uses persistent paths from settings if provided, otherwise falls back to local cache.
   * Validates paths before using them (silently filters invalid during session init).
   */
  clearExternalContexts(persistentPathsFromSettings?: string[]): void {
    // Use settings value if provided (most up-to-date), otherwise use local cache
    if (persistentPathsFromSettings) {
      // Validate paths - silently filter during session initialization (not user action)
      const validPaths = filterValidPaths(persistentPathsFromSettings);
      this.persistentPaths = new Set(validPaths);
    }
    this.externalContextPaths = [...this.persistentPaths];
    this.updateDisplay();
    this.renderDropdown();
  }

  private render() {
    this.container.empty();

    const iconWrapper = this.container.createDiv({ cls: 'opencode-external-context-icon-wrapper' });

    this.iconEl = iconWrapper.createDiv({ cls: 'opencode-external-context-icon' });
    setIcon(this.iconEl, 'folder');

    this.badgeEl = iconWrapper.createDiv({ cls: 'opencode-external-context-badge' });

    this.updateDisplay();

    // Click to open native folder picker
    iconWrapper.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openFolderPicker();
    });

    this.dropdownEl = this.container.createDiv({ cls: 'opencode-external-context-dropdown' });
    this.renderDropdown();
  }

  private async openFolderPicker() {
    try {
      // Access Electron's dialog through remote
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { remote } = require('electron');
      const result = await remote.dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select External Context',
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];

        // Check for duplicate (normalized comparison for cross-platform support)
        if (isDuplicatePath(selectedPath, this.externalContextPaths)) {
          new Notice('This folder is already added as an external context.', 3000);
          return;
        }

        // Check for nested/overlapping paths
        const conflict = findConflictingPath(selectedPath, this.externalContextPaths);
        if (conflict) {
          // Show warning notice
          this.showConflictNotice(selectedPath, conflict);
          return;
        }

        this.externalContextPaths = [...this.externalContextPaths, selectedPath];
        this.onChangeCallback?.(this.externalContextPaths);
        this.updateDisplay();
        this.renderDropdown();
      }
    } catch {
      new Notice('Unable to open folder picker.', 5000);
    }
  }

  /** Shows a notice when a conflicting path is detected. */
  private showConflictNotice(newPath: string, conflict: { path: string; type: 'parent' | 'child' }) {
    const shortNew = this.shortenPath(newPath);
    const shortExisting = this.shortenPath(conflict.path);

    let message: string;
    if (conflict.type === 'parent') {
      message = `Cannot add "${shortNew}" - it's inside existing path "${shortExisting}"`;
    } else {
      message = `Cannot add "${shortNew}" - it contains existing path "${shortExisting}"`;
    }

    new Notice(message, 5000);
  }

  private renderDropdown() {
    if (!this.dropdownEl) return;

    this.dropdownEl.empty();

    // Header
    const headerEl = this.dropdownEl.createDiv({ cls: 'opencode-external-context-header' });
    headerEl.setText('External Contexts');

    // Path list
    const listEl = this.dropdownEl.createDiv({ cls: 'opencode-external-context-list' });

    if (this.externalContextPaths.length === 0) {
      const emptyEl = listEl.createDiv({ cls: 'opencode-external-context-empty' });
      emptyEl.setText('Click folder icon to add');
    } else {
      for (const pathStr of this.externalContextPaths) {
        const itemEl = listEl.createDiv({ cls: 'opencode-external-context-item' });

        const pathTextEl = itemEl.createSpan({ cls: 'opencode-external-context-text' });
        // Show shortened path for display
        const displayPath = this.shortenPath(pathStr);
        pathTextEl.setText(displayPath);
        pathTextEl.setAttribute('title', pathStr);

        // Lock toggle button
        const isPersistent = this.persistentPaths.has(pathStr);
        const lockBtn = itemEl.createSpan({ cls: 'opencode-external-context-lock' });
        if (isPersistent) {
          lockBtn.addClass('locked');
        }
        setIcon(lockBtn, isPersistent ? 'lock' : 'unlock');
        lockBtn.setAttribute('title', isPersistent ? 'Persistent (click to make session-only)' : 'Session-only (click to persist)');
        lockBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.togglePersistence(pathStr);
        });

        const removeBtn = itemEl.createSpan({ cls: 'opencode-external-context-remove' });
        setIcon(removeBtn, 'x');
        removeBtn.setAttribute('title', 'Remove path');
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.removePath(pathStr);
        });
      }
    }
  }

  /** Shorten path for display (replace home dir with ~) */
  private shortenPath(fullPath: string): string {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const os = require('os');
      const homeDir = os.homedir();
      const normalize = (value: string) => value.replace(/\\/g, '/');
      const normalizedFull = normalize(fullPath);
      const normalizedHome = normalize(homeDir);
      const compareFull = process.platform === 'win32'
        ? normalizedFull.toLowerCase()
        : normalizedHome;
      const compareHome = process.platform === 'win32'
        ? normalizedHome.toLowerCase()
        : normalizedHome;
      if (compareFull.startsWith(compareHome)) {
        // Use normalized path length and normalize the result for consistent display
        const remainder = normalizedFull.slice(normalizedHome.length);
        return '~' + remainder;
      }
    } catch {
      // Fall through to return full path
    }
    return fullPath;
  }

  updateDisplay() {
    if (!this.iconEl || !this.badgeEl) return;

    const count = this.externalContextPaths.length;

    if (count > 0) {
      this.iconEl.addClass('active');
      this.iconEl.setAttribute('title', `${count} external context${count > 1 ? 's' : ''} (click to add more)`);

      // Show badge only when more than 1 path
      if (count > 1) {
        this.badgeEl.setText(String(count));
        this.badgeEl.addClass('visible');
      } else {
        this.badgeEl.removeClass('visible');
      }
    } else {
      this.iconEl.removeClass('active');
      this.iconEl.setAttribute('title', 'Add external contexts (click)');
      this.badgeEl.removeClass('visible');
    }
  }
}

/** MCP server selector component (plug icon). */
export class McpServerSelector {
  private container: HTMLElement;
  private iconEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private mcpService: McpService | null = null;
  private enabledServers: Set<string> = new Set();
  private onChangeCallback: ((enabled: Set<string>) => void) | null = null;

  constructor(parentEl: HTMLElement) {
    this.container = parentEl.createDiv({ cls: 'opencode-mcp-selector' });
    this.render();
  }

  /** Set the MCP service for fetching server list. */
  setMcpService(service: McpService | null): void {
    this.mcpService = service;
    this.pruneEnabledServers();
    this.updateDisplay();
    this.renderDropdown();
  }

  /** Set callback for when enabled servers change. */
  setOnChange(callback: (enabled: Set<string>) => void): void {
    this.onChangeCallback = callback;
  }

  /** Get currently enabled servers (via click or @-mention). */
  getEnabledServers(): Set<string> {
    return new Set(this.enabledServers);
  }

  /** Add servers from @-mentions. */
  addMentionedServers(names: Set<string>): void {
    let changed = false;
    for (const name of names) {
      if (!this.enabledServers.has(name)) {
        this.enabledServers.add(name);
        changed = true;
      }
    }
    if (changed) {
      this.updateDisplay();
      this.renderDropdown();
    }
  }

  /** Clear enabled servers (call on new conversation). */
  clearEnabled(): void {
    this.enabledServers.clear();
    this.updateDisplay();
    this.renderDropdown();
  }

  /** Set enabled servers (call when restoring conversation state). */
  setEnabledServers(names: string[]): void {
    this.enabledServers = new Set(names);
    this.pruneEnabledServers();
    this.updateDisplay();
    this.renderDropdown();
  }

  private pruneEnabledServers(): void {
    if (!this.mcpService) return;
    const activeNames = new Set(this.mcpService.getServers().filter((s) => s.enabled).map((s) => s.name));
    let changed = false;
    for (const name of this.enabledServers) {
      if (!activeNames.has(name)) {
        this.enabledServers.delete(name);
        changed = true;
      }
    }
    if (changed) {
      this.onChangeCallback?.(this.enabledServers);
    }
  }

  private render() {
    this.container.empty();

    const iconWrapper = this.container.createDiv({ cls: 'opencode-mcp-selector-icon-wrapper' });

    this.iconEl = iconWrapper.createDiv({ cls: 'opencode-mcp-selector-icon' });
    this.iconEl.innerHTML = MCP_ICON_SVG;

    this.badgeEl = iconWrapper.createDiv({ cls: 'opencode-mcp-selector-badge' });

    this.updateDisplay();

    this.dropdownEl = this.container.createDiv({ cls: 'opencode-mcp-selector-dropdown' });
    this.renderDropdown();

    // Re-render dropdown content on hover (CSS handles visibility)
    this.container.addEventListener('mouseenter', () => {
      this.renderDropdown();
    });
  }

  private renderDropdown() {
    if (!this.dropdownEl) return;
    this.pruneEnabledServers();
    this.dropdownEl.empty();

    // Header
    const headerEl = this.dropdownEl.createDiv({ cls: 'opencode-mcp-selector-header' });
    headerEl.setText('MCP Servers');

    // Server list
    const listEl = this.dropdownEl.createDiv({ cls: 'opencode-mcp-selector-list' });

    const allServers = this.mcpService?.getServers() || [];
    const servers = allServers.filter(s => s.enabled);

    if (servers.length === 0) {
      const emptyEl = listEl.createDiv({ cls: 'opencode-mcp-selector-empty' });
      emptyEl.setText(allServers.length === 0 ? 'No MCP servers configured' : 'All MCP servers disabled');
      return;
    }

    for (const server of servers) {
      this.renderServerItem(listEl, server);
    }
  }

  private renderServerItem(listEl: HTMLElement, server: ClaudianMcpServer) {
    const itemEl = listEl.createDiv({ cls: 'opencode-mcp-selector-item' });
    itemEl.dataset.serverName = server.name;

    const isEnabled = this.enabledServers.has(server.name);
    if (isEnabled) {
      itemEl.addClass('enabled');
    }

    // Checkbox
    const checkEl = itemEl.createDiv({ cls: 'opencode-mcp-selector-check' });
    if (isEnabled) {
      checkEl.innerHTML = CHECK_ICON_SVG;
    }

    // Info
    const infoEl = itemEl.createDiv({ cls: 'opencode-mcp-selector-item-info' });

    const nameEl = infoEl.createSpan({ cls: 'opencode-mcp-selector-item-name' });
    nameEl.setText(server.name);

    // Badges
    if (server.contextSaving) {
      const csEl = infoEl.createSpan({ cls: 'opencode-mcp-selector-cs-badge' });
      csEl.setText('@');
      csEl.setAttribute('title', 'Context-saving: can also enable via @' + server.name);
    }

    // Click to toggle (use mousedown for more reliable capture)
    itemEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleServer(server.name, itemEl);
    });
  }

  private toggleServer(name: string, itemEl: HTMLElement) {
    if (this.enabledServers.has(name)) {
      this.enabledServers.delete(name);
    } else {
      this.enabledServers.add(name);
    }

    // Update item visually in-place (immediate feedback)
    const isEnabled = this.enabledServers.has(name);
    const checkEl = itemEl.querySelector('.opencode-mcp-selector-check') as HTMLElement | null;

    if (isEnabled) {
      itemEl.addClass('enabled');
      if (checkEl) checkEl.innerHTML = CHECK_ICON_SVG;
    } else {
      itemEl.removeClass('enabled');
      if (checkEl) checkEl.innerHTML = '';
    }

    this.updateDisplay();
    this.onChangeCallback?.(this.enabledServers);
  }

  updateDisplay() {
    this.pruneEnabledServers();
    if (!this.iconEl || !this.badgeEl) return;

    const count = this.enabledServers.size;
    const hasServers = (this.mcpService?.getServers().length || 0) > 0;

    // Show/hide container based on whether there are servers
    if (!hasServers) {
      this.container.style.display = 'none';
      return;
    }
    this.container.style.display = '';

    if (count > 0) {
      this.iconEl.addClass('active');
      this.iconEl.setAttribute('title', `${count} MCP server${count > 1 ? 's' : ''} enabled (click to manage)`);

      // Show badge only when more than 1
      if (count > 1) {
        this.badgeEl.setText(String(count));
        this.badgeEl.addClass('visible');
      } else {
        this.badgeEl.removeClass('visible');
      }
    } else {
      this.iconEl.removeClass('active');
      this.iconEl.setAttribute('title', 'MCP servers (click to enable)');
      this.badgeEl.removeClass('visible');
    }
  }
}

/** Context usage meter component (240° arc gauge). */
export class ContextUsageMeter {
  private container: HTMLElement;
  private fillPath: SVGPathElement | null = null;
  private percentEl: HTMLElement | null = null;
  private circumference: number = 0;

  constructor(parentEl: HTMLElement) {
    this.container = parentEl.createDiv({ cls: 'opencode-context-meter' });
    this.render();
    // Initially hidden
    this.container.style.display = 'none';
  }

  private render() {
    const size = 16;
    const strokeWidth = 2;
    const radius = (size - strokeWidth) / 2;
    const cx = size / 2;
    const cy = size / 2;

    // 240° arc: from 150° to 390° (upper-left through bottom to upper-right)
    const startAngle = 150;
    const endAngle = 390;
    const arcDegrees = endAngle - startAngle;
    const arcRadians = (arcDegrees * Math.PI) / 180;
    this.circumference = radius * arcRadians;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    const x1 = cx + radius * Math.cos(startRad);
    const y1 = cy + radius * Math.sin(startRad);
    const x2 = cx + radius * Math.cos(endRad);
    const y2 = cy + radius * Math.sin(endRad);

    const gaugeEl = this.container.createDiv({ cls: 'opencode-context-meter-gauge' });
    gaugeEl.innerHTML = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <path class="opencode-meter-bg"
          d="M ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${x2} ${y2}"
          fill="none" stroke-width="${strokeWidth}" stroke-linecap="round"/>
        <path class="opencode-meter-fill"
          d="M ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${x2} ${y2}"
          fill="none" stroke-width="${strokeWidth}" stroke-linecap="round"
          stroke-dasharray="${this.circumference}" stroke-dashoffset="${this.circumference}"/>
      </svg>
    `;
    this.fillPath = gaugeEl.querySelector('.opencode-meter-fill');

    this.percentEl = this.container.createSpan({ cls: 'opencode-context-meter-percent' });
  }

  update(usage: UsageInfo | null): void {
    if (!usage) {
      this.container.style.display = 'none';
      return;
    }
    this.container.style.display = 'flex';
    const fillLength = (usage.percentage / 100) * this.circumference;
    if (this.fillPath) {
      this.fillPath.style.strokeDashoffset = String(this.circumference - fillLength);
    }

    if (this.percentEl) {
      this.percentEl.setText(`${usage.percentage}%`);
    }

    // Toggle warning class for > 80%
    if (usage.percentage > 80) {
      this.container.addClass('warning');
    } else {
      this.container.removeClass('warning');
    }

    // Set tooltip with detailed usage
    const tooltip = `${this.formatTokens(usage.contextTokens)} / ${this.formatTokens(usage.contextWindow)}`;
    this.container.setAttribute('data-tooltip', tooltip);
  }

  /** Format token count (e.g., 45000 -> "45k", 200000 -> "200k") */
  private formatTokens(tokens: number): string {
    if (tokens >= 1000) {
      return `${Math.round(tokens / 1000)}k`;
    }
    return String(tokens);
  }
}

/** Agent selector component for OpenCode backend (simple text button with dropdown). */
export class AgentSelector {
  private container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'opencode-agent-selector' });
    this.render();
  }

  private render() {
    this.container.empty();

    this.buttonEl = this.container.createDiv({ cls: 'opencode-agent-btn' });
    this.updateDisplay();

    this.dropdownEl = this.container.createDiv({ cls: 'opencode-agent-dropdown' });
    this.renderOptions();
  }

  private getAvailableAgents() {
    const settings = this.callbacks.getSettings();
    if (settings.agentBackend === 'opencode' && settings.opencodeAgents && settings.opencodeAgents.length > 0) {
      return settings.opencodeAgents;
    }
    // Default agents for OpenCode
    return [
      { value: 'sisyphus', name: 'Sisyphus', description: 'General purpose coding agent' },
      { value: 'build', name: 'Build', description: 'Build and deployment specialist' },
      { value: 'plan', name: 'Plan', description: 'Planning and analysis agent' },
    ];
  }

  updateDisplay() {
    if (!this.buttonEl) return;
    const settings = this.callbacks.getSettings();
    const agents = this.getAvailableAgents();
    const currentAgent = agents.find(a => a.value === settings.currentAgent) || agents[0];

    this.buttonEl.empty();

    const labelEl = this.buttonEl.createSpan({ cls: 'opencode-agent-label' });
    labelEl.setText(currentAgent?.name || 'Agent');

    const chevronEl = this.buttonEl.createDiv({ cls: 'opencode-agent-chevron' });
    setIcon(chevronEl, 'chevron-down');
  }

  private renderOptions() {
    if (!this.dropdownEl) return;
    this.dropdownEl.empty();

    const settings = this.callbacks.getSettings();
    const agents = this.getAvailableAgents();

    for (const agent of agents) {
      const option = this.dropdownEl.createDiv({ cls: 'opencode-agent-option' });
      if (agent.value === settings.currentAgent) {
        option.addClass('selected');
      }

      const nameEl = option.createSpan({ cls: 'opencode-agent-option-name' });
      nameEl.setText(agent.name);

      option.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (this.callbacks.onAgentChange) {
          await this.callbacks.onAgentChange(agent.value);
        }
        this.updateDisplay();
        this.renderOptions();
      });
    }
  }
}

/** Send button component for OpenCode (primary variant with arrow icon). */
export class SendButton {
  private container: HTMLElement;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'opencode-send-btn' });
    this.render();
  }

  private render() {
    this.container.empty();

    // Primary send button with arrow-up icon
    this.container.addClass('opencode-send-btn-primary');
    const iconWrapper = this.container.createDiv({ cls: 'opencode-send-icon' });
    setIcon(iconWrapper, 'arrow-up');

    this.container.setAttribute('title', 'Send (Enter)');
    this.container.addEventListener('click', () => {
      if (this.callbacks.onSendClick) {
        this.callbacks.onSendClick();
      }
    });
  }
}

/** Result structure for toolbar creation */
export interface ToolbarComponents {
  /** Claude Code only: model selector */
  modelSelector: ModelSelector | null;
  /** OpenCode only: provider/model selector */
  providerModelSelector: ProviderModelSelector | null;
  thinkingBudgetSelector: ThinkingBudgetSelector;
  contextUsageMeter: ContextUsageMeter | null;
  /** Claude Code only: permission toggle */
  permissionToggle: PermissionToggle | null;
  /** OpenCode only: agent selector */
  agentSelector: AgentSelector | null;
  /** OpenCode only: send button */
  sendButton: SendButton | null;
}

/** Factory function to create toolbar components based on backend type. */
export function createInputToolbar(
  parentEl: HTMLElement,
  callbacks: ToolbarCallbacks
): ToolbarComponents {
  const settings = callbacks.getSettings();
  const isOpenCode = settings.agentBackend === 'opencode';

  // Create mode-specific container classes
  const container = parentEl.createDiv({
    cls: `opencode-input-toolbar ${isOpenCode ? 'opencode-mode' : 'claude-code-mode'}`
  });

  // Create left and right sections
  const leftSection = container.createDiv({ cls: 'opencode-toolbar-left' });
  const rightSection = container.createDiv({ cls: 'opencode-toolbar-right' });

  // Component references
  let modelSelector: ModelSelector | null = null;
  let providerModelSelector: ProviderModelSelector | null = null;
  let permissionToggle: PermissionToggle | null = null;
  let agentSelector: AgentSelector | null = null;
  let sendButton: SendButton | null = null;

  if (isOpenCode) {
    // OpenCode: left = Agent + ProviderModel + Variant, right = Send
    agentSelector = new AgentSelector(leftSection, callbacks);
    providerModelSelector = new ProviderModelSelector(leftSection, callbacks);
    const thinkingBudgetSelector = new ThinkingBudgetSelector(leftSection, callbacks);
    sendButton = new SendButton(rightSection, callbacks);

    return {
      modelSelector,
      providerModelSelector,
      thinkingBudgetSelector,
      contextUsageMeter: null,
      permissionToggle,
      agentSelector,
      sendButton,
    };
  } else {
    // Claude Code: left = Model + Thinking + Permission, right = External + MCP
    modelSelector = new ModelSelector(leftSection, callbacks);
    const thinkingBudgetSelector = new ThinkingBudgetSelector(leftSection, callbacks);
    permissionToggle = new PermissionToggle(leftSection, callbacks);
    new ExternalContextSelector(rightSection, callbacks);
    new McpServerSelector(rightSection);

    return {
      modelSelector,
      providerModelSelector,
      thinkingBudgetSelector,
      contextUsageMeter: null,
      permissionToggle,
      agentSelector,
      sendButton,
    };
  }
}
