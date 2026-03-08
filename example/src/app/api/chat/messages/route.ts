// ---------------------------------------------------------------------------
// GET /api/chat/messages — Poll for messages in a conversation
// ---------------------------------------------------------------------------
// The frontend polls this endpoint to pick up new assistant replies that
// arrived via the webhook. Supports ?after=<ISO timestamp> filtering.

import { NextRequest, NextResponse } from "next/server";
import { getMessages, getMessagesSince } from "@/lib/store";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const conversationId = searchParams.get("conversationId");

  if (!conversationId) {
    return NextResponse.json(
      { error: "conversationId query parameter is required" },
      { status: 400 },
    );
  }

  const after = searchParams.get("after");

  const messages = after
    ? getMessagesSince(conversationId, after)
    : getMessages(conversationId);

  return NextResponse.json({ messages });
}
