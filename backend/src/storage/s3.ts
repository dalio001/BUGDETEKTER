import type { Readable } from 'node:stream';
import type { Config } from '../config.js';
import type { StorageDriver } from './index.js';

/**
 * S3-compatible driver (AWS S3, MinIO, R2, ...). Only loaded when
 * STORAGE_DRIVER=s3, so `@aws-sdk/client-s3` never touches local-disk setups.
 */
export class S3StorageDriver implements StorageDriver {
  private clientPromise: Promise<{
    client: import('@aws-sdk/client-s3').S3Client;
    sdk: typeof import('@aws-sdk/client-s3');
  }>;

  constructor(private s3Config: Config['s3']) {
    this.clientPromise = import('@aws-sdk/client-s3').then((sdk) => ({
      sdk,
      client: new sdk.S3Client({
        region: this.s3Config.region,
        endpoint: this.s3Config.endpoint,
        forcePathStyle: this.s3Config.forcePathStyle,
        credentials:
          this.s3Config.accessKeyId && this.s3Config.secretAccessKey
            ? { accessKeyId: this.s3Config.accessKeyId, secretAccessKey: this.s3Config.secretAccessKey }
            : undefined
      })
    }));
  }

  async put(key: string, data: Buffer, mimeType: string): Promise<void> {
    const { client, sdk } = await this.clientPromise;
    await client.send(
      new sdk.PutObjectCommand({ Bucket: this.s3Config.bucket, Key: key, Body: data, ContentType: mimeType })
    );
  }

  async getStream(key: string): Promise<Readable> {
    const { client, sdk } = await this.clientPromise;
    const result = await client.send(new sdk.GetObjectCommand({ Bucket: this.s3Config.bucket, Key: key }));
    return result.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    const { client, sdk } = await this.clientPromise;
    await client.send(new sdk.DeleteObjectCommand({ Bucket: this.s3Config.bucket, Key: key }));
  }
}
