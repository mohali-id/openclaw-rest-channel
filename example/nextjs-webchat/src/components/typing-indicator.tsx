// ---------------------------------------------------------------------------
// TypingIndicator — animated dots shown while waiting for the assistant
// ---------------------------------------------------------------------------

export default function TypingIndicator() {
  return (
    <div className="typing-indicator" aria-label="Assistant is typing">
      <div className="typing-dot" />
      <div className="typing-dot" />
      <div className="typing-dot" />
    </div>
  );
}
