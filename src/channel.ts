// ---------------------------------------------------------------------------
// openclaw-rest-channel – Plugin entry point
// ---------------------------------------------------------------------------
//
// A minimal REST-based channel plugin for OpenClaw.
//
// Inbound:  External apps POST JSON to the Gateway HTTP endpoint.
//           The message is routed through OpenClaw's AI pipeline via
//           dispatchReplyWithBufferedBlockDispatcher.
// Outbound: The AI reply is delivered to your configured webhookUrl
//           via the dispatcher's deliver callback.
//
// Install:
//   openclaw plugins install openclaw-rest-channel
//
// Config (in ~/.openclaw/openclaw.json):
//   channels: {
//     rest: {
//       accounts: {
//         default: {
//           webhookUrl: "https://your-app.example.com/openclaw/webhook",
//           webhookSecret: "your-shared-secret",
//           apiKey: "your-inbound-api-key",
//         },
//       },
//     },
//   }
// ---------------------------------------------------------------------------

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { registerPluginHttpRoute } from "openclaw/plugin-sdk";

import type {
  RestChannelConfig,
  ResolvedRestAccount,
  RestAccountConfig,
  InboundMessagePayload,
} from "./types.js";
import { createInboundHandler } from "./inbound.js";
import { deliverOutbound } from "./outbound.js";
import { generateMessageId } from "./crypto.js";
import { setRestRuntime, getRestRuntime } from "./runtime.js";

// Re-export types for consumers
export type {
  RestAccountConfig,
  RestChannelConfig,
  ResolvedRestAccount,
  InboundMessagePayload,
  OutboundWebhookPayload,
  InboundAttachment,
  OutboundAttachment,
} from "./types.js";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

const CHANNEL_ID = "rest";
const DEFAULT_PATH = "/rest/inbound";

function getChannelConfig(cfg: Record<string, unknown>): RestChannelConfig | undefined {
  const channels = cfg?.channels as Record<string, unknown> | undefined;
  return channels?.rest as RestChannelConfig | undefined;
}

function listAccountIds(cfg: Record<string, unknown>): string[] {
  const rest = getChannelConfig(cfg);
  return Object.keys(rest?.accounts ?? {});
}

function resolveAccount(
  cfg: Record<string, unknown>,
  accountId?: string | null,
): ResolvedRestAccount | undefined {
  const rest = getChannelConfig(cfg);
  const id = accountId ?? "default";
  const raw = rest?.accounts?.[id];
  if (!raw) return undefined;
  if (raw.enabled === false) return undefined;
  return { ...raw, accountId: id };
}

// ---------------------------------------------------------------------------
// Helper: keep alive until abort signal fires
// ---------------------------------------------------------------------------

