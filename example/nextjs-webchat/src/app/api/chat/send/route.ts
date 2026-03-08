// ---------------------------------------------------------------------------
// POST /api/chat/send — Send a user message to OpenClaw via REST channel
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { addMessage } from "@/lib/store";
import type { ChatMessage } from "@/lib/types";

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL ?? "http://localhost:18789";
const API_KEY = process.env.OPENCLAW_API_KEY ?? "";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, attachments, conversationId, senderId, senderName } = body;

    if (!conversationId) {
      return NextResponse.json(
        { error: "conversationId is required" },
        { status: 400 },
      );
    }

    if (!text && (!attachments || attachments.length === 0)) {
      return NextResponse.json(
        { error: "text or attachments required" },
        { status: 400 },
      );
    }

    // Store user message locally
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: "user",
      text: text ?? "",
      attachments: attachments ?? [],
      timestamp: new Date().toISOString(),
      status: "sent",
    };
    addMessage(conversationId, userMessage);

    // Forward to OpenClaw Gateway inbound endpoint
    const inboundPayload = {
      senderId: senderId ?? "webchat-user",
      senderName: senderName ?? "Webchat User",
      text: text ?? undefined,
      conversationId,
      attachments: attachments?.map(
        (a: { url: string; mimeType: string; filename: string }) => ({
          url: a.url,
          mimeType: a.mimeType,
          filename: a.filename,
        }),
      ),
      metadata: {
        source: "nextjs-webchat-example",
      },
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (API_KEY) {
      headers["Authorization"] = `Bearer ${API_KEY}`;
    }

    const gatewayRes = await fetch(`${GATEWAY_URL}/rest/inbound`, {
      method: "POST",
      headers,
      body: JSON.stringify(inboundPayload),
    });

    if (!gatewayRes.ok) {
      const errBody = await gatewayRes.text().catch(() => "");
      console.error(
        `[send] Gateway error: ${gatewayRes.status} ${errBody}`,
      );
      return NextResponse.json(
        { error: "Failed to send to OpenClaw", detail: errBody },
        { status: 502 },
      );
    }

    const result = await gatewayRes.json();

    return NextResponse.json({
      ok: true,
      message: userMessage,
      gateway: result,
    });
  } catch (err) {
    console.error("[send] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
