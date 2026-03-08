// ---------------------------------------------------------------------------
// openclaw-rest-channel – Runtime singleton
// ---------------------------------------------------------------------------
//
// Captures the PluginRuntime reference during plugin registration so that
// other modules (inbound handler, channel adapter) can access the OpenClaw
// runtime helpers (channel.reply, channel.session, channel.routing, etc.).
// ---------------------------------------------------------------------------

import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setRestRuntime(r: PluginRuntime): void {
  runtime = r;
}

export function getRestRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("REST channel runtime not initialized – plugin not registered");
  }
  return runtime;
}