function waitUntilAbort(signal?: AbortSignal, onAbort?: () => void): Promise<void> {
  return new Promise((resolve) => {
    const complete = () => {
      onAbort?.();
      resolve();
    };
    if (!signal) return;
    if (signal.aborted) {
      complete();
      return;
    }
    signal.addEventListener("abort", complete, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Track registered route unregister callbacks to avoid duplicates
// ---------------------------------------------------------------------------

const activeRouteUnregisters = new Map<string, () => void>();

// ---------------------------------------------------------------------------
// Channel plugin definition
// ---------------------------------------------------------------------------

const restChannelPlugin = {
  id: CHANNEL_ID,

  meta: {
    id: CHANNEL_ID,
    label: "REST",
    selectionLabel: "REST (HTTP API)",
    docsPath: "/channels/rest",
    blurb: "Connect any external app to OpenClaw via simple HTTP requests.",
    aliases: ["rest-api", "http"] as string[],
  },

  capabilities: {
    chatTypes: ["direct", "group"] as string[],
    media: true,
  },

  // -------------------------------------------------------------------------
  // Messaging adapter – tells OpenClaw how to recognize & normalize targets
  // -------------------------------------------------------------------------
  // Without this, `openclaw message send --channel rest --target <id>` fails
  // with "Unknown target" because the core has no way to validate the target.
  //
  // REST targets are free-form identifiers (UUIDs, user IDs, etc.) defined
  // by the external application – any non-empty string is valid.
  messaging: {
    normalizeTarget: (raw: string): string | undefined => {
      const trimmed = raw.trim();
      if (!trimmed) return undefined;
      // Strip optional "rest:" prefix for convenience
      return trimmed.replace(/^rest:/i, "").trim() || undefined;
    },

    targetResolver: {
      looksLikeId: (_raw: string, normalized?: string): boolean => {
        // REST targets are opaque identifiers managed by the external app.
        // Any non-empty normalized value is treated as a valid direct ID
        // so the core skips directory lookup (REST has no directory).
        return !!normalized?.trim();
      },
      hint: "<senderId|conversationId|any-external-id>",
    },
  },

  reload: { configPrefixes: [`channels.${CHANNEL_ID}`] },

  config: {
    listAccountIds: (cfg: Record<string, unknown>) => listAccountIds(cfg),

    resolveAccount: (cfg: Record<string, unknown>, accountId?: string | null) =>
      resolveAccount(cfg, accountId),

    inspectAccount: (cfg: Record<string, unknown>, accountId?: string | null) => {
      const rest = getChannelConfig(cfg);
      const id = accountId ?? "default";
      const raw = rest?.accounts?.[id];
      if (!raw) return { accountId: id, configured: false, enabled: false };
      return {
        accountId: id,
        configured: true,
        enabled: raw.enabled !== false,
        webhookUrl: raw.webhookUrl ? "configured" : "not set",
        apiKeyStatus: raw.apiKey ? "available" : "not set",
      };
    },
  },

  outbound: {
    deliveryMode: "direct" as const,

    resolveTarget: (params: {
      cfg?: Record<string, unknown>;
      to?: string;
      allowFrom?: string[];
      accountId?: string | null;
      mode?: string;
    }): { ok: true; to: string } | { ok: false; error: Error } => {
      const to = params.to?.trim();
      if (!to) {
        return { ok: false, error: new Error("No target specified for REST channel") };
      }
      return { ok: true, to };
    },

    sendText: async (ctx: {
      cfg: Record<string, unknown>;
      to: string;
      text: string;
      accountId?: string | null;
      [key: string]: unknown;
    }) => {
      const account = resolveAccount(ctx.cfg, ctx.accountId);
      if (!account) {
        return {
          channel: CHANNEL_ID,
          messageId: generateMessageId(),
        };
      }
      const result = await deliverOutbound({
        account,
        conversationId: ctx.to,
        recipientId: ctx.to,
        text: ctx.text,
        logger: { info: console.log, warn: console.warn },
      });
      return {
        channel: CHANNEL_ID,
        messageId: generateMessageId(),
        conversationId: ctx.to,
        ...(result.ok ? {} : { meta: { error: result.error } }),
      };
    },

    sendMedia: async (ctx: {
      cfg: Record<string, unknown>;
      to: string;
      text: string;
      mediaUrl?: string;
      mediaLocalRoots?: readonly string[];
      accountId?: string | null;
      [key: string]: unknown;
    }) => {
      const account = resolveAccount(ctx.cfg, ctx.accountId);
      if (!account) {
        return {
          channel: CHANNEL_ID,
          messageId: generateMessageId(),
        };
      }
      const mediaPaths = ctx.mediaUrl ? [ctx.mediaUrl] : undefined;

      // Resolve the state directory so relative media paths work correctly
      let stateDir: string | undefined;
      try {
        const rt = getRestRuntime();
        stateDir = rt.state.resolveStateDir();
      } catch {
        // Runtime may not be available in all outbound contexts
      }

      const result = await deliverOutbound({
        account,
        conversationId: ctx.to,
        recipientId: ctx.to,
        text: ctx.text,
        mediaPaths,
        stateDir,
        logger: { info: console.log, warn: console.warn },
      });
      return {
        channel: CHANNEL_ID,
        messageId: generateMessageId(),
        conversationId: ctx.to,
        ...(result.ok ? {} : { meta: { error: result.error } }),
      };
    },
  },

  // -------------------------------------------------------------------------
  // Gateway adapter – wires inbound HTTP messages into the AI pipeline
  // -------------------------------------------------------------------------
  gateway: {
    startAccount: async (ctx: {
      cfg: Record<string, unknown>;
      accountId: string;
      account: ResolvedRestAccount;
      runtime: unknown;
      abortSignal: AbortSignal;
      log?: { info?: (...a: unknown[]) => void; warn?: (...a: unknown[]) => void };
    }) => {
      const { cfg, accountId, log } = ctx;
      const account = resolveAccount(cfg, accountId);

      if (!account) {
        log?.info?.(`[rest-channel] Account "${accountId}" not found or disabled, skipping`);
        return waitUntilAbort(ctx.abortSignal);
      }

      if (!account.webhookUrl) {
        log?.warn?.(
          `[rest-channel] Account "${accountId}" has no webhookUrl configured – replies will be dropped`,
        );
      }

      log?.info?.(
        `[rest-channel] Starting REST channel (account: ${accountId}, path: ${account.inboundPath ?? DEFAULT_PATH})`,
      );

      // Create the inbound HTTP handler
      const inboundHandler = createInboundHandler({
        resolveAccount: (reqAccountId: string) => resolveAccount(cfg, reqAccountId),
        onMessage: async (resolvedAccount, message) => {
          const rt = getRestRuntime();
          const currentCfg = await rt.config.loadConfig();

          // Build media fields from inbound attachments (if any).
          //
          // The AI media-understanding pipeline (vision, transcription,
          // etc.) requires media files to be available as local paths.
          // We download each remote URL → save to OpenClaw's media dir
          // → pass the local paths as MediaPath / MediaPaths.
          //
          // This matches the pattern used by stock plugins (bluebubbles,
          // synology-chat, etc.) which always save to local files first.
          const mediaPaths: string[] = [];
          const mediaUrls: string[] = [];
          const mediaTypes: string[] = [];

          if (message.attachments && message.attachments.length > 0) {
            const maxBytes =
              resolvedAccount.mediaMaxMb && resolvedAccount.mediaMaxMb > 0
                ? resolvedAccount.mediaMaxMb * 1024 * 1024
                : 8 * 1024 * 1024; // default 8 MB

            // Build SSRF policy: if allowPrivateNetwork is on, allow all
            // private addresses. Otherwise, auto-allowlist each attachment's
            // hostname so that e.g. localhost URLs work when the user's app
            // serves files locally (matches bluebubbles pattern).
            const allowPrivate = resolvedAccount.allowPrivateNetwork === true;

            for (const attachment of message.attachments) {
              if (!attachment.url) continue;
              try {
                let ssrfPolicy: { allowPrivateNetwork?: boolean; allowedHostnames?: string[] } | undefined;
                if (allowPrivate) {
                  ssrfPolicy = { allowPrivateNetwork: true };
                } else {
                  try {
                    const hostname = new URL(attachment.url).hostname;
                    if (hostname) {
                      ssrfPolicy = { allowedHostnames: [hostname] };
                    }
                  } catch {
                    // invalid URL – let fetchRemoteMedia handle it
                  }
                }

                // Download the remote media
                const downloaded = await rt.channel.media.fetchRemoteMedia({
                  url: attachment.url,
                  maxBytes,
                  ssrfPolicy,
                });

                // Save to OpenClaw's managed media directory
                const saved = await rt.channel.media.saveMediaBuffer(
                  Buffer.from(downloaded.buffer),
                  downloaded.contentType ?? attachment.mimeType,
                  "inbound",
                  maxBytes,
                  attachment.filename,
                );

                mediaPaths.push(saved.path);
                mediaUrls.push(saved.path); // stock plugins set URL to local path too
                if (saved.contentType) {
                  mediaTypes.push(saved.contentType);
                }
              } catch (err) {
                log?.warn?.(
                  `[rest-channel] Attachment download failed url=${attachment.url} err=${String(err)}`,
                );
              }
            }
          }

          const mediaFields: Record<string, unknown> = {};
          if (mediaPaths.length > 0) {
            mediaFields.MediaPath = mediaPaths[0];
            mediaFields.MediaPaths = mediaPaths;
            mediaFields.MediaUrl = mediaUrls[0];
            mediaFields.MediaUrls = mediaUrls;
            if (mediaTypes.length > 0) {
              mediaFields.MediaType = mediaTypes[0];
              mediaFields.MediaTypes = mediaTypes;
            }
          }

          log?.info?.(
            `[rest-channel] Received message from "${message.senderId}" with ${mediaPaths.length} attachment(s)`,
          );

          // Resolve agent routing (generates proper sessionKey + agentId
          // so sessions appear in the OpenClaw web chat UI).
          const peerId = message.conversationId ?? message.senderId;
          const route = rt.channel.routing.resolveAgentRoute({
            cfg: currentCfg,
            channel: CHANNEL_ID,
            accountId: resolvedAccount.accountId,
            peer: {
              kind: message.isGroup ? "group" : "direct",
              id: peerId,
            },
          });

          // Build untrusted context from inbound metadata so the agent
          // can see user information (name, age, timezone, etc.).
          // Uses the SDK's UntrustedContext field — the same mechanism
          // Discord/Slack use for channel topics. The pipeline appends
          // it to the prompt with a security header telling the LLM
          // to treat it as metadata, not instructions.
          const untrustedContext: string[] = [];
          if (message.metadata && typeof message.metadata === "object") {
            const entries = Object.entries(message.metadata)
              .filter(([, v]) => v != null && v !== "")
              .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
            if (entries.length > 0) {
              untrustedContext.push(
                `REST channel user metadata:\n${entries.join("\n")}`,
              );
            }
          }

          // Build MsgContext using SDK's finalizeInboundContext
          const msgCtx = rt.channel.reply.finalizeInboundContext({
            Body: message.text ?? "",
            BodyForAgent: message.text ?? "",
            RawBody: message.text ?? "",
            CommandBody: message.text ?? "",
            From: `rest:${message.senderId}`,
            To: `rest:${peerId}`,
            SessionKey: route.sessionKey,
            AccountId: route.accountId,
            OriginatingChannel: CHANNEL_ID,
            OriginatingTo: `rest:${peerId}`,
            ChatType: message.isGroup ? "group" : "direct",
            SenderName: message.senderName ?? message.senderId,
            SenderId: message.senderId,
            Provider: CHANNEL_ID,
            Surface: CHANNEL_ID,
            ConversationLabel: message.senderName ?? message.senderId,
            Timestamp: Date.now(),
            CommandAuthorized: true,
            UntrustedContext: untrustedContext.length > 0 ? untrustedContext : undefined,
            ...mediaFields,
          });

          // Persist session so chat history is visible in the web UI
          const storePath = rt.channel.session.resolveStorePath(
            (currentCfg as Record<string, any>).session?.store,
            { agentId: route.agentId },
          );
          await rt.channel.session.recordInboundSession({
            storePath,
            sessionKey: msgCtx.SessionKey ?? route.sessionKey,
            ctx: msgCtx,
            onRecordError: (err) => {
              log?.warn?.(`[rest-channel] Failed updating session meta: ${String(err)}`);
            },
          });

          // Dispatch through OpenClaw's AI pipeline and deliver via webhook
          await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
            ctx: msgCtx,
            cfg: currentCfg,
            dispatcherOptions: {
              deliver: async (payload: {
                text?: string;
                body?: string;
                mediaUrl?: string;
                mediaUrls?: string[];
              }) => {
                const text = payload?.text ?? payload?.body ?? "";
                const mediaPaths = payload?.mediaUrls?.length
                  ? payload.mediaUrls
                  : payload?.mediaUrl
                    ? [payload.mediaUrl]
                    : [];

                // Resolve the OpenClaw state directory so relative media
                // paths (like ./media/inbound/...) resolve correctly even
                // when process.cwd() points elsewhere (e.g. C:\Windows\System32
                // on Windows services).
                const stateDir = rt.state.resolveStateDir();

                // Deliver if there is text or media (or both)
                if (text || mediaPaths.length > 0) {
                  await deliverOutbound({
                    account: resolvedAccount,
                    conversationId: message.conversationId ?? message.senderId,
                    recipientId: message.senderId,
                    text,
                    mediaPaths: mediaPaths.length > 0 ? mediaPaths : undefined,
                    stateDir,
                    logger: {
                      info: (...a: unknown[]) => log?.info?.(...a),
                      warn: (...a: unknown[]) => log?.warn?.(...a),
                    },
                  });
                }
              },
              onReplyStart: () => {
                log?.info?.(`[rest-channel] Agent reply started for "${message.senderId}"`);
              },
            },
          });
        },
        logger: {
          info: (...a: unknown[]) => log?.info?.(...a),
          warn: (...a: unknown[]) => log?.warn?.(...a),
        },
      });

      // Register the HTTP route for inbound messages
      const routePath = account.inboundPath ?? DEFAULT_PATH;
      const routeKey = `${accountId}:${routePath}`;

      // Deregister stale route from previous start (e.g. on auto-restart)
      const prevUnregister = activeRouteUnregisters.get(routeKey);
      if (prevUnregister) {
        log?.info?.(`[rest-channel] Deregistering stale route before re-registering: ${routePath}`);
        prevUnregister();
        activeRouteUnregisters.delete(routeKey);
      }

      const unregister = registerPluginHttpRoute({
        path: routePath,
        auth: "plugin",
        replaceExisting: true,
        pluginId: CHANNEL_ID,
        accountId: account.accountId,
        log: (msg: string) => log?.info?.(msg),
        handler: inboundHandler as unknown as (
          req: import("node:http").IncomingMessage,
          res: import("node:http").ServerResponse,
        ) => Promise<boolean>,
      });
      activeRouteUnregisters.set(routeKey, unregister);

      log?.info?.(`[rest-channel] Registered inbound route: ${routePath}`);

      // Keep alive until abort signal fires
      return waitUntilAbort(ctx.abortSignal, () => {
        log?.info?.(`[rest-channel] Stopping REST channel (account: ${accountId})`);
        if (typeof unregister === "function") unregister();
        activeRouteUnregisters.delete(routeKey);
      });
    },
  },
};

export { restChannelPlugin, resolveAccount, listAccountIds, CHANNEL_ID, DEFAULT_PATH };