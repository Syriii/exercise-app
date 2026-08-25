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
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  if (!response.ok) {
    let body: ApiErrorBody = {};
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // Non-JSON failures still become one predictable application error.
    }
    throw new ApiError(response.status, body);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
