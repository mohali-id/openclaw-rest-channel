import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { setRestRuntime } from "./src/runtime.js";
import { restChannelPlugin, listAccountIds, resolveAccount, CHANNEL_ID, DEFAULT_PATH  } from "./src/channel.js";

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