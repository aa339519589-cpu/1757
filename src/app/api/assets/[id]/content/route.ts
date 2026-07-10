import { errorResponse } from "@/server/errors";
import { assetBytes } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { asset, bytes } = await assetBytes(id);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": asset.mimeType,
        "content-length": String(bytes.byteLength),
        "content-disposition": `inline; filename="${asset.name.replace(/["\\\r\n]/g, "-")}"`,
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
