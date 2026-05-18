const buckets = new Map<string, { tokens: number; lastRefill: number }>();

const DEFAULTS = {
  maxRequests: 30,
  windowMs: 60_000,
};

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

export function checkRateLimit(
  key: string,
  maxRequests: number = DEFAULTS.maxRequests,
  windowMs: number = DEFAULTS.windowMs
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key) || { tokens: maxRequests, lastRefill: now };

  const elapsed = now - bucket.lastRefill;
  if (elapsed >= windowMs) {
    bucket.tokens = maxRequests;
    bucket.lastRefill = now;
  }

  if (bucket.tokens <= 0) {
    const resetMs = windowMs - elapsed;
    return { allowed: false, remaining: 0, resetMs };
  }

  bucket.tokens--;
  buckets.set(key, bucket);

  return {
    allowed: true,
    remaining: bucket.tokens,
    resetMs: windowMs - elapsed,
  };
}

export function rateLimitMiddleware(
  maxRequests: number = 30,
  windowMs: number = 60_000
) {
  return (request: Request): RateLimitResult | null => {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "anonymous";
    const url = new URL(request.url);
    const key = `${ip}:${url.pathname}`;
    return checkRateLimit(key, maxRequests, windowMs);
  };
}

// Clean up stale entries every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.lastRefill > DEFAULTS.windowMs * 2) {
        buckets.delete(key);
      }
    }
  }, 300_000);
}
