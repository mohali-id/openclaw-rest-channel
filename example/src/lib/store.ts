// ---------------------------------------------------------------------------
// In-memory message store (development only)
// ---------------------------------------------------------------------------
// In production, replace with a proper database (Redis, Postgres, etc.)
// This stores messages per conversationId so the client can poll for updates.

import type { ChatMessage, UserInfo } from "./types";

const conversations = new Map<string, ChatMessage[]>();

export function getMessages(conversationId: string): ChatMessage[] {
  return conversations.get(conversationId) ?? [];
}

export function addMessage(conversationId: string, message: ChatMessage): void {
  if (!conversations.has(conversationId)) {
    conversations.set(conversationId, []);
  }
  const msgs = conversations.get(conversationId)!;
  // Deduplicate by message id
  if (!msgs.some((m) => m.id === message.id)) {
    msgs.push(message);
  }
}

export function getMessagesSince(
  conversationId: string,
  afterTimestamp: string,
): ChatMessage[] {
  const msgs = conversations.get(conversationId) ?? [];
  return msgs.filter((m) => m.timestamp > afterTimestamp);
}

// ------ User info storage ------------------------------------------------

const userInfoStore = new Map<string, UserInfo>();

export function saveUserInfo(conversationId: string, userInfo: UserInfo): void {
  userInfoStore.set(conversationId, userInfo);
}

export function getUserInfo(conversationId: string): UserInfo | null {
  return userInfoStore.get(conversationId) ?? null;
}
