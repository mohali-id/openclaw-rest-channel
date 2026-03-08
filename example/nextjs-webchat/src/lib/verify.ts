// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhookSignature(
  body: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;

  const expected =
    "sha256=" +
    createHmac("sha256", secret).update(body, "utf8").digest("hex");

  if (signature.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
