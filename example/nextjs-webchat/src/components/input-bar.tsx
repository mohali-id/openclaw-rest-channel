// ---------------------------------------------------------------------------
// InputBar — text input + file attach + send button
// ---------------------------------------------------------------------------

"use client";

import { useState, useRef, useCallback, type KeyboardEvent, type ChangeEvent } from "react";
import FilePreview from "./file-preview";
import type { Attachment } from "@/lib/types";

interface InputBarProps {
  onSend: (text: string, attachments: Attachment[]) => void;
  onUpload: (file: File) => Promise<Attachment>;
  disabled?: boolean;
}

export default function InputBar({ onSend, onUpload, disabled }: InputBarProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSend = !disabled && !uploading && (text.trim() || attachments.length > 0);

  // Auto-grow textarea
  const handleInput = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, []);

  const handleSend = useCallback(() => {
    if (!canSend) return;
    onSend(text.trim(), attachments);
    setText("");
    setAttachments([]);
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [canSend, text, attachments, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleFileSelect = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      setUploading(true);
      try {
        const newAttachments: Attachment[] = [];
        for (const file of Array.from(files)) {
          const attachment = await onUpload(file);
          newAttachments.push(attachment);
        }
        setAttachments((prev) => [...prev, ...newAttachments]);
      } catch (err) {
        console.error("Upload failed:", err);
      } finally {
        setUploading(false);
        // Reset file input so the same file can be selected again
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [onUpload],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const removed = prev.find((a) => a.id === id);
      // Revoke blob URL to free memory
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  return (
    <div className="input-bar">
      {/* File previews */}
      {attachments.length > 0 && (
        <div className="input-bar-previews">
          {attachments.map((att) => (
            <FilePreview
              key={att.id}
              attachment={att}
              onRemove={() => removeAttachment(att.id)}
            />
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="input-bar-row">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={handleFileSelect}
        />

        {/* Attach button */}
        <button
          type="button"
          className="input-btn attach-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploading}
          title="Attach files"
          aria-label="Attach files"
        >
          &#128206;
        </button>

        {/* Text input */}
        <textarea
          ref={textareaRef}
          rows={1}
          placeholder={uploading ? "Uploading..." : "Type a message..."}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={disabled || uploading}
        />

        {/* Send button */}
        <button
          type="button"
          className="input-btn send-btn"
          onClick={handleSend}
          disabled={!canSend}
          title="Send message"
          aria-label="Send message"
        >
          &#9654;
        </button>
      </div>
    </div>
  );
}
