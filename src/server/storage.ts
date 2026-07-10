import { copyFile, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { AssetRecord, NormalizedOutput, OutputKind } from "@/lib/types";
import { assetRoot } from "./db";
import { PlatformError } from "./errors";
import { getAsset, insertAsset, linkRunAsset } from "./repository";
import { safeFetch } from "./security";

const mimeExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "application/pdf": "pdf",
  "application/json": "json",
  "text/plain": "txt",
};

function fallbackMime(kind: OutputKind): string {
  return {
    text: "text/plain",
    image: "image/png",
    video: "video/mp4",
    audio: "audio/mpeg",
    file: "application/octet-stream",
    json: "application/json",
  }[kind];
}

function safeName(value: string): string {
  const clean = value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return clean || "asset";
}

async function dimensions(buffer: Buffer, kind: OutputKind): Promise<{ width: number | null; height: number | null }> {
  if (kind !== "image") return { width: null, height: null };
  try {
    const metadata = await sharp(buffer).metadata();
    return { width: metadata.width ?? null, height: metadata.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

async function writeAtomic(storageKey: string, buffer: Buffer): Promise<void> {
  const finalPath = path.join(assetRoot, storageKey);
  const tempPath = `${finalPath}.tmp`;
  await writeFile(tempPath, buffer, { mode: 0o600 });
  await rename(tempPath, finalPath);
}

export async function persistOutput(
  runId: string,
  output: NormalizedOutput,
  context: { prompt?: string | null; duration?: number | null } = {},
): Promise<AssetRecord> {
  const mimeType = output.mimeType ?? fallbackMime(output.kind);
  const displayName = output.name ?? `${output.kind}-${runId.slice(0, 8)}`;
  let buffer: Buffer | null = null;
  let text: string | null = null;

  if (output.base64) buffer = Buffer.from(output.base64, "base64");
  else if (output.localPath) buffer = await readFile(output.localPath);
  else if (output.url) {
    const response = await safeFetch(output.url, {}, { timeoutMs: 60_000 });
    if (!response.ok) throw new PlatformError("ASSET_DOWNLOAD_FAILED", "The provider output could not be saved.", 502, `HTTP ${response.status}`);
    buffer = response.bytes;
  } else if (output.kind === "json") text = JSON.stringify(output.json ?? null, null, 2);
  else text = output.text ?? "";

  const actualMime = output.mimeType ?? (output.url ? undefined : mimeType) ?? mimeType;
  let storageKey: string | null = null;
  let measured = { width: null as number | null, height: null as number | null };
  if (buffer) {
    const extension = mimeExtensions[actualMime] ?? "bin";
    storageKey = `${runId}-${crypto.randomUUID()}.${extension}`;
    await writeAtomic(storageKey, buffer);
    measured = await dimensions(buffer, output.kind);
  }

  const asset = insertAsset({
    kind: output.kind,
    name: safeName(displayName),
    mimeType: actualMime,
    storageKey,
    text,
    size: buffer?.byteLength ?? Buffer.byteLength(text ?? "", "utf8"),
    width: measured.width,
    height: measured.height,
    duration: context.duration ?? null,
    sourceRunId: runId,
    parentAssetId: output.parentAssetId ?? null,
    prompt: context.prompt ?? null,
    metadata: output.metadata ?? {},
  });
  linkRunAsset(runId, asset.id, "output");

  if (output.localPath) await unlink(output.localPath).catch(() => undefined);
  return asset;
}

export async function storeUpload(input: {
  name: string;
  mimeType: string;
  buffer: Buffer;
  kind: OutputKind;
}): Promise<AssetRecord> {
  const maxBytes = Number(process.env.MAX_UPLOAD_MB ?? 25) * 1024 * 1024;
  if (!input.buffer.length) throw new PlatformError("EMPTY_UPLOAD", "Choose a non-empty file.", 400);
  if (input.buffer.length > maxBytes) throw new PlatformError("UPLOAD_TOO_LARGE", `Files are limited to ${Math.round(maxBytes / 1024 / 1024)} MB.`, 413);
  const extension = (mimeExtensions[input.mimeType] ?? path.extname(input.name).replace(".", "")) || "bin";
  const storageKey = `upload-${crypto.randomUUID()}.${extension}`;
  await writeAtomic(storageKey, input.buffer);
  const measured = await dimensions(input.buffer, input.kind);
  return insertAsset({
    kind: input.kind,
    name: safeName(input.name),
    mimeType: input.mimeType || fallbackMime(input.kind),
    storageKey,
    size: input.buffer.length,
    width: measured.width,
    height: measured.height,
    metadata: { source: "upload" },
  });
}

export async function assetBytes(id: string): Promise<{ asset: AssetRecord; bytes: Buffer }> {
  const asset = getAsset(id);
  if (!asset) throw new PlatformError("ASSET_NOT_FOUND", "This asset no longer exists.", 404);
  if (asset.storageKey) return { asset, bytes: await readFile(path.join(assetRoot, asset.storageKey)) };
  return { asset, bytes: Buffer.from(asset.text ?? "", "utf8") };
}

export async function copyAssetTo(id: string, destination: string): Promise<void> {
  const asset = getAsset(id);
  if (!asset?.storageKey) throw new PlatformError("ASSET_FILE_REQUIRED", "This action requires a file asset.", 422);
  await copyFile(path.join(assetRoot, asset.storageKey), destination);
}
