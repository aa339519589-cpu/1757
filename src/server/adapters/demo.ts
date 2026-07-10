import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import type { NormalizedOutput } from "@/lib/types";
import { dataRoot } from "../db";
import { PlatformError } from "../errors";
import { assetBytes } from "../storage";
import { getAsset } from "../repository";
import type { AdapterContext, PollResult, ProviderAdapter } from "./types";

const tmpRoot = path.join(dataRoot, "tmp");

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);
}

function wrap(value: string, length = 30): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    const source = words[0] ?? "Untitled study";
    return source.match(new RegExp(`.{1,${length}}`, "gu"))?.slice(0, 3) ?? [source];
  }
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (`${current} ${word}`.trim().length > length && current) {
      lines.push(current);
      current = word;
    } else current = `${current} ${word}`.trim();
    if (lines.length === 2) break;
  }
  if (current && lines.length < 3) lines.push(current);
  return lines;
}

async function makeImage(prompt: string, aspectRatio: string, variation: number): Promise<Buffer> {
  const [width, height] = aspectRatio === "1:1" ? [1080, 1080] : aspectRatio === "3:4" ? [900, 1200] : [1200, 900];
  const hash = createHash("sha256").update(`${prompt}:${variation}`).digest();
  const palettes = [
    ["#EEEDE8", "#18252B", "#C65F4B", "#5E7774"],
    ["#F0EEE9", "#24211E", "#54738A", "#B27B46"],
    ["#E9ECE8", "#192420", "#A65548", "#557169"],
  ];
  const colors = palettes[hash[0] % palettes.length];
  const offset = 12 + (hash[1] % 18);
  const title = wrap(prompt || "Untitled study");
  const titleSpans = title.map((line, index) => `<tspan x="${Math.round(width * 0.08)}" dy="${index === 0 ? 0 : Math.round(width * 0.052)}">${escapeXml(line)}</tspan>`).join("");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="${width}" height="${height}" fill="${colors[0]}"/>
      <rect x="${Math.round(width * 0.54)}" y="${Math.round(height * 0.08)}" width="${Math.round(width * 0.38)}" height="${Math.round(height * 0.66)}" fill="${colors[1]}"/>
      <rect x="${Math.round(width * 0.46)}" y="${Math.round(height * 0.18)}" width="${Math.round(width * 0.18)}" height="${Math.round(height * 0.48)}" fill="${colors[2]}"/>
      <rect x="${Math.round(width * 0.66)}" y="${Math.round(height * 0.54)}" width="${Math.round(width * 0.21)}" height="${Math.round(height * 0.27)}" fill="${colors[3]}"/>
      <line x1="${Math.round(width * 0.08)}" y1="${Math.round(height * 0.13)}" x2="${Math.round(width * 0.43)}" y2="${Math.round(height * 0.13)}" stroke="${colors[1]}" stroke-width="2"/>
      <text x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.1)}" fill="${colors[1]}" font-family="Arial, sans-serif" font-size="${Math.round(width * 0.018)}">STUDIO STUDY · ${String(variation).padStart(2, "0")}</text>
      <text x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.62)}" fill="${colors[1]}" font-family="Arial, sans-serif" font-size="${Math.round(width * 0.045)}" font-weight="600">${titleSpans}</text>
      <text x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.9)}" fill="${colors[1]}" opacity="0.66" font-family="Arial, sans-serif" font-size="${Math.round(width * 0.016)}">LOCAL DEMO · FRAME ${offset}</text>
    </svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

function runFfmpeg(args: string[]): Promise<void> {
  if (!ffmpegPath) throw new PlatformError("DEMO_VIDEO_UNAVAILABLE", "The local video encoder is unavailable.", 503);
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let detail = "";
    child.stderr.on("data", (chunk) => { detail = `${detail}${String(chunk)}`.slice(-2_000); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`Video encoder exited with ${code}: ${detail}`)));
  });
}

