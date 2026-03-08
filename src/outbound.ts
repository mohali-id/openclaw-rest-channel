// ---------------------------------------------------------------------------
// openclaw-rest-channel – Outbound webhook delivery
// ---------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import { basename, extname, resolve, isAbsolute } from "node:path";
import type {
  ResolvedRestAccount,
  OutboundWebhookPayload,
  OutboundAttachment,
} from "./types.js";
import { signPayload, generateMessageId } from "./crypto.js";

// Common extension → MIME type mapping for media files
const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".pdf": "application/pdf",
};

function guessMime(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export interface DeliverOutboundOptions {
  account: ResolvedRestAccount;
  conversationId: string;
  recipientId: string;
  text: string;
  /** Local file paths to media attachments (from ReplyPayload.mediaUrl / mediaUrls). */
  mediaPaths?: string[];
  /**
   * OpenClaw state directory (from `rt.state.resolveStateDir()`).
   * Relative media paths like `./media/inbound/...` are resolved against this.
   * Falls back to `process.cwd()` if not provided.
   */
  stateDir?: string;
  logger: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
}

/**
 * Convert a local file path to a data-URL (e.g. `data:image/png;base64,...`).
 */
async function fileToDataUrl(
  filePath: string,
  logger: { warn: (...a: unknown[]) => void },
): Promise<OutboundAttachment | null> {
  try {
    const buf = await readFile(filePath);
    const mime = guessMime(filePath);
    const base64 = buf.toString("base64");
    return {
      url: `data:${mime};base64,${base64}`,
      mimeType: mime,
      filename: basename(filePath),
    };
  } catch (err) {
    logger.warn(
      `[rest-channel] Failed to read media file "${filePath}": ${String(err)}`,
    );
    return null;
  }
}

/**
 * Deliver an outbound assistant reply to the configured webhook URL.
 *
 * Media files referenced by local paths are read from disk and embedded as
 * data-URLs in the `attachments` array of the webhook payload.
 *
 * Returns `{ ok: true }` on success, `{ ok: false, error }` otherwise.
 */
export async function deliverOutbound(
  opts: DeliverOutboundOptions,
): Promise<{ ok: boolean; error?: string }> {
  const { account, conversationId, recipientId, text, mediaPaths, stateDir, logger } =
    opts;

  if (!account.webhookUrl) {
    logger.warn(
      `[rest-channel] No webhookUrl configured for account "${account.accountId}" – message dropped`,
    );
    return { ok: false, error: "No webhookUrl configured" };
  }

  // Convert local media paths to data-URL attachments.
  // Relative paths (e.g. ./media/inbound/...) are resolved against the
  // OpenClaw state directory so they work regardless of process.cwd().
  let attachments: OutboundAttachment[] | undefined;
  if (mediaPaths && mediaPaths.length > 0) {
    const resolvedPaths = mediaPaths.map((p) =>
      isAbsolute(p) ? p : resolve(stateDir ?? process.cwd(), p),
    );
    const results = await Promise.all(
      resolvedPaths.map((p) => fileToDataUrl(p, logger)),
    );
    const valid = results.filter(
      (a): a is OutboundAttachment => a !== null,
    );
    if (valid.length > 0) {
      attachments = valid;
    }
  }

  const payload: OutboundWebhookPayload = {
    channel: "rest",
    accountId: account.accountId,
    conversationId,
    recipientId,
    text,
    attachments,
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
      `[rest-channel] Delivered message ${payload.messageId} (${attachments?.length ?? 0} attachment(s)) to ${account.webhookUrl}`,
    );
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[rest-channel] Webhook delivery error: ${message}`);
    return { ok: false, error: message };
  }
}
