// ---------------------------------------------------------------------------
// Root page — redirects to a new conversation URL
// ---------------------------------------------------------------------------
// Visiting / generates a fresh conversation ID and redirects to /<id>.
// Bookmark or share the URL to resume the same conversation.
// ---------------------------------------------------------------------------

import { redirect } from "next/navigation";
import { v4 as uuidv4 } from "uuid";

export default function RootPage() {
  redirect(`/${uuidv4()}`);
}
