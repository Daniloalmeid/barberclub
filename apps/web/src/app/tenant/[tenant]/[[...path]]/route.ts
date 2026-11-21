import { isReservedSlug } from "@barberclub/config/reserved";
import { isSlugShape } from "@barberclub/config/slug";
import { canonicalUrl, classifyHost, loadConfig } from "@barberclub/core";
import { forwardedHost } from "@/server/request-host";
import { escapeHtml } from "@/server/html";
import { getTenantPublic, listServices, UpstreamError } from "@/server/tenant-public";

const NOT_FOUND_HTML =
  '<!DOCTYPE html><html lang="pt-BR"><head><meta name="robots" content="noindex"><title>Página não encontrada</title></head><body><main><p>Página não encontrada.</p></main></body></html>';

function neutral(): Response {
  return new Response(NOT_FOUND_HTML, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-cache, no-store, max-age=0, must-revalidate",
      "x-robots-tag": "noindex",
    },
  });
}

export const dynamic = "force-dynamic";

function unavailable(): Response {
  return new Response("<main><p>Serviço indisponível.</p></main>", {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "30",
    },
  });
}

// Página montada à mão, então o estilo vai inline: a CSP permite
// style-src 'unsafe-inline' e isto não depende do hash do CSS do build.
const STYLE =
  ':root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#fff;color:#171717;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.55}.wrap{width:100%;max-width:42rem;margin:0 auto;padding:0 1.25rem}header{border-bottom:1px solid #e5e5e5}header .wrap{display:flex;align-items:center;gap:.5rem;padding:1.1rem 1.25rem;font-weight:600;letter-spacing:-.01em}header i{display:block;width:.375rem;height:1.25rem;border-radius:9999px;background:#171717}main{padding:2rem 0 3rem}h1{font-size:1.75rem;font-weight:600;letter-spacing:-.02em;margin:0}.sub{color:#525252;font-size:.9375rem;margin:.5rem 0 0}h2{font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.12em;color:#737373;margin:2.5rem 0 .75rem}p{color:#525252;font-size:.9375rem}.cta{display:flex;flex-direction:column;gap:.5rem;margin-top:1.5rem}.btn{display:block;text-align:center;text-decoration:none;font-weight:500;font-size:.9375rem;padding:.8rem 1rem;border-radius:.75rem}.btn-primary{background:#171717;color:#fff}.btn-primary:hover{background:#404040}.btn-ghost{border:1px solid #d4d4d4;color:#171717}.services{list-style:none;margin:0;padding:0;border-top:1px solid #e5e5e5}.services li{display:flex;justify-content:space-between;gap:1rem;padding:.9rem 0;border-bottom:1px solid #e5e5e5}.services .name{display:block;font-weight:500;font-size:.9375rem}.services .desc{display:block;color:#737373;font-size:.8125rem;margin-top:.15rem}.services .meta{text-align:right;white-space:nowrap;font-size:.8125rem;color:#737373}.services .price{display:block;color:#171717;font-weight:500;font-size:.9375rem}.hours{margin:0}.hours .row{display:flex;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid #f5f5f5;font-size:.9375rem}.hours dt{color:#525252}.hours dd{margin:0;color:#171717}.hours .off{color:#a3a3a3}.note{margin-top:2rem;padding:1rem;background:#fafafa;border-radius:.75rem;font-size:.875rem;color:#525252}footer{border-top:1px solid #e5e5e5;font-size:.8125rem;color:#a3a3a3}footer .wrap{padding:1.5rem 1.25rem}footer a{color:#737373;text-decoration:none}@media(min-width:640px){h1{font-size:2.25rem}.cta{flex-direction:row}.btn{width:auto;padding:.8rem 1.25rem}}';

const WEEKDAYS: [string, string][] = [
  ["mon", "Segunda"],
  ["tue", "Terça"],
  ["wed", "Quarta"],
  ["thu", "Quinta"],
  ["fri", "Sexta"],
  ["sat", "Sábado"],
  ["sun", "Domingo"],
];

