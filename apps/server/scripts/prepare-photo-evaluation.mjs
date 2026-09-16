/** Download a fixed public test sample, never account media. Usage: node .../prepare-photo-evaluation.mjs /private/output-dir
 * Nutrition5k / Google Research, CVPR 2021, CC-BY-4.0.
 * https://github.com/google-research-datasets/Nutrition5k
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const output = process.argv[2];
if (!output) throw new Error('Specify a private output directory');
const directory = resolve(output);
await mkdir(directory, { recursive: true, mode: 0o700 });
const base = 'https://storage.googleapis.com/nutrition5k_dataset/nutrition5k_dataset/';
const digest = value => createHash('sha256').update(value).digest('hex');
async function download(path) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Public download failed: ${response.status}/${path}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > 10 * 1024 * 1024) throw new Error('Unexpected public file size');
  return data;
}
const split = await download('dish_ids/splits/depth_test_ids.txt');
const ids = new Set(split.toString().trim().split(/\s+/));
const entries = [], sources = { split: digest(split) };
for (const cafe of ['cafe1', 'cafe2']) {
  const data = await download(`metadata/dish_metadata_${cafe}.csv`);
  sources[cafe] = digest(data);
  for (const line of data.toString().trim().split(/\r?\n/)) {
    const fields = line.split(',');
    if (!ids.has(fields[0])) continue;
    if (!/^dish_\d+$/.test(fields[0]) || (fields.length - 6) % 7 !== 0) throw new Error('Unexpected metadata layout');
    const [energyKcal, massGrams, fatGrams, carbohydrateGrams, proteinGrams] = fields.slice(1, 6).map(Number);
    if (![energyKcal, massGrams, fatGrams, carbohydrateGrams, proteinGrams].every(v => Number.isFinite(v) && v >= 0)) throw new Error('Invalid ground truth');
    if (massGrams < 100 || massGrams > 1000 || energyKcal === 0) continue;
    const ingredients = [];
    for (let i = 6; i < fields.length; i += 7) ingredients.push({ id: fields[i], name: fields[i + 1], massGrams: Number(fields[i + 2]) });
    entries.push({ id: fields[0], cafe, truth: { energyKcal, massGrams, fatGrams, carbohydrateGrams, proteinGrams }, ingredients });
  }
}
// Fixed seed and fixed count, chosen before any predictions. No outcome-dependent replacement.
entries.sort((a, b) => digest('exercise-photo-eval-v1:' + a.id).localeCompare(digest('exercise-photo-eval-v1:' + b.id)));
const selected = entries.slice(0, 20);
if (selected.length !== 20 || new Set(selected.map(x => x.id)).size !== 20) throw new Error('Insufficient unique samples');
const manifestPath = join(directory, 'manifest.json');
try { await readFile(manifestPath); throw new Error('Manifest already exists; preserve existing evaluation'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const samples = [];
for (const entry of selected) {
  const sourceUrl = base + `imagery/realsense_overhead/${entry.id}/rgb.png`;
  const image = await download(`imagery/realsense_overhead/${entry.id}/rgb.png`);
  if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Not a PNG');
  const imagePath = join(directory, entry.id + '.png');
  await writeFile(imagePath, image, { flag: 'wx', mode: 0o600 });
  samples.push({ ...entry, imagePath, sourceUrl, imageSha256: digest(image), contentType: 'image/png' });
}
const manifest = { schemaVersion: 1, dataset: 'Nutrition5k', license: 'CC-BY-4.0', attribution: 'Google Research / Thames et al., CVPR 2021', seed: 'exercise-photo-eval-v1', sources,
  limitation: 'US cafeteria overhead test sample; nutrition is ingredient-database-derived, not lab measured. Not representative of all Chinese meals. Hidden ingredients are not mandatory visible objects.', samples };
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ count: samples.length, manifestPath, manifestSha256: digest(await readFile(manifestPath)), modelCalls: 0 }));
