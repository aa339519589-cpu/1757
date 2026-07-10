import { retestConnection } from "@/server/connection-service";
import { errorResponse, PlatformError } from "@/server/errors";
import { getConnection } from "@/server/repository";

export const runtime = "nodejs";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (id === "demo") return Response.json({ ok: true, message: "Demo runs locally and is ready." });
    const connection = getConnection(id);
    if (!connection) throw new PlatformError("CONNECTION_NOT_FOUND", "This connection no longer exists.", 404);
    return Response.json({ ok: true, ...(await retestConnection(connection)) });
  } catch (error) {
    return errorResponse(error);
  }
}
