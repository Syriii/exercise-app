import type { Readable } from "node:stream";
import type { ImageAnalyzer } from "./analyzer.js";
import { DeepSeekImageAnalyzerError, imageAnalysisPromptVersion } from "./deepseek-analyzer.js";
import { ImageAnalysisError } from "./errors.js";
import type { ImageAnalysisRepository } from "./repository.js";
import type { ImageNutritionCandidate } from "./types.js";
import type { TemporaryMediaStore } from "../media/temporary-media-store.js";
import type { NutritionService } from "../nutrition/service.js";
import type { MealContributionMode } from "../nutrition/types.js";
import type { TaskQueue } from "../tasks/task-queue.js";

export const mealImageQueue = "meal-image-analysis";
export const mealImageQueueDefinition = { name: mealImageQueue, retryLimit: 0, retryDelaySeconds: 5, retryBackoff: false, expireInSeconds: 180, heartbeatSeconds: 30, deleteAfterSeconds: 86400 } as const;

export class ImageAnalysisService {
  public constructor(private readonly options: { repository: ImageAnalysisRepository; mediaStore: TemporaryMediaStore; queue: TaskQueue; analyzer: ImageAnalyzer | null; nutritionService: NutritionService; maxUploadBytes: number; maxActiveAnalysesPerAccount?: number; temporaryMediaMaxBytesPerAccount?: number; now?: () => Date }) {}

