import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const sourcePath = resolve(repositoryRoot, "docs/exercises-dataset-main/data/exercises.json");
const outputPath = resolve(repositoryRoot, "apps/server/data/exercises.zh.json");
const sourceUrl = "https://github.com/hasaneyldrm/exercises-dataset";

function assertString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid ${field}`);
  }
  return value.trim();
}

function assertStringArray(value, field) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new Error(`Invalid ${field}`);
  }
  return value.map((item) => item.trim());
}

function validateGeneratedCatalog(catalog) {
  if (catalog.schemaVersion !== 1 || catalog.source?.url !== sourceUrl || catalog.source?.license !== "MIT") {
    throw new Error("Generated exercise catalog metadata is invalid");
  }
  if (!Array.isArray(catalog.exercises) || catalog.exercises.length !== 1324) {
    throw new Error("Generated exercise catalog must contain 1,324 entries");
  }
  const ids = new Set();
  for (const exercise of catalog.exercises) {
    if (ids.has(exercise.id)) throw new Error(`Duplicate exercise id ${exercise.id}`);
    ids.add(exercise.id);
    for (const forbiddenField of ["image", "gif_url", "videoUrl", "media_id", "attribution"]) {
      if (forbiddenField in exercise) throw new Error(`Media field ${forbiddenField} must not enter the generated catalog`);
    }
    assertString(exercise.id, "id");
    assertString(exercise.name, "name");
    assertString(exercise.bodyPart, "bodyPart");
    assertString(exercise.equipment, "equipment");
    assertString(exercise.target, "target");
    assertString(exercise.muscleGroup, "muscleGroup");
    assertStringArray(exercise.secondaryMuscles, "secondaryMuscles");
    assertStringArray(exercise.steps, "steps");
  }
}

async function main() {
  if (process.argv.includes("--check")) {
    const generated = JSON.parse(await readFile(outputPath, "utf8"));
    validateGeneratedCatalog(generated);
    return;
  }

  const sourceText = await readFile(sourcePath, "utf8");
  const source = JSON.parse(sourceText);
  if (!Array.isArray(source) || source.length !== 1324) {
    throw new Error("Source exercise dataset must contain 1,324 entries");
  }
  const catalog = {
    schemaVersion: 1,
    source: {
      name: "hasaneyldrm/exercises-dataset",
      url: sourceUrl,
      license: "MIT",
      sha256: createHash("sha256").update(sourceText).digest("hex"),
    },
    exercises: source.map((exercise) => ({
      id: assertString(exercise.id, "id"),
      name: assertString(exercise.name, "name"),
      bodyPart: assertString(exercise.body_part, "body_part"),
      equipment: assertString(exercise.equipment, "equipment"),
      target: assertString(exercise.target, "target"),
      muscleGroup: assertString(exercise.muscle_group, "muscle_group"),
      secondaryMuscles: assertStringArray(exercise.secondary_muscles, "secondary_muscles"),
      steps: assertStringArray(exercise.instruction_steps?.zh, "instruction_steps.zh"),
    })),
  };
  validateGeneratedCatalog(catalog);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

await main();
