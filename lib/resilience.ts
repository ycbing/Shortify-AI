// ============================================
// Shortify AI - Resilience Utilities
// ============================================
// Unified retry, timeout, and concurrency control

import { createLogger } from "@/lib/logger";

const log = createLogger("resilience");

export interface RetryOptions {
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in ms (default: 2000) */
  baseDelayMs?: number;
  /** Max delay cap in ms (default: 30000) */
  maxDelayMs?: number;
  /** HTTP status codes that should trigger retry (default: [429, 500, 502, 503, 504]) */
  retryOnStatus?: number[];
  /** Error message substrings that should NOT trigger retry */
  noRetryOn?: string[];
  /** Called before each retry attempt */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

const DEFAULT_RETRY_ON_STATUS = [429, 500, 502, 503, 504];

/**
 * Execute an async function with exponential backoff retry.
 * Skips retry on 402 (payment) or on noRetryOn matches.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 2000,
    maxDelayMs = 30000,
    retryOnStatus = DEFAULT_RETRY_ON_STATUS,
    noRetryOn = [],
    onRetry,
  } = options || {};

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      // Don't retry on specific conditions
      if (noRetryOn.some((msg) => error.message.includes(msg))) {
        throw error;
      }

      // Check if this is an HTTP error worth retrying
      const statusMatch = retryOnStatus.some((code) =>
        error.message.includes(`${code} `) || error.message.includes(`status ${code}`)
      );
      const isNetworkError =
        error.message.includes("ECONNREFUSED") ||
        error.message.includes("ECONNRESET") ||
        error.message.includes("ETIMEDOUT") ||
        error.message.includes("fetch failed") ||
        error.message.includes("socket hang up");

      if (!statusMatch && !isNetworkError && attempt > 0) {
        throw error;
      }

      if (attempt >= maxRetries) {
        break;
      }

      const jitter = Math.random() * 1000;
      const delayMs = Math.min(baseDelayMs * Math.pow(2, attempt) + jitter, maxDelayMs);

      onRetry?.(attempt + 1, error, delayMs);
      log.warn(`Retry ${attempt + 1}/${maxRetries} after ${Math.round(delayMs)}ms`, {
        error: error.message,
      });

      await sleep(delayMs);
    }
  }

  throw lastError || new Error("Operation failed after retries");
}

/**
 * Execute an async function with a timeout.
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  label = "operation"
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`)),
      timeoutMs
    );
  });

  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

// ============================================
// Simple per-user concurrency limiter
// ============================================

const userActiveTasks = new Map<string, number>();
const MAX_CONCURRENT_PER_USER = 2;

export function tryAcquireUserSlot(userId: string): boolean {
  const current = userActiveTasks.get(userId) || 0;
  if (current >= MAX_CONCURRENT_PER_USER) {
    return false;
  }
  userActiveTasks.set(userId, current + 1);
  return true;
}

export function releaseUserSlot(userId: string) {
  const current = userActiveTasks.get(userId) || 0;
  userActiveTasks.set(userId, Math.max(0, current - 1));
}

export function getUserActiveCount(userId: string): number {
  return userActiveTasks.get(userId) || 0;
}

// ============================================
// Helpers
// ============================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