  public async request(userId: string, mealId: string, declaredContentType: string | undefined, source: NodeJS.ReadableStream) {
    if (this.options.analyzer === null) throw new ImageAnalysisError("image_analysis_unavailable", "图片分析尚未配置", 503);
    await this.options.nutritionService.getMeal(userId, mealId).catch(() => { throw new ImageAnalysisError("meal_not_found", "找不到这顿饭", 404); });
    const usage = await this.options.repository.getUsage(userId);
    if (usage.activeAnalyses >= (this.options.maxActiveAnalysesPerAccount ?? 3)) throw new ImageAnalysisError("image_analysis_capacity_reached", "当前已有多张照片等待分析，请完成后再上传", 429);
    let stored;
    try { stored = await this.options.mediaStore.put(source, { maxBytes: this.options.maxUploadBytes }); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "media_too_large") throw new ImageAnalysisError("image_too_large", "图片超过应用允许大小", 413); throw error; }
    try {
      if (usage.temporaryMediaBytes + stored.byteSize > (this.options.temporaryMediaMaxBytesPerAccount ?? 256 * 1024 * 1024)) throw new ImageAnalysisError("temporary_media_quota_reached", "临时照片空间已满，请等待处理或删除旧照片", 429);
      const actualContentType = await detectImageType(await readAll(await this.options.mediaStore.open(stored.objectKey), this.options.maxUploadBytes));
      if (actualContentType === null || (declaredContentType !== undefined && declaredContentType !== actualContentType)) throw new ImageAnalysisError("invalid_image", "只接受内容真实匹配的 JPEG、PNG、GIF 或 WebP 图片", 400);
      const created = await this.options.repository.create(userId, mealId, actualContentType, stored, new Date((this.options.now?.() ?? new Date()).getTime() + 24 * 60 * 60 * 1000), this.options.analyzer.model, imageAnalysisPromptVersion);
      await this.options.queue.enqueue(mealImageQueue, created.id);
      return created;
    } catch (error) { await this.options.mediaStore.delete(stored.objectKey); throw error; }
  }

  public async list(userId: string, mealId: string) { await this.options.nutritionService.getMeal(userId, mealId).catch(() => { throw new ImageAnalysisError("meal_not_found", "找不到这顿饭", 404); }); return this.options.repository.list(userId, mealId); }

  public async process(analysisId: string): Promise<void> {
    if (this.options.analyzer === null) throw new Error("image analyzer unavailable");
    const started = await this.options.repository.beginAttempt(analysisId);
    if (started === "not_found" || started === "not_ready") return;
    try {
      const image = await readAll(await this.options.mediaStore.open(started.work.objectKey), this.options.maxUploadBytes);
      const result = await this.options.analyzer.analyze(started.work.contentType, image);
      const completed = await this.options.repository.succeed(analysisId, started.attemptId, result.candidate, result.providerRequestId);
      if (completed !== "not_running" && !completed.tentativeHandled) {
        await this.options.nutritionService.ensureTentativeModelContribution(
          started.work.userId,
          started.work.mealId,
          analysisId,
          result.candidate,
        );
      }
    } catch (error) {
      const code = error instanceof DeepSeekImageAnalyzerError
        ? error.code
        : error instanceof Error && error.message.startsWith("deepseek_")
          ? error.message.slice(0, 100)
          : "analysis_failed";
      await this.options.repository.fail(analysisId, started.attemptId, code);
      throw error;
    }
  }

  public async retry(userId: string, analysisId: string, revision: number) {
    const usage = await this.options.repository.getUsage(userId);
    if (usage.activeAnalyses >= (this.options.maxActiveAnalysesPerAccount ?? 3)) throw new ImageAnalysisError("image_analysis_capacity_reached", "当前已有多张照片等待分析，请稍后重试", 429);
    const result = await this.options.repository.retry(userId, analysisId, revision);
    if (result === "not_found") throw new ImageAnalysisError("analysis_not_found", "找不到这次图片分析", 404);
    if (result === "revision_conflict") throw new ImageAnalysisError("analysis_revision_conflict", "分析状态已经变化，请刷新后重试", 409);
    if (result === "not_failed") throw new ImageAnalysisError("analysis_not_ready", "只有失败的分析可以重试", 409);
    await this.options.queue.enqueue(mealImageQueue, analysisId); return result;
  }

  public async adopt(userId: string, analysisId: string, analysisRevision: number, mealRevision: number, input: { mode: Extract<MealContributionMode, "whole_meal" | "supplement">; label: string; portionAmount: number | null; portionUnit: string | null; basisDescription: string | null; energyKcal: number | null; proteinGrams: number | null; carbohydrateGrams: number | null; fatGrams: number | null; replaceExisting: boolean; deleteOriginal: boolean }) {
    const analysis = await this.options.repository.get(userId, analysisId);
    if (analysis === null) throw new ImageAnalysisError("analysis_not_found", "找不到这次图片分析", 404);
    if (analysis.status !== "succeeded" || analysis.candidate === null || analysis.adoptedAt !== null) throw new ImageAnalysisError("analysis_not_ready", "分析尚未成功，或结果已经采用", 409);
    const meal = await this.options.nutritionService.adoptModelContribution(userId, analysis.mealId, mealRevision, analysisId, input, input.replaceExisting);
    const adopted = await this.options.repository.markAdopted(userId, analysisId, analysisRevision);
    if (typeof adopted === "string") throw new ImageAnalysisError("analysis_revision_conflict", "分析状态已经变化，请刷新后重试", 409);
    if (input.deleteOriginal) await this.deleteOriginal(adopted.id, adopted.imageAvailable);
    return { analysis: (await this.options.repository.get(userId, analysisId))!, meal };
  }

  private async deleteOriginal(analysisId: string, imageAvailable: boolean) {
    if (!imageAvailable) return;
    const work = await this.options.repository.getWorkItem(analysisId); if (work === null) return;
    await this.options.repository.markMediaStatus(work.mediaId, "deletion_pending");
    const deleted = await this.options.mediaStore.delete(work.objectKey);
    await this.options.repository.markMediaStatus(work.mediaId, deleted ? "deleted" : "missing");
  }
}

async function readAll(stream: Readable, maximum: number): Promise<Buffer> { const parts: Buffer[] = []; let size = 0; for await (const chunk of stream) { const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array); size += part.length; if (size > maximum) throw new ImageAnalysisError("image_too_large", "图片超过应用允许大小", 413); parts.push(part); } return Buffer.concat(parts); }
function detectImageType(value: Buffer): string | null { if (value.length >= 3 && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff) return "image/jpeg"; if (value.length >= 8 && value.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return "image/png"; if (value.length >= 6 && ["GIF87a","GIF89a"].includes(value.subarray(0,6).toString("ascii"))) return "image/gif"; if (value.length >= 12 && value.subarray(0,4).toString("ascii") === "RIFF" && value.subarray(8,12).toString("ascii") === "WEBP") return "image/webp"; return null; }

export class FixedImageAnalyzer implements ImageAnalyzer {
  public readonly model = "test-vision-model";
  public constructor(private readonly candidate: ImageNutritionCandidate, private readonly delayMs = 0) {}
  public async analyze() { if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs)); return { candidate: this.candidate, providerRequestId: "test-request" }; }
}
