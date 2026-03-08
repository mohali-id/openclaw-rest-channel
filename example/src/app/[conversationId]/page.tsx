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
import UserInfoForm from "@/components/user-info-form";
import type { Attachment, ChatMessage, UserInfo } from "@/lib/types";

const POLL_INTERVAL = 1500; // ms

export default function ChatPage() {
  const params = useParams<{ conversationId: string }>();
  const router = useRouter();
  const conversationId = params.conversationId;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isWaiting, setIsWaiting] = useState(false);
  const [showUserForm, setShowUserForm] = useState(false);
  const lastPollTimestamp = useRef<string>("");

  // ------ Check for user info on mount ------------------------------------

  useEffect(() => {
    if (typeof window === "undefined") return;
    
    const stored = localStorage.getItem("userInfo");
    if (!stored) {
      setShowUserForm(true);
    }
  }, []);

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

      // Get user info from localStorage
      const storedUserInfo = localStorage.getItem("userInfo");
      const userInfo = storedUserInfo ? JSON.parse(storedUserInfo) : undefined;

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
            userInfo,
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
    // Convert file to data URL
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    return {
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url: dataUrl,
      mimeType: file.type,
      filename: file.name,
      previewUrl: file.type.startsWith("image/") ? dataUrl : undefined,
      size: file.size,
    };
  }, []);

  // ------ Start new conversation -------------------------------------------

  const handleNewChat = useCallback(() => {
    router.push(`/${uuidv4()}`);
  }, [router]);

  // ------ Handle user info submission --------------------------------------

  const handleUserInfoSubmit = useCallback((userInfo: UserInfo) => {
    localStorage.setItem("userInfo", JSON.stringify(userInfo));
    setShowUserForm(false);
  }, []);

  // ------ Reset user info --------------------------------------------------

  const handleResetUserInfo = useCallback(() => {
    localStorage.removeItem("userInfo");
    setShowUserForm(true);
  }, []);

  // ------ Render -----------------------------------------------------------

  // Show form if user info is missing
  if (showUserForm) {
    return <UserInfoForm onSubmit={handleUserInfoSubmit} />;
  }

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
          onClick={handleResetUserInfo}
          title="Reset profile information"
          style={{
            marginLeft: "auto",
            background: "rgba(255,255,255,0.15)",
            border: "none",
            color: "#fff",
            padding: "6px 14px",
            borderRadius: "9999px",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          Reset Profile
        </button>
        <button
          type="button"
          onClick={handleNewChat}
          title="Start new conversation"
          style={{
            marginLeft: "8px",
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
