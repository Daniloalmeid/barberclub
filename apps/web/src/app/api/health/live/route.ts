export function GET(request: Request) {
  if ([...request.headers.keys()].some((key) => key.toLowerCase().startsWith("x-bc-"))) {
    return Response.json({ error: "client_mark" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
}
