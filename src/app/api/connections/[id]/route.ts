import { errorResponse, PlatformError } from "@/server/errors";
import { getConnection, removeConnection } from "@/server/repository";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const connection = getConnection(id);
    if (!connection) throw new PlatformError("CONNECTION_NOT_FOUND", "This connection no longer exists.", 404);
    const { credentials: _credentials, ...publicConnection } = connection;
    return Response.json({ connection: publicConnection });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (id === "demo") throw new PlatformError("DEMO_REQUIRED", "Demo Mode is built in and cannot be removed.", 409);
    if (!removeConnection(id)) throw new PlatformError("CONNECTION_NOT_FOUND", "This connection no longer exists.", 404);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
