import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config/environment.js";

interface WindowCounter {
  count: number;
  resetAt: number;
}

export class RequestRateLimiter {
  readonly #counters = new Map<string, WindowCounter>();
  readonly #now: () => number;

  public constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  public consume(key: string, maximum: number, windowSeconds: number): number | null {
    const now = this.#now();
    const existing = this.#counters.get(key);
    if (existing === undefined || existing.resetAt <= now) {
      this.#counters.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      this.#prune(now);
      return null;
    }
    if (existing.count >= maximum) {
      return Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    }
    existing.count += 1;
    return null;
  }

  #prune(now: number): void {
    if (this.#counters.size < 10_000) return;
    for (const [key, value] of this.#counters) {
      if (value.resetAt <= now) this.#counters.delete(key);
    }
  }
}

export function registerRequestRateLimits(
  app: FastifyInstance,
  config: AppConfig,
  limiter = new RequestRateLimiter(),
): void {
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?", 1)[0] ?? request.url;
    let rule:
      | { readonly name: string; readonly maximum: number; readonly windowSeconds: number }
      | undefined;
    if (request.method === "POST" && ["/api/v1/auth/login", "/api/v1/auth/register"].includes(path)) {
      rule = {
        name: "auth",
        maximum: config.authRateLimitMax,
        windowSeconds: config.authRateLimitWindowSeconds,
      };
    } else if (request.method === "POST" && path === "/api/v1/image-analyses") {
      rule = {
        name: "image",
        maximum: config.imageRateLimitMax,
        windowSeconds: config.imageRateLimitWindowSeconds,
      };
    } else if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && path.startsWith("/api/")) {
      rule = {
        name: "write",
        maximum: config.writeRateLimitMax,
        windowSeconds: config.writeRateLimitWindowSeconds,
      };
    }
    if (rule === undefined) return;

    const retryAfter = limiter.consume(`${rule.name}:${request.ip}`, rule.maximum, rule.windowSeconds);
    if (retryAfter === null) return;
    return reply
      .header("retry-after", retryAfter)
      .status(429)
      .send({
        code: "rate_limit_exceeded",
        message: "请求过于频繁，请稍后再试",
        requestId: request.id,
      });
  });
}
