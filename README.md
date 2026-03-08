# openclaw-rest-channel

A minimal REST-based channel plugin for [OpenClaw](https://openclaw.ai). Integrate any external web application (webchat, mobile app, internal tool, etc.) with OpenClaw using simple HTTP requests.

```
┌──────────────────────┐         POST /rest/inbound          ┌────────────────────────┐
│                      │  ──────────────────────────────────► │                        │
│   Your Application   │                                      │   OpenClaw Gateway     │
│  (webchat, app, etc) │  ◄──────────────────────────────────  │   + REST Channel       │
│                      │   POST to your webhookUrl            │                        │
└──────────────────────┘   (assistant replies)                └────────────────────────┘
```

## Features

- **Inbound HTTP endpoint** — Your app POSTs JSON messages to the OpenClaw Gateway
- **Outbound webhook delivery** — Assistant replies are POSTed to your configured `webhookUrl`
- **API key authentication** — Secure the inbound endpoint with bearer token auth
- **HMAC-SHA256 signing** — Verify outbound webhooks with a shared secret
- **Multi-account support** — Run multiple REST integrations side by side
- **Group chat support** — Route messages into group sessions via `conversationId`
- **Zero dependencies** — Uses only Node.js built-ins (no external packages)

## Installation

```bash
# From npm
openclaw plugins install openclaw-rest-channel

# Or from a local directory (for development)
openclaw plugins install -l ./path/to/openclaw-rest-channel
```

Then restart the Gateway.

## Configuration

Add the channel config to your `~/.openclaw/openclaw.json`:

```jsonc
{
  "channels": {
    "rest": {
      "accounts": {
        "default": {
          // Where OpenClaw sends assistant replies
          "webhookUrl": "https://your-app.example.com/openclaw/webhook",

          // Shared secret for HMAC-SHA256 webhook signature verification
          "webhookSecret": "your-shared-secret",

          // API key that inbound requests must provide
          "apiKey": "your-inbound-api-key",

          // Custom inbound path (optional, defaults to /rest/inbound)
          "inboundPath": "/rest/inbound"
        }
      }
    }
  }
}
```

### Multi-account setup

```jsonc
{
  "channels": {
    "rest": {
      "accounts": {
        "webchat": {
          "webhookUrl": "https://webchat.example.com/webhook",
          "apiKey": "key-for-webchat"
        },
        "mobile": {
          "webhookUrl": "https://mobile-api.example.com/webhook",
          "apiKey": "key-for-mobile",
          "inboundPath": "/rest/mobile/inbound"
        }
      }
    }
  }
}
```

### Configuration reference

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Enable/disable this account |
| `webhookUrl` | `string` | — | URL where assistant replies are POSTed |
| `webhookSecret` | `string` | — | HMAC-SHA256 secret for signing outbound payloads |
| `apiKey` | `string` | — | Bearer token for authenticating inbound requests |
| `inboundPath` | `string` | `/rest/inbound` | Gateway HTTP path for receiving messages |

## Usage

### Sending messages to OpenClaw (inbound)

POST JSON to the Gateway's inbound endpoint:

```bash
curl -X POST http://localhost:18789/rest/inbound \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-inbound-api-key" \
  -d '{
    "senderId": "user-42",
    "senderName": "Alice",
    "text": "Hello, assistant!",
    "conversationId": "conv-123"
  }'
```

#### Inbound payload reference

```typescript
{
  // Required: unique identifier for the sender
  senderId: string;

  // Optional: display name
  senderName?: string;

  // Message text (required if no attachments)
  text?: string;

  // Conversation/thread ID (defaults to senderId for 1:1 chats)
  conversationId?: string;

  // Set to true for group/multi-user conversations
  isGroup?: boolean;

  // Media attachments
  attachments?: Array<{
    url: string;
    mimeType?: string;
    filename?: string;
  }>;

  // Target account (defaults to "default")
  accountId?: string;

  // Arbitrary metadata passed to the session
  metadata?: Record<string, unknown>;
}
```

#### Inbound response

```json
{
  "ok": true,
  "conversationId": "conv-123",
  "accountId": "default"
}
```

#### Error responses

| Status | Meaning |
|---|---|
| `400` | Invalid JSON or missing required fields |
| `401` | Invalid or missing API key |
| `404` | Account not found or disabled |
| `405` | Method not allowed (use POST) |
| `500` | Internal processing error |

### Receiving replies from OpenClaw (outbound webhook)

OpenClaw POSTs JSON to your `webhookUrl` when the assistant replies:

```typescript
{
  // Always "rest"
  channel: "rest";

  // Which account handled this conversation
  accountId: string;

  // Conversation ID (matches your inbound conversationId)
  conversationId: string;

  // The original sender ID (for routing on your side)
  recipientId: string;

  // The assistant's reply text
  text: string;

  // Optional media attachments
  attachments?: Array<{
    url: string;
    mimeType?: string;
    filename?: string;
  }>;

  // ISO-8601 timestamp
  timestamp: string;

  // Unique message ID for deduplication
  messageId: string;
}
```

### Verifying webhook signatures

When `webhookSecret` is configured, every outbound request includes an `X-OpenClaw-Signature` header:

```
X-OpenClaw-Signature: sha256=<hex-encoded HMAC-SHA256>
```

Verify it in your app:

```javascript
import crypto from "node:crypto";

function verifySignature(body, signature, secret) {
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(body, "utf8")
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );
}

// In your webhook handler:
app.post("/openclaw/webhook", (req, res) => {
  const sig = req.headers["x-openclaw-signature"];
  if (!verifySignature(req.rawBody, sig, "your-shared-secret")) {
    return res.status(401).send("Invalid signature");
  }
  // Process the message...
});
```

## RPC status method

Query the plugin status via the Gateway WebSocket:

```
Method: rest-channel.status
```

Returns:

```json
{
  "channel": "rest",
  "accounts": [
    {
      "accountId": "default",
      "enabled": true,
      "hasWebhookUrl": true,
      "hasApiKey": true,
      "inboundPath": "/rest/inbound"
    }
  ],
  "registeredPaths": ["/rest/inbound"]
}
```

## Examples

### Minimal webchat integration

```javascript
// Browser-side: send a message
async function sendMessage(text) {
  const res = await fetch("http://localhost:18789/rest/inbound", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer your-api-key",
    },
    body: JSON.stringify({
      senderId: "webchat-user-1",
      text,
    }),
  });
  return res.json();
}

// Server-side: receive assistant replies
app.post("/openclaw/webhook", (req, res) => {
  const { text, recipientId, conversationId } = req.body;
  // Push to the user via WebSocket, SSE, etc.
  broadcastToUser(recipientId, { text, conversationId });
  res.json({ ok: true });
});
```

### Python integration

```python
import requests

# Send a message to OpenClaw
response = requests.post(
    "http://localhost:18789/rest/inbound",
    headers={
        "Authorization": "Bearer your-api-key",
        "Content-Type": "application/json",
    },
    json={
        "senderId": "python-script",
        "text": "Summarize today's news",
        "conversationId": "daily-summary",
    },
)
print(response.json())
```

## Development

```bash
git clone <repo>
cd openclaw-rest-channel
npm install
npm run build          # Compile TypeScript
npm run dev            # Watch mode

# Install locally for testing
openclaw plugins install -l .
```

## How it works

1. **Plugin loads** — OpenClaw discovers `openclaw.plugin.json`, loads `dist/index.js`, and calls the `register(api)` export
2. **Channel registered** — The REST channel plugin is registered with the Gateway's channel system
3. **HTTP routes mounted** — Inbound endpoint(s) are registered on the Gateway HTTP server
4. **Inbound flow** — External app POSTs to `/rest/inbound` → plugin validates auth → routes message into OpenClaw's session pipeline
5. **Outbound flow** — Assistant generates a reply → OpenClaw calls `sendText` → plugin POSTs to your `webhookUrl`

## License

MIT
