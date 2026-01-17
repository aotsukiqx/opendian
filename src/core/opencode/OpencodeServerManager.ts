/**
 * OpenCode Server Manager
 *
 * Manages the OpenCode server process lifecycle:
 * - Starts/stops the server process in the vault directory
 * - Generates config file with server settings
 * - Sets authentication environment variables
 * - Handles CORS configuration for Obsidian
 */

import { Notice, Platform } from 'obsidian';
import * as path from 'path';

export interface OpencodeServerConfig {
  hostname: string;
  port: number;
  autoStart: boolean;
  enableMdns: boolean;
  corsOrigins: string[];
  /** Connect to external server instead of spawning local process */
  externalServer: boolean;
}

/** Extended config including runtime-only password */
export interface OpencodeManagerConfig extends OpencodeServerConfig {
  password?: string;
}

export interface ServerStatus {
  running: boolean;
  port: number;
  hostname: string;
  pid?: number;
  version?: string;
}

/**
 * Manages OpenCode server process lifecycle.
 */
export class OpencodeServerManager {
  private process: ChildProcess | null = null;
  private vaultPath: string;
  private config: OpencodeManagerConfig;
  private password: string;

  constructor(vaultPath: string, config: OpencodeServerConfig, password?: string) {
    this.vaultPath = vaultPath;
    this.password = password ?? '';
    this.config = {
      hostname: config.hostname ?? '127.0.0.1',
      port: config.port ?? 4096,
      corsOrigins: config.corsOrigins ?? [],
      enableMdns: config.enableMdns ?? false,
      autoStart: config.autoStart ?? true,
    };
  }

  /**
    * Get the OpenCode CLI path.
    * Tries multiple locations based on platform.
    */
  private getOpencodeCliPath(): string {
    // First check if 'opencode' is in PATH
    const pathInEnv = process.env.PATH?.split(path.delimiter)
      .map(dir => path.join(dir, 'opencode'))
      .find(cliPath => {
        try {
          const fs = require('fs');
          return fs.existsSync(cliPath);
        } catch {
          return false;
        }
      });

    if (pathInEnv) {
      return pathInEnv;
    }

    // Platform-specific common paths
    if (Platform.isMacOS) {
      const macPaths = [
        '/usr/local/bin/opencode',
        '/opt/homebrew/bin/opencode',
        '/usr/bin/opencode',
      ];
      for (const p of macPaths) {
        try {
          const fs = require('fs');
          if (fs.existsSync(p)) return p;
        } catch {}
      }
    } else if (Platform.isLinux) {
      const linuxPaths = ['/usr/bin/opencode', '/usr/local/bin/opencode'];
      for (const p of linuxPaths) {
        try {
          const fs = require('fs');
          if (fs.existsSync(p)) return p;
        } catch {}
      }
    } else if (Platform.isWin32) {
      return 'opencode.exe';
    }

    // Fallback to just 'opencode' and let it fail with a clear error
    console.warn('[OpenCode] opencode CLI not found in common paths, using "opencode"');
    return 'opencode';
  }

  /**
   * Generate the opencode.json config file content.
   */
  private generateConfigContent(): string {
    // Always include Obsidian origin in CORS
    const corsOrigins = new Set(this.config.corsOrigins ?? []);
    corsOrigins.add('app://obsidian.md');

    const config: Record<string, unknown> = {
      $schema: 'https://opencode.ai/config.json',
      server: {
        port: this.config.port,
        hostname: this.config.hostname,
        mdns: this.config.enableMdns,
        cors: Array.from(corsOrigins),
      },
      // Disable autoupdate to prevent version conflicts
      autoupdate: false,
    };

    // Add provider configuration if environment variables exist
    if (process.env.ANTHROPIC_API_KEY) {
      config.provider = {
        anthropic: {
          options: {
            apiKey: '{env:ANTHROPIC_API_KEY}',
          },
        },
      };
    }

    return JSON.stringify(config, null, 2);
  }

  /**
   * Write the config file to the vault.
   */
  async writeConfigFile(): Promise<boolean> {
    try {
      const configPath = path.join(this.vaultPath, 'opencode.json');
      const configContent = this.generateConfigContent();

      // Use Obsidian's vault API for cross-platform compatibility
      // Check if file exists first
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adapter = (this as any).app?.vault?.adapter;
      if (adapter) {
        await adapter.write(configPath, configContent);
      } else {
        // Fallback to Node fs for development/testing
        const fs = require('fs');
        fs.writeFileSync(configPath, configContent);
      }

      return true;
    } catch (error) {
      console.error('[OpenCode] Failed to write config file:', error);
      return false;
    }
  }

