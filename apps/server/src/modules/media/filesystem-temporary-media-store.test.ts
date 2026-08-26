import { createHash } from "node:crypto";
import { readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { FileSystemTemporaryMediaStore } from "./filesystem-temporary-media-store.js";
import { TemporaryMediaStoreError } from "./temporary-media-store.js";

const directories: string[] = [];

async function createStore() {
  const directory = await mkdtemp(join(tmpdir(), "exercise-media-"));
  directories.push(directory);
  return { directory, store: new FileSystemTemporaryMediaStore(directory) };
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("FileSystemTemporaryMediaStore", () => {
  it("stores content under an opaque key and returns verified metadata", async () => {
    const { store } = await createStore();
    const content = Buffer.from("private meal image bytes");

    const result = await store.put(Readable.from(content), { maxBytes: 1024 });

    expect(result.objectKey).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}$/);
    expect(result.byteSize).toBe(content.byteLength);
    expect(result.sha256).toBe(createHash("sha256").update(content).digest("hex"));
    expect(await store.exists(result.objectKey)).toBe(true);
    expect(await readAll(await store.open(result.objectKey))).toEqual(content);
  });

  it("removes partial output when the size limit is exceeded", async () => {
    const { directory, store } = await createStore();

    await expect(store.put(Readable.from(Buffer.alloc(8)), { maxBytes: 4 })).rejects.toMatchObject({
      code: "media_too_large",
    });

    const years = await readdir(directory);
    expect(years).toEqual([String(new Date().getUTCFullYear())]);
    const monthDirectory = join(
      directory,
      years[0] ?? "",
      String(new Date().getUTCMonth() + 1).padStart(2, "0"),
    );
    expect(await readdir(monthDirectory)).toEqual([]);
  });

  it("rejects caller-controlled paths and makes deletion idempotent", async () => {
    const { store } = await createStore();
    await expect(store.open("../../secret")).rejects.toBeInstanceOf(TemporaryMediaStoreError);

    const stored = await store.put(Readable.from("content"), { maxBytes: 32 });
    expect(await store.delete(stored.objectKey)).toBe(true);
    expect(await store.delete(stored.objectKey)).toBe(false);
    expect(await store.exists(stored.objectKey)).toBe(false);
  });
});
