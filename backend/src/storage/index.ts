import type { Readable } from 'node:stream';
import type { Config } from '../config.js';
import { LocalStorageDriver } from './local.js';

export interface StorageDriver {
  put(key: string, data: Buffer, mimeType: string): Promise<void>;
  getStream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

export async function createStorage(config: Config): Promise<StorageDriver> {
  if (config.storageDriver === 's3') {
    // Lazy import so local-disk deployments never load (or need) the AWS SDK.
    const { S3StorageDriver } = await import('./s3.js');
    return new S3StorageDriver(config.s3);
  }
  const local = new LocalStorageDriver(config.storageDir);
  const problem = await local.checkWritable();
  if (problem) {
    console.warn(
      `[bugdetekter] WARNING: STORAGE_DIR (${config.storageDir}) is not writable: ${problem}\n` +
        '  Error capture still works; screenshot/attachment uploads will fail.\n' +
        '  Usually a volume owned by root while the app runs as the non-root `node` user.\n' +
        '  Docker: docker compose run --rm --user root app chown -R node:node ' +
        `${config.storageDir}\n` +
        '  Railway/Fly: set RAILWAY_RUN_UID=0 (Railway) or run the container as root.'
    );
  }
  return local;
}
