import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { StorageDriver } from './index.js';

export class LocalStorageDriver implements StorageDriver {
  constructor(private baseDir: string) {}

  /**
   * Prove the upload directory is actually writable, at boot.
   *
   * Nothing writes here until someone attaches a screenshot, so a permission
   * problem would otherwise surface days later as a 500 on an upload. The common
   * cause is a mounted volume owned by root while the container runs as the
   * non-root `node` user — true of Railway/Fly volumes and of any pre-existing
   * Docker named volume. Returns the reason instead of throwing: the error
   * monitoring this tool exists for works fine without attachments, so a broken
   * uploads dir must not take the whole service down.
   */
  async checkWritable(): Promise<string | null> {
    const probe = path.join(path.resolve(this.baseDir), '.write-probe');
    try {
      await mkdir(path.resolve(this.baseDir), { recursive: true });
      await writeFile(probe, '');
      await unlink(probe);
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  }

  private resolve(key: string): string {
    const full = path.resolve(this.baseDir, key);
    const base = path.resolve(this.baseDir);
    if (!full.startsWith(base + path.sep)) {
      throw new Error(`invalid storage key: ${key}`);
    }
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async getStream(key: string): Promise<Readable> {
    return createReadStream(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await unlink(this.resolve(key)).catch(() => {});
  }
}
