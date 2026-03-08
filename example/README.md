# OpenClaw REST Channel — Next.js Webchat Example

A polished webchat interface that demonstrates how to integrate with OpenClaw using the **openclaw-rest-channel** plugin. Users can send text messages and file attachments, and receive AI assistant replies in real time.

![Next.js](https://img.shields.io/badge/Next.js-15-black)
![React](https://img.shields.io/badge/React-19-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

## Architecture

```
Browser (React)
  │
  ├─ POST /api/chat/send     → forwards to OpenClaw Gateway /rest/inbound
  ├─ POST /api/chat/upload    → saves files, returns public URL
  └─ GET  /api/chat/messages  → polls for new messages (assistant replies)

OpenClaw Gateway
  │
  └─ POST /api/chat/webhook   ← OpenClaw sends assistant replies here
```

The frontend polls `/api/chat/messages` every 1.5 seconds to pick up new assistant replies that arrive via the webhook.

## Prerequisites

- **Node.js** 18+ and npm
- **OpenClaw** installed and running with the `openclaw-rest-channel` plugin
- (Optional) **ngrok** or similar tunnel for development webhooks

## Setup

### 1. Install dependencies

```bash
cd example/nextjs-webchat
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
# The URL where your OpenClaw Gateway is running
OPENCLAW_GATEWAY_URL=http://localhost:18789

# The API key configured in your REST channel account
OPENCLAW_API_KEY=your-inbound-api-key

# The shared secret for verifying webhook signatures
OPENCLAW_WEBHOOK_SECRET=your-shared-secret

# This app's public URL (OpenClaw needs to reach this for webhooks)
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Configure OpenClaw

In your `~/.openclaw/openclaw.json`, add the REST channel config:

```jsonc
{
  "channels": {
    "rest": {
      "accounts": {
        "webchat": {
          "enabled": true,
          "apiKey": "your-inbound-api-key",
          "webhookUrl": "http://localhost:3000/api/chat/webhook",
          "webhookSecret": "your-shared-secret",
          "inboundPath": "/rest/inbound"
        }
      }
    }
  }
}
```

> **Note:** The `apiKey` here must match `OPENCLAW_API_KEY` in your `.env.local`, and `webhookSecret` must match `OPENCLAW_WEBHOOK_SECRET`.

### 4. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 5. (Optional) Expose via ngrok

If OpenClaw is running on a different machine or in Docker:

```bash
ngrok http 3000
```

Then update `webhookUrl` in your OpenClaw config to the ngrok HTTPS URL:
```
https://abc123.ngrok.io/api/chat/webhook
```

And set `NEXT_PUBLIC_APP_URL` to the same ngrok URL so uploaded file URLs are reachable.

## Features

- **Real-time chat** — Send messages and receive assistant replies via polling
- **File attachments** — Upload images and files with preview thumbnails
- **Markdown rendering** — Assistant replies are rendered as rich markdown (code blocks, lists, links, etc.)
- **Typing indicator** — Animated dots while waiting for the assistant
- **New conversation** — Start fresh with the "New Chat" button
- **Webhook signature verification** — HMAC-SHA256 verification of incoming webhooks
- **Responsive design** — Works on desktop and mobile

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/chat/send` | POST | Send a user message to OpenClaw |
| `/api/chat/webhook` | POST | Receive assistant replies from OpenClaw |
| `/api/chat/messages` | GET | Poll for messages (supports `?after=` filtering) |
| `/api/chat/upload` | POST | Upload file attachments (multipart form data) |

## Project Structure

```
src/
├── app/
│   ├── api/chat/
│   │   ├── send/route.ts        # Forward messages to OpenClaw
│   │   ├── webhook/route.ts     # Receive assistant replies
│   │   ├── messages/route.ts    # Polling endpoint
│   │   └── upload/route.ts      # File upload handler
│   ├── layout.tsx               # Root layout
│   ├── page.tsx                 # Main chat page
│   └── globals.css              # All styles
├── components/
│   ├── chat-window.tsx          # Scrollable message list
│   ├── message-bubble.tsx       # Individual message rendering
│   ├── input-bar.tsx            # Text input + file attach + send
│   ├── file-preview.tsx         # Attachment thumbnail chips
│   └── typing-indicator.tsx     # Animated dots
└── lib/
    ├── types.ts                 # Shared TypeScript interfaces
    ├── store.ts                 # In-memory message store
    └── verify.ts                # Webhook signature verification
```

## Production Notes

This example is intended for **development and demonstration purposes**. For production use:

- Replace the in-memory message store with a database (Redis, PostgreSQL, etc.)
- Replace polling with WebSockets or Server-Sent Events for real-time updates
- Add authentication and rate limiting
- Use a proper file storage service (S3, Cloudflare R2, etc.) instead of local uploads
- Add error boundaries and retry logic

## License

MIT — see the [root LICENSE](../../LICENSE) file.
