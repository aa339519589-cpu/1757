import { errorResponse, PlatformError } from "@/server/errors";
import { getRun } from "@/server/repository";
import { cancelRunAndUpstream } from "@/server/run-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const run = getRun(id);
    if (!run) throw new PlatformError("RUN_NOT_FOUND", "This run no longer exists.", 404);
    return Response.json({ run });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!await cancelRunAndUpstream(id)) throw new PlatformError("RUN_NOT_CANCELLABLE", "This run has already finished.", 409);
    return Response.json({ run: getRun(id) });
  } catch (error) {
    return errorResponse(error);
  }
}
