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
  return new LocalStorageDriver(config.storageDir);
}
