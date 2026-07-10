import type { ConnectionPublic } from "@/lib/types";
import { saveConnectionDraft } from "@/server/connection-service";
import { errorResponse } from "@/server/errors";
import { listConnections } from "@/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const demoConnection: ConnectionPublic = {
  id: "demo",
  kind: "demo",
  name: "Demo Mode",
  description: "Local image, video, talk, and analysis flows. No API key required.",
  capability: "multi",
  baseUrl: null,
  status: "connected",
  keyHint: null,
  modelCount: 4,
  lastTestedAt: null,
  lastError: null,
  createdAt: new Date(0).toISOString(),
};

export async function GET() {
  return Response.json({ connections: [demoConnection, ...listConnections()] });
}

export async function POST(request: Request) {
  try {
    const connection = await saveConnectionDraft(await request.json());
    return Response.json({ connection }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
