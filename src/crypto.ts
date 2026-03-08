// ---------------------------------------------------------------------------
// openclaw-rest-channel – Crypto helpers
// ---------------------------------------------------------------------------

import { createHmac, randomUUID } from "node:crypto";

/**
 * Compute HMAC-SHA256 hex digest for webhook payload signing.
 */
export function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/**
 * Generate a unique message ID.
 */
export function generateMessageId(): string {
  return `rest-${randomUUID()}`;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // Node.js crypto.timingSafeEqual requires same length
  try {
    const { timingSafeEqual: tsEqual } = require("node:crypto");
    return tsEqual(bufA, bufB);
  } catch {
    // Fallback – still constant-time for equal-length buffers
    let result = 0;
    for (let i = 0; i < bufA.length; i++) {
      result |= (bufA[i] as number) ^ (bufB[i] as number);
    }
    return result === 0;
  }
}
