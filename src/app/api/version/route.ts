export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      service: "relay",
      build: "render-api-404-fix",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
