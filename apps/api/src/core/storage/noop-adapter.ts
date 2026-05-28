/**
 * NoopAdapter — placeholder used when STORAGE_DRIVER='noop' (the dev default
 * before infra/docker is brought up).
 *
 * Every I/O method throws a clear error so a programmer who forgot to set
 * STORAGE_DRIVER finds out immediately. Pure helpers (`bucketName`, `publicUrl`)
 * return synthetic values so that `/readyz` and other diagnostics can still
 * render without exploding.
 */

import type {
  GetObjectStreamResult,
  ObjectHead,
  PresignedPutResult,
  PutObjectInput,
  StorageAdapter,
  StorageBucketKind,
} from './storage.types';

const ERR = 'STORAGE_DRIVER=noop — set STORAGE_DRIVER=minio (or r2/s3) and restart.';

export class NoopAdapter implements StorageAdapter {
  readonly driver = 'noop' as const;

  bucketName(kind: StorageBucketKind): string {
    return `noop-${kind}`;
  }

  presignPut(
    _kind: StorageBucketKind,
    _key: string,
    _contentType: string,
    _sizeBytes: number,
    _ttlSeconds: number,
  ): Promise<PresignedPutResult> {
    return Promise.reject(new Error(ERR));
  }

  presignGet(_kind: StorageBucketKind, _key: string, _ttlSeconds: number): Promise<string> {
    return Promise.reject(new Error(ERR));
  }

  publicUrl(kind: StorageBucketKind, key: string): string {
    return `noop://${this.bucketName(kind)}/${key}`;
  }

  head(_kind: StorageBucketKind, _key: string): Promise<ObjectHead | null> {
    return Promise.reject(new Error(ERR));
  }

  getObject(_kind: StorageBucketKind, _key: string): Promise<GetObjectStreamResult> {
    return Promise.reject(new Error(ERR));
  }

  putObject(_kind: StorageBucketKind, _key: string, _input: PutObjectInput): Promise<void> {
    return Promise.reject(new Error(ERR));
  }

  deleteObject(_kind: StorageBucketKind, _key: string): Promise<void> {
    return Promise.reject(new Error(ERR));
  }
}
