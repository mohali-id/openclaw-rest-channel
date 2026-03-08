// ---------------------------------------------------------------------------
// openclaw-rest-channel – Outbound webhook delivery
// ---------------------------------------------------------------------------

import type { ResolvedRestAccount, OutboundWebhookPayload } from "./types.js";
import { signPayload, generateMessageId } from "./crypto.js";

export interface SendTextOptions {
  account: ResolvedRestAccount;
  conversationId: string;
  recipientId: string;
  text: string;
  logger: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
}

/**
 * Deliver an outbound assistant reply to the configured webhook URL.
 *
 * Returns `{ ok: true }` on success, `{ ok: false, error }` otherwise.
 */
export async function deliverOutbound(
  opts: SendTextOptions,
): Promise<{ ok: boolean; error?: string }> {
  const { account, conversationId, recipientId, text, logger } = opts;

  if (!account.webhookUrl) {
    logger.warn(
      `[rest-channel] No webhookUrl configured for account "${account.accountId}" – message dropped`,
    );
    return { ok: false, error: "No webhookUrl configured" };
  }

  const payload: OutboundWebhookPayload = {
    channel: "rest",
    accountId: account.accountId,
    conversationId,
    recipientId,
    text,
    timestamp: new Date().toISOString(),
    messageId: generateMessageId(),
  };

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "openclaw-rest-channel/1.0",
  };

  // Sign the payload if a shared secret is configured
  if (account.webhookSecret) {
    headers["X-OpenClaw-Signature"] = `sha256=${signPayload(body, account.webhookSecret)}`;
  }

  try {
    const res = await fetch(account.webhookUrl, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(15_000), // 15 s timeout
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "(no body)");
      logger.warn(
        `[rest-channel] Webhook delivery failed: ${res.status} ${res.statusText} – ${errText}`,
      );
      return { ok: false, error: `HTTP ${res.status}: ${errText}` };
    }

    logger.info(
      `[rest-channel] Delivered message ${payload.messageId} to ${account.webhookUrl}`,
    );
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[rest-channel] Webhook delivery error: ${message}`);
    return { ok: false, error: message };
  }
}
