import http from "node:http";

const columns = [
  "slug",
  "display_name",
  "logo_url",
  "banner_urls",
  "color_primary",
  "color_secondary",
  "color_accent",
  "address_line",
  "city",
  "state",
  "phone_public",
  "whatsapp_public",
  "instagram_handle",
  "timezone",
  "opening_hours",
  "booking_policy_text",
];

const names = { ativo: "Ativo", trial1: "Trial" };

function row(slug) {
  const value = {
    slug,
    display_name: names[slug],
    logo_url: null,
    banner_urls: [],
    color_primary: null,
    color_secondary: null,
    color_accent: null,
    address_line: null,
    city: null,
    state: null,
    phone_public: null,
    whatsapp_public: null,
    instagram_handle: null,
    timezone: "America/Sao_Paulo",
    opening_hours: [],
    booking_policy_text: null,
  };
  return Object.fromEntries(columns.map((key) => [key, value[key] ?? null]));
}

const port = Number(process.env.STUB_PORT ?? 3999);
const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || !req.url?.startsWith("/rest/v1/rpc/get_tenant_public")) {
    res.writeHead(404).end();
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  const slug = body.p_slug;
  const found = Object.hasOwn(names, slug) ? [row(slug)] : [];
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(found));
});
server.listen(port, process.env.STUB_HOST ?? "127.0.0.1");
