// ---------------------------------------------------------------------------
// Root page — collects user info before starting a conversation
// ---------------------------------------------------------------------------
// Visiting / shows a form to collect user information (name, gender, age).
// After submission, generates a fresh conversation ID and redirects to /<id>.
// Bookmark or share the URL to resume the same conversation.
// ---------------------------------------------------------------------------

"use client";

import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { useEffect, useState } from "react";
import UserInfoForm from "@/components/user-info-form";
import type { UserInfo } from "@/lib/types";

export default function RootPage() {
  const router = useRouter();
  const [hasUserInfo, setHasUserInfo] = useState(false);

  useEffect(() => {
    // Check if user info already exists in localStorage
    const stored = localStorage.getItem("userInfo");
    if (stored) {
      setHasUserInfo(true);
      // Redirect to new conversation
      router.push(`/${uuidv4()}`);
    }
  }, [router]);

  const handleUserInfoSubmit = (userInfo: UserInfo) => {
    // Store user info in localStorage
    localStorage.setItem("userInfo", JSON.stringify(userInfo));
    
    // Redirect to new conversation
    const conversationId = uuidv4();
    router.push(`/${conversationId}`);
  };

  // If we already have user info, show loading state
  if (hasUserInfo) {
    return null;
  }

  return <UserInfoForm onSubmit={handleUserInfoSubmit} />;
}
