export interface PreparedMealImage {
  readonly file: File;
  readonly originalBytes: number;
  readonly uploadBytes: number;
  readonly compressed: boolean;
}

const maximumDimension = 1920;
const webpQuality = 0.82;

export async function prepareMealImage(file: File): Promise<PreparedMealImage> {
  if (file.type === "image/gif" || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return original(file);
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maximumDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (context === null) {
      bitmap.close();
      return original(file);
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", webpQuality));
    if (blob === null || blob.size >= file.size) return original(file);
    const baseName = file.name.replace(/\.[^.]+$/, "") || "meal-photo";
    const prepared = new File([blob], `${baseName}.webp`, { type: "image/webp", lastModified: file.lastModified });
    return { file: prepared, originalBytes: file.size, uploadBytes: prepared.size, compressed: true };
  } catch {
    return original(file);
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`;
}

function original(file: File): PreparedMealImage {
  return { file, originalBytes: file.size, uploadBytes: file.size, compressed: false };
}
