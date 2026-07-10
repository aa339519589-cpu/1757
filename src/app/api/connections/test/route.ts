import { testConnectionDraft } from "@/server/connection-service";
import { errorResponse } from "@/server/errors";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return Response.json({ ok: true, ...(await testConnectionDraft(await request.json())) });
  } catch (error) {
    return errorResponse(error);
  }
}
