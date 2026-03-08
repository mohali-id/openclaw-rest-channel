// ---------------------------------------------------------------------------
// openclaw-rest-channel – Plugin entry point
// ---------------------------------------------------------------------------
//
// A minimal REST-based channel plugin for OpenClaw.
//
// Inbound:  External apps POST JSON to the Gateway HTTP endpoint.
// Outbound: OpenClaw POSTs assistant replies to your configured webhookUrl.
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

import type {
  RestChannelConfig,
  ResolvedRestAccount,
  RestAccountConfig,
  InboundMessagePayload,
} from "./types.js";
import { createInboundHandler } from "./inbound.js";
import { deliverOutbound } from "./outbound.js";

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
// Channel plugin definition
// ---------------------------------------------------------------------------

const restChannelPlugin = {
  id: "rest",

  meta: {
    id: "rest",
    label: "REST",
    selectionLabel: "REST (HTTP API)",
    docsPath: "/channels/rest",
    blurb: "Connect any external app to OpenClaw via simple HTTP requests.",
    aliases: ["rest-api", "http"] as string[],
  },

  capabilities: {
    chatTypes: ["direct", "group"] as string[],
  },

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
};

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

/**
 * OpenClaw plugin entry point.
 *
 * This function is called by the OpenClaw Gateway when the plugin is loaded.
 * It registers:
 *   1. The REST messaging channel (inbound + outbound)
 *   2. An HTTP route on the Gateway for receiving inbound messages
 *   3. A gateway RPC method for health/status checks
 */
export default function register(api: {
  registerChannel: (opts: { plugin: typeof restChannelPlugin }) => void;
  registerHttpRoute: (opts: {
    path: string;
    auth: string;
    match?: string;
    handler: (req: unknown, res: unknown) => Promise<boolean>;
  }) => void;
  registerGatewayMethod: (
    name: string,
    handler: (ctx: { respond: (ok: boolean, data: unknown) => void }) => void,
  ) => void;
  config: Record<string, unknown>;
  logger: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
  runtime?: {
    inbound?: {
      handleMessage?: (opts: {
        channel: string;
        accountId: string;
        senderId: string;
        senderName?: string;
        text?: string;
        conversationId: string;
        isGroup?: boolean;
        metadata?: Record<string, unknown>;
      }) => void;
    };
  };
}) {
  const logger = api.logger;

  // -----------------------------------------------------------------------
  // 1. Register the channel
  // -----------------------------------------------------------------------
  api.registerChannel({ plugin: restChannelPlugin });

  // -----------------------------------------------------------------------
  // 2. Register inbound HTTP routes
  // -----------------------------------------------------------------------

  // Collect all unique inbound paths across accounts
  const accountIds = listAccountIds(api.config);
  const pathsRegistered = new Set<string>();

  // Always register the default path
  const defaultPath = "/rest/inbound";
  pathsRegistered.add(defaultPath);

  for (const id of accountIds) {
    const account = resolveAccount(api.config, id);
    if (account?.inboundPath && account.inboundPath !== defaultPath) {
      pathsRegistered.add(account.inboundPath);
    }
  }

  const inboundHandler = createInboundHandler({
    resolveAccount: (accountId: string) => resolveAccount(api.config, accountId),
    onMessage: (account, message) => {
      // Route the inbound message into the OpenClaw messaging pipeline
      if (api.runtime?.inbound?.handleMessage) {
        api.runtime.inbound.handleMessage({
          channel: "rest",
          accountId: account.accountId,
          senderId: message.senderId,
          senderName: message.senderName,
          text: message.text,
          conversationId: message.conversationId ?? message.senderId,
          isGroup: message.isGroup,
          metadata: message.metadata,
        });
      } else {
        logger.info(
          `[rest-channel] Inbound message received (runtime.inbound not available):`,
          JSON.stringify(message),
        );
      }
    },
    logger,
  });

  for (const path of pathsRegistered) {
    api.registerHttpRoute({
      path,
      auth: "plugin", // Plugin manages its own auth via apiKey
      handler: inboundHandler as unknown as (req: unknown, res: unknown) => Promise<boolean>,
    });

    logger.info(`[rest-channel] Registered inbound route: ${path}`);
  }

  // -----------------------------------------------------------------------
  // 3. Register a status RPC method
  // -----------------------------------------------------------------------
  api.registerGatewayMethod("rest-channel.status", ({ respond }) => {
    const accounts = listAccountIds(api.config).map((id) => {
      const acct = resolveAccount(api.config, id);
      return {
        accountId: id,
        enabled: !!acct,
        hasWebhookUrl: !!acct?.webhookUrl,
        hasApiKey: !!acct?.apiKey,
        inboundPath: acct?.inboundPath ?? defaultPath,
      };
    });

    respond(true, {
      channel: "rest",
      accounts,
      registeredPaths: [...pathsRegistered],
    });
  });

  logger.info(
    `[rest-channel] Plugin loaded – ${accountIds.length} account(s) configured`,
  );
}