async function makeVideo(context: AdapterContext): Promise<string> {
  await mkdir(tmpRoot, { recursive: true, mode: 0o700 });
  const inputPath = path.join(tmpRoot, `${context.run.id}-source.png`);
  const outputPath = path.join(tmpRoot, `${context.run.id}-motion.mp4`);
  const assetId = typeof context.input.image === "string" ? context.input.image : null;
  const source = assetId
    ? (await assetBytes(assetId)).bytes
    : await makeImage(String(context.input.prompt ?? "Motion study"), "4:3", 3);
  await writeFile(inputPath, source, { mode: 0o600 });
  try {
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i", inputPath,
      "-vf", "scale=960:540:force_original_aspect_ratio=increase,crop=960:540,zoompan=z='min(zoom+0.0012,1.08)':d=96:s=960x540:fps=24,format=yuv420p",
      "-frames:v", "96", "-c:v", "libx264", "-preset", "veryfast", "-movflags", "+faststart", outputPath,
    ]);
  } finally {
    await unlink(inputPath).catch(() => undefined);
  }
  return outputPath;
}

export const demoAdapter: ProviderAdapter = {
  id: "demo",
  async validate() {
    return { message: "Demo runs locally and is ready." };
  },
  async invoke(context) {
    const prompt = String(context.input.prompt ?? "").trim();
    if (!prompt) throw new PlatformError("MISSING_INPUT", "Add a prompt before running this model.", 422);

    if (context.run.capability === "image") {
      context.emit("generating", "Rendering local image");
      const image = await makeImage(prompt, String(context.input.aspectRatio ?? "4:3"), Number(context.input.variation ?? 3));
      return {
        type: "complete",
        outputs: [{ kind: "image", name: "studio-still.png", mimeType: "image/png", base64: image.toString("base64"), metadata: { demo: true } }],
      };
    }
    if (context.run.capability === "video") {
      context.emit("queued", "Queued for local motion processing");
      return { type: "submitted", taskId: `demo:${Date.now()}:${context.run.id}`, pollAfterMs: 700, stage: "queued" };
    }
    if (context.run.capability === "analyze") {
      context.emit("analyzing", "Inspecting persisted asset");
      const assetId = typeof context.input.asset === "string" ? context.input.asset : null;
      const asset = assetId ? getAsset(assetId) : null;
      const facts = asset
        ? `${asset.name} is a ${asset.kind} asset (${asset.mimeType}), ${asset.width && asset.height ? `${asset.width} × ${asset.height}` : `${asset.size} bytes`}. It was saved ${asset.sourceRunId ? "from a completed run" : "as an upload"}.`
        : "No file asset was attached, so this local demo analyzed the request text only.";
      return {
        type: "complete",
        outputs: [
          { kind: "text", name: "analysis.txt", text: `${facts}\n\nRequested focus: ${prompt}\n\nDemo mode reports stored facts only; it does not claim semantic model inference.` },
          { kind: "json", name: "analysis.json", json: { demo: true, request: prompt, asset: asset ? { id: asset.id, kind: asset.kind, mimeType: asset.mimeType, width: asset.width, height: asset.height, size: asset.size } : null } },
        ],
      };
    }
    context.emit("generating", "Composing local response");
    const response = `Demo mode received: “${prompt.slice(0, 220)}”\n\nThis response is deterministic and local. The complete product path is still real: the run, events, result asset, history, retry, and cross-capability actions are persisted.`;
    return { type: "complete", outputs: [{ kind: "text", name: "demo-response.txt", text: response, metadata: { demo: true } }] };
  },
  async poll(context): Promise<PollResult> {
    const parts = String(context.run.upstreamTaskId ?? "").split(":");
    const submittedAt = Number(parts[1] ?? 0);
    const elapsed = Date.now() - submittedAt;
    if (elapsed < 1_400) return { state: "pending", stage: "queued", message: "Waiting for local encoder", pollAfterMs: 700 };
    if (elapsed < 3_200) return { state: "pending", stage: "running", message: "Creating motion", pollAfterMs: 700 };
    context.emit("finalizing", "Finalizing video file");
    const outputPath = await makeVideo(context);
    const parentAssetId = typeof context.input.image === "string" ? context.input.image : undefined;
    return {
      state: "complete",
      duration: 4,
      outputs: [{ kind: "video", name: "studio-motion.mp4", mimeType: "video/mp4", localPath: outputPath, parentAssetId, metadata: { demo: true } }],
    };
  },
};
