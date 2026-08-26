export type DiagnosticLevel = "info" | "warning" | "error";

export interface DiagnosticEvent {
  readonly occurredAt: string;
  readonly level: DiagnosticLevel;
  readonly category: "api" | "browser" | "application";
  readonly summary: string;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

const STORAGE_KEY = "exercise-app:diagnostic-events:v1";
const MAX_EVENTS = 60;
const MAX_TEXT_LENGTH = 500;
let initialized = false;
let events = restoreEvents();

function safeText(value: unknown, maximumLength = MAX_TEXT_LENGTH): string {
  const raw = value instanceof Error ? value.message : String(value ?? "unknown");
  const withoutOrigin = typeof window === "undefined" ? raw : raw.replaceAll(window.location.origin, "[当前站点]");
  return withoutOrigin
    .replace(/(authorization|cookie|password|token|secret|api[-_ ]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[已隐藏]")
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [已隐藏]")
    .slice(0, maximumLength);
}

function safePath(value: string): string {
  const pathname = value.split(/[?#]/, 1)[0] || "/";
  return pathname
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ":id")
    .replace(/\/[A-Za-z0-9_-]{25,}(?=\/|$)/g, "/:id");
}

function restoreEvents(): DiagnosticEvent[] {
  if (typeof sessionStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is DiagnosticEvent => {
        if (typeof item !== "object" || item === null) return false;
        const candidate = item as Partial<DiagnosticEvent>;
        return typeof candidate.occurredAt === "string" && typeof candidate.summary === "string";
      })
      .slice(-MAX_EVENTS);
  } catch {
    return [];
  }
}

function persistEvents(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // Diagnostics must never interrupt the product when browser storage is unavailable.
  }
}

export function recordDiagnosticEvent(event: Omit<DiagnosticEvent, "occurredAt">): void {
  events = [
    ...events,
    {
      ...event,
      occurredAt: new Date().toISOString(),
      summary: safeText(event.summary),
    },
  ].slice(-MAX_EVENTS);
  persistEvents();
}

export function recordApiOutcome(input: {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  readonly code?: string;
  readonly requestId?: string;
}): void {
  const successful = input.status >= 200 && input.status < 400;
  recordDiagnosticEvent({
    level: successful ? "info" : "error",
    category: "api",
    summary: `${input.method.toUpperCase()} ${safePath(input.path)} · ${input.status === 0 ? "网络失败" : `HTTP ${input.status}`}`,
    details: {
      durationMs: Math.max(0, Math.round(input.durationMs)),
      ...(input.code === undefined ? {} : { code: safeText(input.code) }),
      ...(input.requestId === undefined ? {} : { requestId: safeText(input.requestId) }),
    },
  });
}

export function initializeDiagnostics(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  window.addEventListener("error", (event) => {
    recordDiagnosticEvent({
      level: "error",
      category: "browser",
      summary: `未处理的页面错误：${safeText(event.error ?? event.message)}`,
      details: event.filename.length === 0
        ? undefined
        : { source: safeText(event.filename), line: event.lineno, column: event.colno },
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    recordDiagnosticEvent({
      level: "error",
      category: "browser",
      summary: `未处理的异步错误：${safeText(event.reason)}`,
    });
  });
  recordDiagnosticEvent({
    level: "info",
    category: "application",
    summary: "页面已启动",
    details: { path: safePath(window.location.pathname) },
  });
}

export function clearDiagnosticEvents(): void {
  events = [];
  persistEvents();
}

async function checkServerHealth(): Promise<string> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch("/api/v1/health/ready", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    return response.ok ? `可用（HTTP ${response.status}）` : `不可用（HTTP ${response.status}）`;
  } catch (error) {
    return error instanceof DOMException && error.name === "AbortError" ? "检查超时" : "无法连接";
  } finally {
    window.clearTimeout(timeout);
  }
}

function formatEvent(event: DiagnosticEvent): string {
  const detailText = event.details === undefined
    ? ""
    : ` · ${Object.entries(event.details).map(([key, value]) => `${key}=${safeText(value)}`).join(" · ")}`;
  return `- ${event.occurredAt} [${event.level}/${event.category}] ${event.summary}${detailText}`;
}

export async function buildProblemReport(description: string): Promise<string> {
  const health = await checkServerHealth();
  const currentEvents = [...events];
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
  const viewport = `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`;
  const lines = [
    "EXERCISE APP 问题报告",
    "",
    "[问题描述]",
    description.trim().length === 0 ? "未填写。请补充你刚才做了什么、预期怎样、实际发生了什么。" : safeText(description.trim(), 2_000),
    "",
    "[运行环境]",
    `生成时间：${new Date().toISOString()}`,
    `应用构建：${__APP_BUILD_REVISION__}`,
    `构建时间：${__APP_BUILD_TIME__}`,
    `页面：${safePath(window.location.pathname)}`,
    `服务端：${health}`,
    `网络状态：${navigator.onLine ? "在线" : "离线"}`,
    `时区：${timeZone}`,
    `语言：${navigator.language}`,
    `视口：${viewport}`,
    `浏览器：${safeText(navigator.userAgent)}`,
    "",
    `[近期前端事件，共 ${currentEvents.length} 条]`,
    ...(currentEvents.length === 0 ? ["- 暂无记录"] : currentEvents.map(formatEvent)),
    "",
    "[隐私说明]",
    "本报告由浏览器在本机生成，没有自动上传。自动收集内容不包含密码、Cookie、API Key、照片、请求体、响应体或训练饮食明细；问题描述由你填写，请勿粘贴敏感信息。分享前仍请自行快速检查内容。",
  ];
  return lines.join("\n");
}

export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Plain HTTP on an IP address often cannot use the modern Clipboard API.
    }
  }
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.append(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  textArea.remove();
  return copied;
}

export function downloadProblemReport(text: string): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const objectUrl = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `exercise-app-problem-report-${stamp}.txt`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