function money(cents: unknown): string {
  const value = Number(cents);
  if (!Number.isFinite(value) || value < 0) return "";
  return (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function hoursBlock(openingHours: unknown): string {
  if (!openingHours || typeof openingHours !== "object") return "";
  const table = openingHours as Record<string, unknown>;
  const rows = WEEKDAYS.map(([key, label]) => {
    const raw = table[key];
    const value = typeof raw === "string" && raw.trim() ? raw.trim() : "";
    return value
      ? `<div class="row"><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`
      : `<div class="row"><dt>${label}</dt><dd class="off">Fechado</dd></div>`;
  }).join("");
  return `<h2>Horários</h2><dl class="hours">${rows}</dl>`;
}

function servicesBlock(services: Awaited<ReturnType<typeof listServices>>, whatsapp: string): string {
  if (!services.length) {
    return `<h2>Serviços</h2><p>Os serviços estão sendo cadastrados.${
      whatsapp ? ` Fale com a gente no WhatsApp para saber o que está disponível.` : ""
    }</p>`;
  }
  const items = services
    .map((service) => {
      const price = money(service.price_cents);
      const duration = Number(service.duration_min);
      const desc = service.description ? `<span class="desc">${escapeHtml(String(service.description))}</span>` : "";
      const meta = `${Number.isFinite(duration) && duration > 0 ? `${duration} min` : ""}${
        price ? `<span class="price">${escapeHtml(price)}</span>` : ""
      }`;
      return `<li><div><span class="name">${escapeHtml(String(service.name))}</span>${desc}</div><div class="meta">${meta}</div></li>`;
    })
    .join("");
  return `<h2>Serviços</h2><ul class="services">${items}</ul>`;
}

function whatsappLink(raw: unknown, name: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  const text = encodeURIComponent(`Olá! Vim pelo site da ${name} e quero marcar um horário.`);
  return `https://wa.me/${digits}?text=${text}`;
}

export async function GET(request: Request, context: { params: Promise<{ tenant: string; path?: string[] }> }) {
  const { path } = await context.params;
  const cfg = loadConfig();
  const host = classifyHost(forwardedHost(request.headers), cfg.rootDomain);
  if (host.kind !== "tenant") return neutral();
  const slug = host.slug;
  if (!isSlugShape(slug) || isReservedSlug(slug)) return neutral();
  let row;
  try {
    row = await getTenantPublic(slug);
  } catch (error) {
    if (error instanceof UpstreamError) return unavailable();
    throw error;
  }
  if (!row) return neutral();
  if (path && path.length > 0) return neutral();
  const canonical = canonicalUrl({ kind: "tenant", slug }, "/", cfg);
  const nome = String(row.display_name ?? "").trim() || slug;
  const name = escapeHtml(nome);
  const services = await listServices(slug);
  const wa = whatsappLink(row.whatsapp_public, nome);
  const phone = String(row.phone_public ?? "").trim();
  const city = String(row.city ?? "").trim();
  const state = String(row.state ?? "").trim();
  const address = String(row.address_line ?? "").trim();
  const local = [address, [city, state].filter(Boolean).join("/")].filter(Boolean).join(" — ");
  const policy = String(row.booking_policy_text ?? "").trim();
  const cta = [
    wa
      ? `<a class="btn btn-primary" href="${escapeHtml(wa)}" target="_blank" rel="noopener noreferrer">Marcar horário no WhatsApp</a>`
      : "",
    phone
      ? `<a class="btn btn-ghost" href="tel:${escapeHtml(phone.replace(/[^\d+]/g, ""))}">Ligar — ${escapeHtml(phone)}</a>`
      : "",
  ].join("");
  const title = escapeHtml(city ? `${nome} — ${city}` : nome);
  const description = escapeHtml(
    `${nome}${city ? ` em ${city}` : ""}. Veja os serviços, os horários e marque seu atendimento.`,
  );
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="index,follow"><title>${title}</title><meta name="description" content="${description}"><link rel="canonical" href="${escapeHtml(canonical)}"><style>${STYLE}</style></head><body><header><div class="wrap"><i aria-hidden="true"></i>${name}</div></header><main><div class="wrap"><h1>${name}</h1>${local ? `<p class="sub">${escapeHtml(local)}</p>` : ""}${cta ? `<div class="cta">${cta}</div>` : ""}${servicesBlock(services, wa)}${hoursBlock(row.opening_hours)}${policy ? `<p class="note">${escapeHtml(policy)}</p>` : ""}</div></main><footer><div class="wrap"><a href="https://barber.workloop.com.br">BarberClub</a></div></footer></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
