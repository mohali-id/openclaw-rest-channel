// ---------------------------------------------------------------------------
// ChatWindow — scrollable message list with auto-scroll
// ---------------------------------------------------------------------------

"use client";

import { useEffect, useRef } from "react";
import MessageBubble from "./message-bubble";
import TypingIndicator from "./typing-indicator";
import type { ChatMessage } from "@/lib/types";

interface ChatWindowProps {
  messages: ChatMessage[];
  isWaiting: boolean;
}

export default function ChatWindow({ messages, isWaiting }: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change or waiting state changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isWaiting]);

  if (messages.length === 0 && !isWaiting) {
    return (
      <div className="chat-window">
        <div className="chat-empty">
          <div className="chat-empty-icon">&#128172;</div>
          <p>
            Send a message to start chatting with the OpenClaw assistant.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-window">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      {isWaiting && <TypingIndicator />}
      <div ref={bottomRef} />
    </div>
  );
}
