// ---------------------------------------------------------------------------
// Chat page — orchestrates state, polling, sending & uploading
// ---------------------------------------------------------------------------
// The conversation ID comes from the URL: /<conversationId>
// Share a link to resume the same conversation.
// ---------------------------------------------------------------------------

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import ChatWindow from "@/components/chat-window";
import InputBar from "@/components/input-bar";
import type { Attachment, ChatMessage } from "@/lib/types";

const POLL_INTERVAL = 1500; // ms

export default function ChatPage() {
  const params = useParams<{ conversationId: string }>();
  const router = useRouter();
  const conversationId = params.conversationId;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isWaiting, setIsWaiting] = useState(false);
  const lastPollTimestamp = useRef<string>("");

  // ------ Polling for new messages ----------------------------------------

  useEffect(() => {
    if (!conversationId) return;

    const poll = async () => {
      try {
        const qs = new URLSearchParams({ conversationId });
        if (lastPollTimestamp.current) {
          qs.set("after", lastPollTimestamp.current);
        }

        const res = await fetch(`/api/chat/messages?${qs}`);
        if (!res.ok) return;

        const data = await res.json();
        const incoming: ChatMessage[] = data.messages ?? [];

        if (incoming.length > 0) {
          setMessages((prev) => {
            // Merge new messages, dedup by id
            const existingIds = new Set(prev.map((m) => m.id));
            const novel = incoming.filter((m) => !existingIds.has(m.id));
            return novel.length > 0 ? [...prev, ...novel] : prev;
          });

          // If we received an assistant message, stop waiting
          if (incoming.some((m) => m.role === "assistant")) {
            setIsWaiting(false);
          }

          // Move the poll cursor forward
          const latest = incoming[incoming.length - 1];
          if (latest.timestamp > lastPollTimestamp.current) {
            lastPollTimestamp.current = latest.timestamp;
          }
        }
      } catch (err) {
        console.warn("[poll] Error:", err);
      }
    };

    // Reset state when conversation changes (navigating to a different URL)
    setMessages([]);
    setIsWaiting(false);
    lastPollTimestamp.current = "";

    const interval = setInterval(poll, POLL_INTERVAL);
    poll();

    return () => clearInterval(interval);
  }, [conversationId]);

  // ------ Send a message ---------------------------------------------------

  const handleSend = useCallback(
    async (text: string, attachments: Attachment[]) => {
      if (!conversationId) return;

      // Optimistic local message
      const userMessage: ChatMessage = {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: "user",
        text,
        attachments: attachments.length > 0 ? attachments : undefined,
        timestamp: new Date().toISOString(),
        status: "sending",
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsWaiting(true);

      try {
        const res = await fetch("/api/chat/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: userMessage.id,
            text: text || undefined,
            attachments: attachments.map((a) => ({
              url: a.url,
              mimeType: a.mimeType,
              filename: a.filename,
            })),
            conversationId,
          }),
        });

        if (res.ok) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === userMessage.id ? { ...m, status: "sent" } : m,
            ),
          );
        } else {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === userMessage.id ? { ...m, status: "error" } : m,
            ),
          );
          setIsWaiting(false);
        }
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === userMessage.id ? { ...m, status: "error" } : m,
          ),
        );
        setIsWaiting(false);
      }
    },
    [conversationId],
  );

  // ------ Upload a file ----------------------------------------------------

  const handleUpload = useCallback(async (file: File): Promise<Attachment> => {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/chat/upload", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? "Upload failed");
    }

    const data = await res.json();

    let previewUrl: string | undefined;
    if (file.type.startsWith("image/")) {
      previewUrl = URL.createObjectURL(file);
    }

    return {
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url: data.url,
      mimeType: data.mimeType,
      filename: data.filename,
      previewUrl,
      size: data.size,
    };
  }, []);

  // ------ Start new conversation -------------------------------------------

  const handleNewChat = useCallback(() => {
    router.push(`/${uuidv4()}`);
  }, [router]);

  // ------ Render -----------------------------------------------------------

  return (
    <div className="app-container">
      {/* Header */}
      <header className="chat-header">
        <div className="chat-header-logo">OC</div>
        <div className="chat-header-info">
          <h1>OpenClaw Assistant</h1>
          <p>REST Channel &middot; Webchat Example</p>
        </div>
        <button
          type="button"
          onClick={handleNewChat}
          title="Start new conversation"
          style={{
            marginLeft: "auto",
            background: "rgba(255,255,255,0.2)",
            border: "none",
            color: "#fff",
            padding: "6px 14px",
            borderRadius: "9999px",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          New Chat
        </button>
      </header>

      {/* Messages */}
      <ChatWindow messages={messages} isWaiting={isWaiting} />

      {/* Input */}
      <InputBar onSend={handleSend} onUpload={handleUpload} />
    </div>
  );
}
