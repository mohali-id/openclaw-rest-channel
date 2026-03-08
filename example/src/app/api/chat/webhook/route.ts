// ---------------------------------------------------------------------------
// POST /api/chat/webhook — Receive outbound messages from OpenClaw
// ---------------------------------------------------------------------------
// OpenClaw POSTs assistant replies here. We verify the HMAC signature and
// store the message so the frontend can pick it up via polling.

import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/verify";
import { addMessage } from "@/lib/store";
import type { WebhookPayload, ChatMessage } from "@/lib/types";

const WEBHOOK_SECRET = process.env.OPENCLAW_WEBHOOK_SECRET ?? "";

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-openclaw-signature");

    // Verify HMAC signature if a secret is configured
    if (WEBHOOK_SECRET) {
      if (!verifyWebhookSignature(rawBody, signature, WEBHOOK_SECRET)) {
        console.warn("[webhook] Invalid signature — rejecting payload");
        return NextResponse.json(
          { error: "Invalid signature" },
          { status: 401 },
        );
      }
    }

    const payload: WebhookPayload = JSON.parse(rawBody);

    if (!payload.conversationId || !payload.messageId) {
      return NextResponse.json(
        { error: "conversationId and messageId are required" },
        { status: 400 },
      );
    }

    // Build a ChatMessage from the webhook payload
    const assistantMessage: ChatMessage = {
      id: payload.messageId,
      role: "assistant",
      text: payload.text ?? "",
      attachments: payload.attachments?.map((a, i) => ({
        id: `att-${payload.messageId}-${i}`,
        url: a.url,
        mimeType: a.mimeType ?? "application/octet-stream",
        filename: a.filename ?? `attachment-${i}`,
      })),
      timestamp: payload.timestamp ?? new Date().toISOString(),
      status: "sent",
    };

    addMessage(payload.conversationId, assistantMessage);

    console.log(
      `[webhook] Stored assistant message ${assistantMessage.id} for conversation ${payload.conversationId}`,
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[webhook] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
