// ---------------------------------------------------------------------------
// Shared types for the webchat example
// ---------------------------------------------------------------------------

export interface Attachment {
  id: string;
  url: string;
  mimeType: string;
  filename: string;
  /** Local preview URL (blob) — only on the client side */
  previewUrl?: string;
  /** File size in bytes */
  size?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: Attachment[];
  timestamp: string;
  status?: "sending" | "sent" | "error";
}

/** Inbound payload we POST to OpenClaw */
export interface SendMessagePayload {
  text?: string;
  attachments?: { url: string; mimeType: string; filename: string }[];
  conversationId: string;
}

/** Outbound webhook payload from OpenClaw */
export interface WebhookPayload {
  channel: "rest";
  accountId: string;
  conversationId: string;
  recipientId: string;
  text: string;
  attachments?: { url: string; mimeType?: string; filename?: string }[];
  timestamp: string;
  messageId: string;
}
