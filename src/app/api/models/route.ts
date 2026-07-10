import { listModelManifests } from "@/server/manifests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ models: listModelManifests() });
}
