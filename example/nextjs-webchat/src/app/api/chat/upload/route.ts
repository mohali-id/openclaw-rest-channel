// ---------------------------------------------------------------------------
// POST /api/chat/upload — Handle file uploads for attachments
// ---------------------------------------------------------------------------
// Accepts multipart form data, saves files to public/uploads/, and returns
// a public URL that can be referenced in chat messages.

import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided. Send a 'file' field." },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024} MB.` },
        { status: 413 },
      );
    }

    // Ensure the upload directory exists
    await mkdir(UPLOAD_DIR, { recursive: true });

    // Generate a unique filename to avoid collisions
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filename = `${timestamp}-${random}-${sanitized}`;
    const filePath = path.join(UPLOAD_DIR, filename);

    // Write the file
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    // Build the public URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const publicUrl = `${appUrl}/uploads/${filename}`;

    console.log(`[upload] Saved ${file.name} (${file.size} bytes) → ${filename}`);

    return NextResponse.json({
      ok: true,
      url: publicUrl,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
    });
  } catch (err) {
    console.error("[upload] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
