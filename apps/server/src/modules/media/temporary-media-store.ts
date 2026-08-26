import type { Readable } from "node:stream";

export interface StoredTemporaryMedia {
  readonly objectKey: string;
  readonly byteSize: number;
  readonly sha256: string;
}

export interface PutTemporaryMediaOptions {
  readonly maxBytes: number;
}

export interface TemporaryMediaStore {
  put(source: NodeJS.ReadableStream, options: PutTemporaryMediaOptions): Promise<StoredTemporaryMedia>;
  open(objectKey: string): Promise<Readable>;
  exists(objectKey: string): Promise<boolean>;
  delete(objectKey: string): Promise<boolean>;
}

export type TemporaryMediaErrorCode =
  | "invalid_object_key"
  | "media_too_large"
  | "empty_media";

export class TemporaryMediaStoreError extends Error {
  public constructor(
    public readonly code: TemporaryMediaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TemporaryMediaStoreError";
  }
}
