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

    sendText: async (params: {
      text: string;
      account: ResolvedRestAccount;
      conversationId?: string;
      recipientId?: string;
      logger?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
    }) => {
      const logger = params.logger ?? {
        info: console.log,
        warn: console.warn,
      };
      return deliverOutbound({
        account: params.account,
        conversationId: params.conversationId ?? "unknown",
        recipientId: params.recipientId ?? "unknown",
        text: params.text,
        logger,
      });
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
            `[rest-channel] Received message from "${message.senderId}" with ${Object.keys(mediaFields).length} attachment(s)`,
          );

          // Build MsgContext using SDK's finalizeInboundContext
          const msgCtx = rt.channel.reply.finalizeInboundContext({
            Body: message.text ?? "",
            RawBody: message.text ?? "",
            CommandBody: message.text ?? "",
            From: `rest:${message.senderId}`,
            To: `rest:${message.senderId}`,
            SessionKey: `rest:${resolvedAccount.accountId}:${message.conversationId ?? message.senderId}`,
            AccountId: resolvedAccount.accountId,
            OriginatingChannel: CHANNEL_ID,
            OriginatingTo: `rest:${message.senderId}`,
            ChatType: message.isGroup ? "group" : "direct",
            SenderName: message.senderName ?? message.senderId,
            SenderId: message.senderId,
            Provider: CHANNEL_ID,
            Surface: CHANNEL_ID,
            ConversationLabel: message.senderName ?? message.senderId,
            Timestamp: Date.now(),
            CommandAuthorized: true,
            ...mediaFields,
          });

          // Dispatch through OpenClaw's AI pipeline and deliver via webhook
          await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
            ctx: msgCtx,
            cfg: currentCfg,
            dispatcherOptions: {
              deliver: async (payload: { text?: string; body?: string }) => {
                const text = payload?.text ?? payload?.body;
                if (text) {
                  await deliverOutbound({
                    account: resolvedAccount,
                    conversationId: message.conversationId ?? message.senderId,
                    recipientId: message.senderId,
                    text,
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

// ---------------------------------------------------------------------------
// Plugin registration (object shape with id + register)
// ---------------------------------------------------------------------------

const plugin = {
  id: "openclaw-rest-channel",
  name: "REST Channel",
  description:
    "A minimal REST-based channel plugin for OpenClaw. Connect any external web application via simple HTTP requests.",

  register(api: OpenClawPluginApi) {
    // Store the runtime reference for later use by the channel adapter
    setRestRuntime(api.runtime);

    // Register the REST channel
    api.registerChannel({ plugin: restChannelPlugin as any });

    // Register a status RPC method
    api.registerGatewayMethod("rest-channel.status", ({ respond }) => {
      const accounts = listAccountIds(api.config).map((id) => {
        const acct = resolveAccount(api.config, id);
        return {
          accountId: id,
          enabled: !!acct,
          hasWebhookUrl: !!acct?.webhookUrl,
          hasApiKey: !!acct?.apiKey,
          inboundPath: acct?.inboundPath ?? DEFAULT_PATH,
        };
      });

      respond(true, {
        channel: CHANNEL_ID,
        accounts,
      });
    });

    api.logger.info(
      `[rest-channel] Plugin loaded – ${listAccountIds(api.config).length} account(s) configured`,
    );
  },
};

export default plugin;
