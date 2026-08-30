import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  findCatalogExerciseGuidance,
  getExerciseMediaFile,
  listExerciseCatalog,
} from "./exercise-catalog.js";

const temporaryRoots: string[] = [];

function createMediaRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "exercise-catalog-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "images"));
  mkdirSync(join(root, "videos"));
  writeFileSync(join(root, "images", "0001-test.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  writeFileSync(join(root, "videos", "0001-test.gif"), Buffer.from("GIF89a", "ascii"));
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("exercise catalog media", () => {
  it("only publishes media URLs when a separately supplied local file exists", () => {
    const withoutMedia = listExerciseCatalog({ query: "3/4 sit-up" });
    expect(withoutMedia[0]).toMatchObject({ id: "0001", imageUrl: null, animationUrl: null });

    const root = createMediaRoot();
    const withMedia = listExerciseCatalog({ query: "3/4 sit-up" }, root);
    expect(withMedia[0]).toMatchObject({
      id: "0001",
      imageUrl: "/api/v1/training/exercises/0001/media/image",
      animationUrl: "/api/v1/training/exercises/0001/media/animation",
    });
    expect(findCatalogExerciseGuidance("3/4 sit-up", root)).toMatchObject({
      imageUrl: "/api/v1/training/exercises/0001/media/image",
      animationUrl: "/api/v1/training/exercises/0001/media/animation",
    });
  });

  it("resolves only catalog IDs and fixed media kinds from the indexed root", () => {
    const root = createMediaRoot();
    expect(getExerciseMediaFile("0001", "image", root)).toMatchObject({ contentType: "image/jpeg" });
    expect(getExerciseMediaFile("0001", "animation", root)).toMatchObject({ contentType: "image/gif" });
    expect(getExerciseMediaFile("9999", "image", root)).toBeNull();
  });
});
