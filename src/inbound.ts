// ---------------------------------------------------------------------------
// openclaw-rest-channel – Inbound HTTP route handler
// ---------------------------------------------------------------------------

import type { InboundMessagePayload, ResolvedRestAccount } from "./types.js";
import { timingSafeEqual } from "./crypto.js";

/**
 * Minimal IncomingMessage / ServerResponse shapes so we don't depend on the
 * full Node http types at the plugin boundary – OpenClaw hands us these.
 */
export interface GatewayRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  url?: string;
  on(event: string, cb: (...args: unknown[]) => void): void;
}

export interface GatewayResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the full request body as a string. */
function readBody(req: GatewayRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: unknown) => chunks.push(Buffer.from(chunk as Uint8Array)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Send a JSON error response. */
function jsonError(res: GatewayResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: message }));
}

/** Send a JSON success response. */
function jsonOk(res: GatewayResponse, data: Record<string, unknown>): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Validate & extract bearer token
// ---------------------------------------------------------------------------

function extractBearerToken(req: GatewayRequest): string | undefined {
  const auth = req.headers["authorization"];
  const value = Array.isArray(auth) ? auth[0] : auth;
  if (!value) return undefined;
  const parts = value.split(" ");
  if (parts.length === 2 && parts[0]!.toLowerCase() === "bearer") return parts[1];
  return undefined;
}

// ---------------------------------------------------------------------------
// Public handler factory
// ---------------------------------------------------------------------------

export interface InboundHandlerDeps {
  resolveAccount: (accountId: string) => ResolvedRestAccount | undefined;
  onMessage: (account: ResolvedRestAccount, message: InboundMessagePayload) => void | Promise<void>;
  logger: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
}

/**
 * Returns an HTTP handler for the inbound REST endpoint.
 *
 * Your external application POSTs JSON to this endpoint and OpenClaw
 * routes it into the messaging pipeline.
 */
export function createInboundHandler(deps: InboundHandlerDeps) {
  return async (req: GatewayRequest, res: GatewayResponse): Promise<boolean> => {
    // Only accept POST
    if (req.method !== "POST") {
      jsonError(res, 405, "Method not allowed. Use POST.");
      return true;
    }

    // Parse body
    let body: string;
    try {
      body = await readBody(req);
    } catch {
      jsonError(res, 400, "Failed to read request body");
      return true;
    }

    let payload: InboundMessagePayload;
    try {
      payload = JSON.parse(body) as InboundMessagePayload;
    } catch {
      jsonError(res, 400, "Invalid JSON body");
      return true;
    }

    // Validate required fields
    if (!payload.senderId || typeof payload.senderId !== "string") {
      jsonError(res, 400, 'Missing required field: "senderId"');
      return true;
    }

    if (!payload.text && (!payload.attachments || payload.attachments.length === 0)) {
      jsonError(res, 400, 'Message must include "text" or "attachments"');
      return true;
    }

    // Resolve target account
    const accountId = payload.accountId ?? "default";
    const account = deps.resolveAccount(accountId);

    if (!account) {
      jsonError(res, 404, `Account "${accountId}" not found or disabled`);
      return true;
    }

    // Authenticate if apiKey is configured
    if (account.apiKey) {
      const token = extractBearerToken(req);
      if (!token || !timingSafeEqual(token, account.apiKey)) {
        jsonError(res, 401, "Unauthorized – invalid or missing API key");
        return true;
      }
    }

    // Normalise defaults
    payload.conversationId ??= payload.senderId;
    payload.accountId = accountId;

    // Hand off to the channel pipeline
    try {
      await deps.onMessage(account, payload);
    } catch (err) {
      deps.logger.warn("[rest-channel] Error processing inbound message:", err);
      jsonError(res, 500, "Internal processing error");
      return true;
    }

    deps.logger.info(
      `[rest-channel] Received message from "${payload.senderId}" in conversation "${payload.conversationId}"`,
    );

    jsonOk(res, {
      ok: true,
      conversationId: payload.conversationId,
      accountId,
    });

    return true;
  };
}
