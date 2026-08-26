import { recordApiOutcome } from "../support/diagnostics";

export interface ApiErrorBody {
  readonly code?: string;
  readonly message?: string;
  readonly requestId?: string;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly requestId?: string;

  public constructor(status: number, body: ApiErrorBody) {
    super(body.message ?? "请求没有成功，请稍后重试");
    this.name = "ApiError";
    this.status = status;
    this.code = body.code ?? "request_failed";
    this.requestId = body.requestId;
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const startedAt = performance.now();
  const method = init.method ?? "GET";
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: "same-origin",
    });
  } catch (error) {
    recordApiOutcome({ method, path, status: 0, durationMs: performance.now() - startedAt, code: "network_error" });
    throw error;
  }
  if (!response.ok) {
    let body: ApiErrorBody = {};
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // Non-JSON failures still become one predictable application error.
    }
    recordApiOutcome({
      method,
      path,
      status: response.status,
      durationMs: performance.now() - startedAt,
      code: body.code,
      requestId: body.requestId ?? response.headers.get("x-request-id") ?? undefined,
    });
    throw new ApiError(response.status, body);
  }
  recordApiOutcome({
    method,
    path,
    status: response.status,
    durationMs: performance.now() - startedAt,
    requestId: response.headers.get("x-request-id") ?? undefined,
  });
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function uploadBinary<T>(path: string, file: File, onProgress: (percent: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const request = new XMLHttpRequest();
    request.open("POST", path);
    request.withCredentials = true;
    request.setRequestHeader("content-type", file.type);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      let body: unknown = {};
      try { body = request.responseText.length === 0 ? {} : JSON.parse(request.responseText); } catch { /* handled below */ }
      if (request.status >= 200 && request.status < 300) {
        recordApiOutcome({ method: "POST", path, status: request.status, durationMs: performance.now() - startedAt, requestId: request.getResponseHeader("x-request-id") ?? undefined });
        onProgress(100);
        resolve(body as T);
        return;
      }
      const errorBody = typeof body === "object" && body !== null ? body as ApiErrorBody : {};
      recordApiOutcome({ method: "POST", path, status: request.status, durationMs: performance.now() - startedAt, code: errorBody.code, requestId: errorBody.requestId ?? request.getResponseHeader("x-request-id") ?? undefined });
      reject(new ApiError(request.status, errorBody));
    });
    request.addEventListener("error", () => { recordApiOutcome({ method: "POST", path, status: 0, durationMs: performance.now() - startedAt, code: "network_error" }); reject(new ApiError(0, { code: "network_error", message: "网络连接中断，照片尚未上传完成" })); });
    request.addEventListener("abort", () => { recordApiOutcome({ method: "POST", path, status: 0, durationMs: performance.now() - startedAt, code: "upload_aborted" }); reject(new ApiError(0, { code: "upload_aborted", message: "照片上传已取消" })); });
    request.send(file);
  });
}
