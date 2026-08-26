import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  TemporaryMediaStoreError,
  type PutTemporaryMediaOptions,
  type StoredTemporaryMedia,
  type TemporaryMediaStore,
} from "./temporary-media-store.js";

class MediaInspector extends Transform {
  readonly #hash = createHash("sha256");
  readonly #maxBytes: number;
  #byteSize = 0;

  public constructor(maxBytes: number) {
    super();
    this.#maxBytes = maxBytes;
  }

  public get byteSize(): number {
    return this.#byteSize;
  }

  public digest(): string {
    return this.#hash.digest("hex");
  }

  public override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.#byteSize += chunk.byteLength;
    if (this.#byteSize > this.#maxBytes) {
      callback(new TemporaryMediaStoreError("media_too_large", "临时媒体超过允许大小"));
      return;
    }
    this.#hash.update(chunk);
    callback(null, chunk);
  }
}

export class FileSystemTemporaryMediaStore implements TemporaryMediaStore {
  readonly #root: string;

  public constructor(root: string) {
    this.#root = resolve(root);
  }

  public async put(
    source: NodeJS.ReadableStream,
    options: PutTemporaryMediaOptions,
  ): Promise<StoredTemporaryMedia> {
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
      throw new RangeError("maxBytes must be a positive safe integer");
    }

    const now = new Date();
    const objectKey = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
    const destination = this.#pathFor(objectKey);
    const partial = `${destination}.${randomUUID()}.partial`;
    const inspector = new MediaInspector(options.maxBytes);

    await mkdir(dirname(destination), { recursive: true });
    try {
      await pipeline(source, inspector, createWriteStream(partial, { flags: "wx", mode: 0o600 }));
      if (inspector.byteSize === 0) {
        throw new TemporaryMediaStoreError("empty_media", "临时媒体不能为空");
      }
      await rename(partial, destination);
      return {
        objectKey,
        byteSize: inspector.byteSize,
        sha256: inspector.digest(),
      };
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
  }

  public async open(objectKey: string) {
    const path = this.#pathFor(objectKey);
    await access(path);
    return createReadStream(path);
  }

  public async exists(objectKey: string): Promise<boolean> {
    try {
      await access(this.#pathFor(objectKey));
      return true;
    } catch (error) {
      if (error instanceof TemporaryMediaStoreError) {
        throw error;
      }
      return false;
    }
  }

  public async delete(objectKey: string): Promise<boolean> {
    const path = this.#pathFor(objectKey);
    try {
      await access(path);
    } catch {
      return false;
    }
    await rm(path);
    return true;
  }

  #pathFor(objectKey: string): string {
    if (!/^[0-9]{4}\/[0-9]{2}\/[0-9a-f-]{36}$/.test(objectKey)) {
      throw new TemporaryMediaStoreError("invalid_object_key", "临时媒体对象键无效");
    }
    const path = resolve(join(this.#root, objectKey));
    const pathRelativeToRoot = relative(this.#root, path);
    if (pathRelativeToRoot.startsWith(`..${sep}`) || pathRelativeToRoot === "..") {
      throw new TemporaryMediaStoreError("invalid_object_key", "临时媒体对象键无效");
    }
    return path;
  }
}
