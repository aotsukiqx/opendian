/**
 * OpenCode CLI Resolver
 *
 * Detects and resolves the OpenCode CLI executable path.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface ResolvedCliPaths {
  opencodeCliPath: string | null;
  serverUrl: string | null;
}

/**
 * Resolve the OpenCode CLI path from various sources.
 */
export class OpencodeCliResolver {
  private isWindows = process.platform === 'win32';
  private exeExtension = this.isWindows ? '.exe' : '';

  /**
   * Resolve the OpenCode CLI path.
   *
   * @param perHostPaths - Per-device CLI paths (preferred)
   * @param legacyPath - Legacy single path (fallback)
   * @param envVars - Environment variables containing OPENCODE_* settings
   * @returns Resolved paths including CLI path and server URL
   */
  resolve(
    perHostPaths: Record<string, string>,
    legacyPath: string,
    envVars: string
  ): ResolvedCliPaths {
    const hostname = os.hostname();

    // Priority 1: Per-host path from settings
    let cliPath: string | null = perHostPaths[hostname]?.trim() ?? null;

    // Priority 2: Legacy path (for migration)
    if (!cliPath) {
      cliPath = legacyPath.trim() || null;
    }

    // Priority 3: Auto-detect from PATH
    if (!cliPath) {
      cliPath = this.autoDetectFromPath();
    }

    // Priority 4: Check common installation locations
    if (!cliPath) {
      cliPath = this.checkCommonLocations();
    }

    // Determine server URL
    // OpenCode runs a server on port 4096 by default
    const serverUrl = cliPath ? `http://127.0.0.1:4096` : null;

    return {
      opencodeCliPath: cliPath,
      serverUrl,
    };
  }

  /**
   * Auto-detect OpenCode from system PATH.
   */
  private autoDetectFromPath(): string | null {
    const pathEnv = process.env.PATH || '';
    const pathSeparator = this.isWindows ? ';' : ':';
    const pathDirs = pathEnv.split(pathSeparator);

    for (const dir of pathDirs) {
      if (!dir) continue;

      const opencodePath = path.join(dir, `opencode${this.exeExtension}`);
      try {
        if (fs.existsSync(opencodePath)) {
          const stat = fs.statSync(opencodePath);
          if (stat.isFile()) {
            return opencodePath;
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    }

    return null;
  }

  /**
   * Check common OpenCode installation locations.
   */
  private checkCommonLocations(): string | null {
    const home = os.homedir();
    const commonLocations: string[] = [];

    if (this.isWindows) {
      // Windows locations
      const localAppData = process.env.LOCALAPPDATA;
      const appData = process.env.APPDATA;

      if (localAppData) {
        commonLocations.push(path.join(localAppData, 'opencode', 'bin', `opencode${this.exeExtension}`));
      }
      if (appData) {
        commonLocations.push(path.join(appData, 'opencode', `opencode${this.exeExtension}`));
      }
      commonLocations.push(path.join(home, 'AppData', 'Local', 'opencode', 'bin', `opencode${this.exeExtension}`));
      commonLocations.push(path.join(home, 'AppData', 'Roaming', 'opencode', `opencode${this.exeExtension}`));
    } else {
      // Unix/macOS locations
      commonLocations.push(path.join(home, '.local', 'bin', 'opencode'));
      commonLocations.push(path.join(home, '.cargo', 'bin', 'opencode'));
      commonLocations.push(path.join(home, '.nvm', 'versions', 'node', '*', 'bin', 'opencode'));
      commonLocations.push('/usr/local/bin/opencode');
      commonLocations.push('/usr/bin/opencode');
      commonLocations.push('/opt/homebrew/bin/opencode');
    }

    for (const location of commonLocations) {
      try {
        // Handle glob patterns for nvm
        if (location.includes('*')) {
          const globResult = this.expandGlob(location);
          for (const expanded of globResult) {
            if (fs.existsSync(expanded)) {
              return expanded;
            }
          }
        } else if (fs.existsSync(location)) {
          return location;
        }
      } catch {
        // Skip
      }
    }

    return null;
  }

  /**
   * Expand glob patterns (simple version).
   */
  private expandGlob(pattern: string): string[] {
    const parts = pattern.split('*');
    if (parts.length !== 2) return [pattern];

    const prefix = parts[0];
    const suffix = parts[1];
    const parentDir = path.dirname(prefix);

    try {
      if (!fs.existsSync(parentDir)) return [];

      const entries = fs.readdirSync(parentDir, { withFileTypes: true });
      const matches: string[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const fullPath = path.join(parentDir, entry.name, suffix);
          if (fs.existsSync(fullPath)) {
            matches.push(fullPath);
          }
        }
      }

      return matches;
    } catch {
      return [];
    }
  }

  /**
   * Check if OpenCode is installed.
   */
  isInstalled(cliPath: string | null): boolean {
    if (!cliPath) return false;

    try {
      return fs.existsSync(cliPath);
    } catch {
      return false;
    }
  }

  /**
   * Get the default OpenCode port.
   */
  getDefaultPort(): number {
    return 4096;
  }

  /**
   * Get the default hostname.
   */
  getDefaultHostname(): string {
    return '127.0.0.1';
  }
}
