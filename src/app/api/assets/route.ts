import { errorResponse, PlatformError } from "@/server/errors";
import { listAssets } from "@/server/repository";
import { storeUpload } from "@/server/storage";
import type { OutputKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedExact = new Set([
  "application/pdf", "application/json", "application/zip", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function kindFromMime(mime: string): OutputKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

function allowedMime(mime: string): boolean {
  return mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/") || mime.startsWith("text/") || allowedExact.has(mime);
}

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 100);
  return Response.json({ assets: listAssets(Number.isFinite(limit) ? limit : 100) });
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new PlatformError("FILE_REQUIRED", "Choose a file to upload.", 422);
    if (!allowedMime(file.type || "application/octet-stream")) throw new PlatformError("UNSUPPORTED_FILE", "This file type is not supported. Use an image, video, audio, text, PDF, JSON, ZIP, or Office document.", 415);
    const buffer = Buffer.from(await file.arrayBuffer());
    const asset = await storeUpload({ name: file.name, mimeType: file.type || "application/octet-stream", buffer, kind: kindFromMime(file.type) });
    return Response.json({ asset }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