  /**
   * Build environment variables for the server process.
   */
  private buildEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };

    // Set authentication from plugin settings
    if (this.password) {
      env.OPENCODE_SERVER_PASSWORD = this.password;
      console.log('[OpenCode] Password env var set (length:', this.password.length, ')');
    } else {
      console.log('[OpenCode] No password set - OPENCODE_SERVER_PASSWORD not set');
    }

    // Clear any existing auth settings that might conflict
    delete env.OPENCODE_API_KEY;
    delete env.OPENCODE_AUTH_TOKEN;

    return env;
  }

  /**
   * Start the OpenCode server process.
   */
  async start(): Promise<boolean> {
    if (this.isRunning()) {
      console.log('[OpenCode] Server already running');
      return true;
    }

    // For external servers, just check connectivity without spawning
    if (this.config.externalServer) {
      console.log('[OpenCode] External server mode - checking connectivity to', this.config.hostname + ':' + this.config.port);
      const status = await this.checkHealth();
      if (status.running) {
        console.log('[OpenCode] Connected to external server');
        return true;
      } else {
        new Notice('Cannot connect to OpenCode server. Please verify hostname and port.');
        return false;
      }
    }

    console.log('[OpenCode] Starting local server...');
    console.log('[OpenCode] Config:', JSON.stringify({
      hostname: this.config.hostname,
      port: this.config.port,
      autoStart: this.config.autoStart,
      enableMdns: this.config.enableMdns,
      externalServer: this.config.externalServer,
      corsOrigins: this.config.corsOrigins,
    }));
    console.log('[OpenCode] Password provided:', !!this.password);

    try {
      // Write config file first
      await this.writeConfigFile();

      const cliPath = this.getOpencodeCliPath();
      console.log('[OpenCode] CLI path:', cliPath);
      console.log('[OpenCode] Vault path:', this.vaultPath);

      // Check if CLI exists
      try {
        const fs = require('fs');
        if (!fs.existsSync(cliPath)) {
          new Notice('OpenCode CLI not found. Please install OpenCode from opencode.ai');
          console.error('[OpenCode] CLI not found at:', cliPath);
          return false;
        }
      } catch (e) {
        console.warn('[OpenCode] Could not verify CLI exists:', e);
      }

      const env = this.buildEnv();

      // Build command arguments
      const args = [
        'serve',
        '--port', String(this.config.port),
        '--hostname', this.config.hostname,
      ];

      // Add CORS origins - always include Obsidian origin
      const corsOrigins = new Set(this.config.corsOrigins ?? []);
      corsOrigins.add('app://obsidian.md');
      for (const origin of corsOrigins) {
        args.push('--cors', origin);
      }

      // Add mdns if enabled
      if (this.config.enableMdns) {
        args.push('--mdns');
      }

      console.log('[OpenCode] Starting server with args:', args.join(' '));

      // Start the process in the vault directory
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { spawn } = require('child_process');

      this.process = spawn(cliPath, args, {
        cwd: this.vaultPath,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      // Handle process events
      this.process.on('error', (error) => {
        console.error('[OpenCode] Server process error:', error);
        new Notice(`Failed to start OpenCode server: ${error.message}`);
      });

      this.process.on('exit', (code, signal) => {
        console.log(`[OpenCode] Server exited with code ${code}, signal ${signal}`);
        this.process = null;
      });

      // Log stdout/stderr for debugging
      this.process.stdout?.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) {
          console.log('[OpenCode] Server:', msg);
        }
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) {
          console.error('[OpenCode] Server error:', msg);
        }
      });

      // Wait for server to be ready
      const maxWait = 15000; // 15 seconds
      const startTime = Date.now();
      let attempts = 0;

      while (Date.now() - startTime < maxWait) {
        attempts++;
        const status = await this.checkHealth();
        if (status.running) {
          console.log(`[OpenCode] Server started successfully on ${this.config.hostname}:${this.config.port}`);
          new Notice(`OpenCode server started on port ${this.config.port}`);
          return true;
        }
        console.log(`[OpenCode] Waiting for server... (attempt ${attempts})`);
        await this.sleep(1000);
      }

      console.warn('[OpenCode] Server start timeout, may still be initializing');
      // Still return true - the server process might be starting
      return true;
    } catch (error) {
      console.error('[OpenCode] Failed to start server:', error);
      new Notice(`Failed to start OpenCode server: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  /**
   * Stop the OpenCode server process.
   */
  async stop(): Promise<boolean> {
    if (!this.process) {
      return true;
    }

    try {
      // Kill the process tree
      if (this.process.pid) {
        // On POSIX systems, kill the process group
        if (process.platform !== 'win32') {
          try {
            process.kill(-this.process.pid, 'SIGTERM');
          } catch {
            // Process group might not exist, kill directly
            this.process.kill('SIGTERM');
          }
        } else {
          // On Windows, we need to kill the process tree differently
          // For now, just kill the main process
          this.process.kill('SIGTERM');
        }
      }

      this.process = null;
      console.log('[OpenCode] Server stopped');
      return true;
    } catch (error) {
      console.error('[OpenCode] Failed to stop server:', error);
      return false;
    }
  }

  /**
   * Check if the server is currently running.
   */
  isRunning(): boolean {
    if (!this.process) {
      return false;
    }

    // Check if process is still alive
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.process as any).killed === false;
  }

  /**
   * Check server health via HTTP request.
   */
  async checkHealth(): Promise<ServerStatus> {
    const url = `http://${this.config.hostname}:${this.config.port}/global/health`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });

      if (response.ok) {
        const data = await response.json() as { healthy: boolean; version?: string };
        return {
          running: data.healthy ?? true,
          port: this.config.port,
          hostname: this.config.hostname,
          version: data.version,
        };
      }

      return {
        running: false,
        port: this.config.port,
        hostname: this.config.hostname,
      };
    } catch {
      return {
        running: false,
        port: this.config.port,
        hostname: this.config.hostname,
      };
    }
  }

  /**
   * Get the server URL.
   */
  getServerUrl(): string {
    return `http://${this.config.hostname}:${this.config.port}`;
  }

  /**
   * Get current config.
   */
  getConfig(): OpencodeServerConfig {
    return {
      hostname: this.config.hostname,
      port: this.config.port,
      autoStart: this.config.autoStart,
      enableMdns: this.config.enableMdns,
      corsOrigins: this.config.corsOrigins,
    };
  }

  /**
   * Update configuration.
   */
  updateConfig(config: Partial<OpencodeServerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * Set password (runtime only, not persisted).
   */
  setPassword(password: string): void {
    this.password = password;
  }

  /**
   * Utility sleep function.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Cleanup resources.
   */
  cleanup(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.stop();
  }
}
