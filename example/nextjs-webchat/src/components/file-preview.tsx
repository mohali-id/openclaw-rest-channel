// ---------------------------------------------------------------------------
// FilePreview — thumbnail chip for a staged file before sending
// ---------------------------------------------------------------------------

import type { Attachment } from "@/lib/types";

interface FilePreviewProps {
  attachment: Attachment;
  onRemove: () => void;
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function formatSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FilePreview({ attachment, onRemove }: FilePreviewProps) {
  return (
    <div className="file-preview">
      {isImage(attachment.mimeType) && attachment.previewUrl ? (
        <img
          className="file-preview-thumb"
          src={attachment.previewUrl}
          alt={attachment.filename}
        />
      ) : (
        <div className="file-preview-icon">&#128196;</div>
      )}

      <div>
        <div className="file-preview-name">{attachment.filename}</div>
        {attachment.size != null && (
          <div className="file-preview-size">{formatSize(attachment.size)}</div>
        )}
      </div>

      <button
        type="button"
        className="file-preview-remove"
        onClick={onRemove}
        aria-label={`Remove ${attachment.filename}`}
      >
        &times;
      </button>
    </div>
  );
}
