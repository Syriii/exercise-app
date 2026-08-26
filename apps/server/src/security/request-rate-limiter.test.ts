import { describe, expect, it } from "vitest";

import { RequestRateLimiter } from "./request-rate-limiter.js";

describe("RequestRateLimiter", () => {
  it("limits one key without affecting another and resets after the configured window", () => {
    let now = 1_000;
    const limiter = new RequestRateLimiter(() => now);

    expect(limiter.consume("auth:one", 2, 60)).toBeNull();
    expect(limiter.consume("auth:one", 2, 60)).toBeNull();
    expect(limiter.consume("auth:one", 2, 60)).toBe(60);
    expect(limiter.consume("auth:two", 2, 60)).toBeNull();

    now += 60_000;
    expect(limiter.consume("auth:one", 2, 60)).toBeNull();
  });
});
