// ---------------------------------------------------------------------------
// openclaw-rest-channel – Types
// ---------------------------------------------------------------------------

/**
 * Per-account configuration stored under:
 *   channels.rest.accounts.<accountId>
 */
export interface RestAccountConfig {
  /** Whether this account is active. Defaults to true. */
  enabled?: boolean;

  /**
   * URL where OpenClaw POSTs outbound messages (assistant replies).
   * Your application must accept JSON payloads at this endpoint.
   */
  webhookUrl?: string;

  /**
   * Shared HMAC-SHA256 secret used to sign outbound webhook payloads.
   * When set, every outbound request includes an `X-OpenClaw-Signature`
   * header so your app can verify authenticity.
   */
  webhookSecret?: string;

  /**
   * Bearer token that inbound callers must present in the
   * `Authorization: Bearer <key>` header when posting messages
   * to the Gateway inbound endpoint.
   */
  apiKey?: string;

  /**
   * Gateway HTTP path for receiving inbound messages for this account.
   * Defaults to `/rest/inbound` (shared across accounts).
   * Set a unique path per account if you run multiple REST integrations.
   */
  inboundPath?: string;

  /**
   * Allow fetching media attachments from private/internal network
   * addresses (e.g. localhost, 192.168.x.x, 10.x.x.x).
   *
   * Enable this when your application serves attachment files from a
   * local or private-network URL. Defaults to false.
   */
  allowPrivateNetwork?: boolean;

  /**
   * Maximum size (in MB) for a single media attachment download.
   * Attachments exceeding this limit are skipped. Defaults to 8 MB.
   */
  mediaMaxMb?: number;
}

/**
 * Top-level channel configuration shape:
 *   channels.rest { accounts: { [id]: RestAccountConfig } }
 */
export interface RestChannelConfig {
  accounts?: Record<string, RestAccountConfig>;
}

/**
 * Resolved account config returned by `resolveAccount`.
 * Always carries the `accountId` even when the raw config is sparse.
 */
export interface ResolvedRestAccount extends RestAccountConfig {
  accountId: string;
}

// ---------------------------------------------------------------------------
// Inbound message payload (what external apps POST to OpenClaw)
// ---------------------------------------------------------------------------

/** Media attachment sent alongside a message. */
export interface InboundAttachment {
  /** Public or data URL of the media file. */
  url: string;
  /** MIME type, e.g. "image/png", "audio/ogg". */
  mimeType?: string;
  /** Optional human-readable filename. */
  filename?: string;
}

/**
 * JSON body that external applications POST to the inbound endpoint.
 *
 * Minimal example:
 * ```json
 * { "senderId": "user-42", "text": "Hello!" }
 * ```
 */
export interface InboundMessagePayload {
  /** Unique identifier of the sender in your application. */
  senderId: string;

  /** Display name for the sender (optional). */
  senderName?: string;

  /** Text content of the message. */
  text?: string;

  /**
   * Conversation / thread identifier. Messages sharing the same
   * `conversationId` are grouped into one OpenClaw session.
   * Defaults to `senderId` when omitted (1:1 DM behavior).
   */
  conversationId?: string;

  /** Mark the message as coming from a group chat (multi-user). */
  isGroup?: boolean;

  /** Optional media attachments. */
  attachments?: InboundAttachment[];

  /**
   * Target account ID when multiple REST accounts are configured.
   * Defaults to `"default"`.
   */
  accountId?: string;

  /**
   * Arbitrary key/value metadata forwarded to session context.
   * Useful for passing user locale, timezone, app version, etc.
   */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Outbound webhook payload (what OpenClaw POSTs to your app)
// ---------------------------------------------------------------------------

/** Media attachment in an outbound message. */
export interface OutboundAttachment {
  url: string;
  mimeType?: string;
  filename?: string;
}

/**
 * JSON body that OpenClaw POSTs to your `webhookUrl`.
 */
export interface OutboundWebhookPayload {
  /** Static value: `"rest"`. */
  channel: "rest";

  /** The account ID that handled this conversation. */
  accountId: string;

  /** Conversation / thread ID (matches inbound `conversationId`). */
  conversationId: string;

  /** The sender ID of the original user (for routing on your side). */
  recipientId: string;

  /** Assistant reply text. */
  text: string;

  /** Optional media attachments from the assistant. */
  attachments?: OutboundAttachment[];

  /** ISO-8601 timestamp of when the message was generated. */
  timestamp: string;

  /**
   * Unique message ID for idempotency / deduplication.
   */
  messageId: string;
}
