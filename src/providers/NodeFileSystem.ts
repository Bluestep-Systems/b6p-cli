import * as fs from 'fs/promises';
import * as path from 'path';
import { B6PUri } from '@bluestep-systems/b6p-core';
import type { FileStat, IFileSystem } from '@bluestep-systems/b6p-core';

export class NodeFileSystem implements IFileSystem {

  async readFile(uri: B6PUri): Promise<Uint8Array> {
    return fs.readFile(uri.fsPath);
  }

  async writeFile(uri: B6PUri, content: Uint8Array): Promise<void> {
    const dir = path.dirname(uri.fsPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(uri.fsPath, content);
  }

  async stat(uri: B6PUri): Promise<FileStat> {
    const s = await fs.stat(uri.fsPath);
    return {
      type: s.isDirectory() ? 'directory' : 'file',
      mtime: s.mtimeMs,
      size: s.size,
    };
  }

  async readDirectory(uri: B6PUri): Promise<[string, 'file' | 'directory'][]> {
    const entries = await fs.readdir(uri.fsPath, { withFileTypes: true });
    return entries.map(e => [
      e.name,
      e.isDirectory() ? 'directory' : 'file',
    ]);
  }

  async delete(uri: B6PUri, options?: { recursive?: boolean }): Promise<void> {
    await fs.rm(uri.fsPath, { recursive: options?.recursive ?? false, force: true });
  }

  async createDirectory(uri: B6PUri): Promise<void> {
    await fs.mkdir(uri.fsPath, { recursive: true });
  }

  async exists(uri: B6PUri): Promise<boolean> {
    try {
      await fs.access(uri.fsPath);
      return true;
    } catch {
      return false;
    }
  }

  async copy(source: B6PUri, target: B6PUri, options?: { overwrite?: boolean }): Promise<void> {
    const mode = options?.overwrite ? 0 : fs.constants.COPYFILE_EXCL;
    await fs.copyFile(source.fsPath, target.fsPath, mode);
  }

  async rename(source: B6PUri, target: B6PUri, _options?: { overwrite?: boolean }): Promise<void> {
    await fs.rename(source.fsPath, target.fsPath);
  }

  async findFiles(base: B6PUri, include: string, _exclude?: string): Promise<B6PUri[]> {
    // Simple recursive walk with glob-like matching.
    // For production use this could delegate to a proper glob library.
    const results: B6PUri[] = [];
    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (this.matchesGlob(entry.name, include)) {
          results.push(B6PUri.fromFsPath(full));
        }
      }
    };
    await walk(base.fsPath);
    return results;
  }

  private matchesGlob(name: string, pattern: string): boolean {
    if (pattern === '*' || pattern === '**/*') {
      return true;
    }
    // Simple extension match for patterns like "*.ts"
    if (pattern.startsWith('*.')) {
      return name.endsWith(pattern.slice(1));
    }
    return name === pattern;
  }

  async closest(startUri: B6PUri, fileName: string, maxDepth: number = 10): Promise<B6PUri | null> {
    let currentPath = startUri.fsPath;
    let depth = 0;

    while (depth < maxDepth) {
      const targetPath = path.join(currentPath, fileName);
      try {
        await fs.access(targetPath);
        return B6PUri.fromFsPath(targetPath);
      } catch {
        // File doesn't exist in this directory, continue searching
      }

      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        break;
      }

      currentPath = parentPath;
      depth++;
    }

    return null;
  }

  isWritableFileSystem(scheme: string): boolean | undefined {
    if (scheme === 'file') {
      return true;
    }
    return undefined;
  }
}
