import { errorResponse } from "@/server/errors";
import { retryRun } from "@/server/run-engine";

export const runtime = "nodejs";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json({ run: retryRun(id) }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
