import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import {
  TemporaryMediaStoreError,
  type PutTemporaryMediaOptions,
  type StoredTemporaryMedia,
  type TemporaryMediaStore,
} from "./temporary-media-store.js";

export class MemoryTemporaryMediaStore implements TemporaryMediaStore {
  readonly #values = new Map<string, Buffer>();

  public get size(): number {
    return this.#values.size;
  }

  public async put(
    source: NodeJS.ReadableStream,
    options: PutTemporaryMediaOptions,
  ): Promise<StoredTemporaryMedia> {
    const chunks: Buffer[] = [];
    let byteSize = 0;
    for await (const chunk of source) {
      const value =
        typeof chunk === "string"
          ? Buffer.from(chunk)
          : Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk);
      byteSize += value.byteLength;
      if (byteSize > options.maxBytes) {
        throw new TemporaryMediaStoreError("media_too_large", "临时媒体超过允许大小");
      }
      chunks.push(value);
    }
    if (byteSize === 0) {
      throw new TemporaryMediaStoreError("empty_media", "临时媒体不能为空");
    }
    const value = Buffer.concat(chunks);
    const objectKey = randomUUID();
    this.#values.set(objectKey, value);
    return {
      objectKey,
      byteSize,
      sha256: createHash("sha256").update(value).digest("hex"),
    };
  }

  public async open(objectKey: string): Promise<Readable> {
    const value = this.#values.get(objectKey);
    if (value === undefined) {
      throw new Error("temporary media not found");
    }
    return Readable.from(value);
  }

  public async exists(objectKey: string): Promise<boolean> {
    return this.#values.has(objectKey);
  }

  public async delete(objectKey: string): Promise<boolean> {
    return this.#values.delete(objectKey);
  }
}
