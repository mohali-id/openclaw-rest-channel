// ---------------------------------------------------------------------------
// MessageBubble — renders a single chat message
// ---------------------------------------------------------------------------

import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "@/lib/types";

interface MessageBubbleProps {
  message: ChatMessage;
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={`message-row ${message.role}`}>
      <div
        className={`message-bubble ${isUser ? "user-bubble" : "assistant-bubble"}`}
      >
        {/* Text content */}
        {message.text &&
          (isUser ? (
            <span>{message.text}</span>
          ) : (
            <ReactMarkdown>{message.text}</ReactMarkdown>
          ))}

        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="message-attachments">
            {message.attachments.map((att) =>
              isImage(att.mimeType) ? (
                <a
                  key={att.id}
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    className="message-attachment-image"
                    src={att.previewUrl ?? att.url}
                    alt={att.filename}
                    loading="lazy"
                  />
                </a>
              ) : (
                <a
                  key={att.id}
                  className="message-attachment-file"
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="message-attachment-file-icon">
                    &#128196;
                  </span>
                  <span className="message-attachment-file-name">
                    {att.filename}
                  </span>
                </a>
              ),
            )}
          </div>
        )}
      </div>

      {/* Meta: timestamp & status */}
      <div className="message-meta">
        <span>{formatTime(message.timestamp)}</span>
        {isUser && message.status && (
          <span
            className={`message-status-dot ${message.status}`}
            title={message.status}
          />
        )}
      </div>
    </div>
  );
}
