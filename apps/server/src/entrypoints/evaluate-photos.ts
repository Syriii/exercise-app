/** Explicit, bounded offline-account benchmark; never connects to the business database.
 * node dist/entrypoints/evaluate-photos.js manifest.json <approved-sha256> output.jsonl
 * Requires PHOTO_EVALUATION_APPROVED=true after user approval for the specific dataset.
 */
import { readFile, open } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, dirname, resolve } from "node:path";
import { readSecretValue } from "../config/environment.js";
import { DeepSeekImageAnalyzer, DeepSeekImageAnalyzerError, imageAnalysisPromptVersion } from "../modules/image-analysis/deepseek-analyzer.js";
import type { ImageAnalyzerCall } from "../modules/image-analysis/analyzer.js";
import { predictionValues, summarizeEvaluation, type EvaluationRecord, type EvaluationValues } from "../testing/photo-evaluation.js";

const [manifestPath, approvedHash, output] = process.argv.slice(2);
if (!manifestPath || !approvedHash || !output || process.env.PHOTO_EVALUATION_APPROVED !== "true") throw new Error("evaluation_requires_explicit_approval");
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const manifestBytes = await readFile(manifestPath);
if (hash(manifestBytes) !== approvedHash) throw new Error("approved_manifest_changed");
const manifest = JSON.parse(manifestBytes.toString()) as { dataset: string; license: string; samples: { id: string; imagePath: string; imageSha256: string; sourceUrl: string; contentType: string; truth: EvaluationValues }[] };
const nutrition5k = manifest.dataset === "Nutrition5k" && manifest.license === "CC-BY-4.0";
const diningBench = manifest.dataset === "DiningBench" && manifest.license === "CC-BY-NC-ND-4.0";
if ((!nutrition5k && !diningBench) || !Array.isArray(manifest.samples) || manifest.samples.length < 1 || manifest.samples.length > 30 || new Set(manifest.samples.map(sample => sample.id)).size !== manifest.samples.length) throw new Error("invalid_evaluation_manifest");
const images: Buffer[] = [];
for (const sample of manifest.samples) {
  const url = new URL(sample.sourceUrl);
  const approvedNutrition5k = nutrition5k && /^dish_\d+$/.test(sample.id) && url.origin === "https://storage.googleapis.com"
    && url.pathname === `/nutrition5k_dataset/nutrition5k_dataset/imagery/realsense_overhead/${sample.id}/rgb.png` && sample.contentType === "image/png";
  const approvedDiningBench = diningBench && /^dining_\d{5}$/.test(sample.id) && url.origin === "https://huggingface.co"
    && url.pathname === "/datasets/meituan/DiningBench/resolve/77296fce4f7bfef305d3b134a0180f2c27024fa3/images.tar.gz"
    && new RegExp(`^#images/${sample.id.slice(7)}_\\d+\\.jpg$`).test(url.hash) && sample.contentType === "image/jpeg";
  if (!approvedNutrition5k && !approvedDiningBench) throw new Error("unapproved_image_source");
  if (!isAbsolute(sample.imagePath) || dirname(resolve(sample.imagePath)) !== dirname(resolve(manifestPath))) throw new Error("image_outside_manifest_directory");
  const bytes = await readFile(sample.imagePath);
  if (bytes.length > 10 * 1024 * 1024 || hash(bytes) !== sample.imageSha256) throw new Error("image_changed");
  images.push(bytes);
}
const apiKey = readSecretValue("DEEPSEEK_API_KEY", process.env, path => readFileSync(path, "utf8"));
const analyzer = new DeepSeekImageAnalyzer({ apiKey, baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com", model: process.env.DEEPSEEK_VISION_MODEL ?? "deepseek-v4-flash-vision-exp", timeoutMs: 120_000, retryLimit: 0 });
const file = await open(output, "wx", 0o600); // Never overwrite or automatically resume an uncertain paid call.
const records: EvaluationRecord[] = [];
const calls: ImageAnalyzerCall[] = [];
try {
  await file.write(JSON.stringify({ type: "metadata", dataset: manifest.dataset, manifestSha256: approvedHash, model: analyzer.model, promptVersion: imageAnalysisPromptVersion, retryLimit: 0, sampleCount: manifest.samples.length }) + "\n");
  for (const [index, sample] of manifest.samples.entries()) {
    await file.write(JSON.stringify({ type: "request_started", id: sample.id, at: new Date().toISOString() }) + "\n");
    await file.sync();
    let row: EvaluationRecord;
    try {
      // No dish IDs, ground-truth names, weights or nutrition labels enter the model input.
      const result = await analyzer.analyze(sample.contentType, images[index]!);
      calls.push(...(result.calls ?? []));
      row = { id: sample.id, truth: sample.truth, prediction: predictionValues(result.candidate), error: null };
      await file.write(JSON.stringify({ type: "prediction", ...row, foods: result.candidate.foods ?? null, candidate: result.candidate, usage: result.usage ?? null, calls: result.calls ?? [], durationMs: result.durationMs ?? null, providerModel: result.providerModel ?? null }) + "\n");
    } catch (error) {
      if (error instanceof DeepSeekImageAnalyzerError) calls.push(...error.calls);
      row = { id: sample.id, truth: sample.truth, prediction: null, error: error instanceof DeepSeekImageAnalyzerError ? error.code : "evaluation_request_failed" };
      await file.write(JSON.stringify({ type: "prediction", ...row, calls: error instanceof DeepSeekImageAnalyzerError ? error.calls : [] }) + "\n");
    }
    records.push(row); await file.sync();
    console.log(JSON.stringify({ completed: records.length, total: manifest.samples.length, failed: row.error !== null }));
  }
  await file.write(JSON.stringify({ type: "summary", ...summarizeEvaluation(records), modelRequests: calls.length,
    pricedRequests: calls.filter(call => call.cost !== null).length,
    estimatedCostCny: { minimum: calls.reduce((sum, call) => sum + (call.cost?.minimumCny ?? 0), 0),
      maximum: calls.reduce((sum, call) => sum + (call.cost?.maximumCny ?? 0), 0),
      unknownRequests: calls.filter(call => call.cost === null).length } }) + "\n");
} finally { await file.close(); }
