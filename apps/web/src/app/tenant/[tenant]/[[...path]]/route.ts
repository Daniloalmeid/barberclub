import { isReservedSlug } from "@barberclub/config/reserved";
import { isSlugShape } from "@barberclub/config/slug";
import { canonicalUrl, classifyHost, loadConfig } from "@barberclub/core";
import { forwardedHost } from "@/server/request-host";
import { escapeHtml } from "@/server/html";
import { getTenantPublic, listFreeSlots, listServices, listStaff, UpstreamError } from "@/server/tenant-public";
import {
  bookWithSession,
  cadastrar,
  clearSessionHeaders,
  confirmAppointment,
  creditCashback,
  customerAppointments,
  customerCashback,
  customerMe,
  entrar,
  idempotencyKeyFor,
  loginStaff,
  panelAgenda,
  panelResumo,
  panelRole,
  readSession,
  sessionHeaders,
  setAppointmentStatus,
  tenantBySlug,
} from "@/server/customer-auth";

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

// ---------- tema da barbearia (white-label) ----------
// As três cores vêm de tenant_branding. Só aceita hex válido: cor vinda do banco
// não pode injetar CSS. O texto sobre o acento é escolhido por luminância, senão
// barbearia de marca clara fica com botão ilegível.
function luminance(hex: string): number {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function themeOf(row: Record<string, unknown>): { primary: string; secondary: string; accent: string; onPrimary: string } {
  const pick = (value: unknown, fallback: string) => {
    const text = String(value ?? "").trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(text) ? text : fallback;
  };
  const primary = pick(row.color_primary, "#6deaed");
  return {
    primary,
    secondary: pick(row.color_secondary, "#26262b"),
    accent: pick(row.color_accent, "#9ca3af"),
    onPrimary: luminance(primary) > 0.55 ? "#101012" : "#ffffff",
  };
}

function appCss(t: { primary: string; secondary: string; accent: string; onPrimary: string }): string {
  return `:root{color-scheme:dark;--p:${t.primary};--s:${t.secondary};--a:${t.accent};--on:${t.onPrimary};
--bg:#101012;--surface:#191a1d;--surface2:#202127;--line:#2a2b31;--txt:#f4f4f5;--muted:#9b9ba4}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.55;padding-bottom:5.5rem;-webkit-font-smoothing:antialiased}
.wrap{width:100%;max-width:34rem;margin:0 auto;padding:0 1rem}
header{position:sticky;top:0;z-index:10;background:rgba(16,16,18,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
header .wrap{display:flex;align-items:center;gap:.65rem;padding:.85rem 1rem}
.logo{width:2.25rem;height:2.25rem;border-radius:.65rem;object-fit:cover;background:var(--surface2);color:var(--p);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.85rem;border:1px solid var(--line)}
header .name{font-weight:650;letter-spacing:-.01em;font-size:.98rem}
header .city{font-size:.72rem;color:var(--muted)}
main{padding:1.1rem 0 2rem}
h1{font-size:1.55rem;font-weight:700;letter-spacing:-.025em;margin:0 0 .25rem}
.sub{color:var(--muted);font-size:.88rem;margin:0}
h2{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.16em;color:var(--muted);margin:1.6rem 0 .6rem}
.card{display:block;background:var(--surface);border:1px solid var(--line);border-radius:1rem;padding:.9rem 1rem;text-decoration:none;color:inherit;margin-bottom:.55rem}
.card:active{border-color:var(--p)}
.card .row{display:flex;justify-content:space-between;gap:.75rem;align-items:baseline}
.card .t{font-weight:600;font-size:.95rem}
.card .d{color:var(--muted);font-size:.78rem;margin-top:.15rem}
.card .price{font-weight:700;white-space:nowrap;color:var(--p)}
.cta{display:block;text-align:center;text-decoration:none;background:var(--p);color:var(--on);font-weight:700;font-size:.95rem;padding:.9rem 1rem;border-radius:.9rem;margin:1rem 0 .5rem}
.ghost{display:block;text-align:center;text-decoration:none;border:1px solid var(--line);background:var(--surface);color:var(--txt);font-weight:500;font-size:.88rem;padding:.8rem 1rem;border-radius:.9rem;margin:.5rem 0}
.team{display:flex;gap:.6rem;overflow-x:auto;padding-bottom:.25rem}
.team .who{min-width:5.5rem;text-align:center;background:var(--surface);border:1px solid var(--line);border-radius:1rem;padding:.75rem .5rem;font-size:.76rem;font-weight:500}
.avatar{width:2.5rem;height:2.5rem;border-radius:9999px;background:var(--surface2);color:var(--p);display:flex;align-items:center;justify-content:center;font-weight:800;margin:0 auto .4rem;border:1px solid var(--line)}
.hours{background:var(--surface);border:1px solid var(--line);border-radius:1rem;padding:.2rem .9rem}
.hours .r{display:flex;justify-content:space-between;padding:.45rem 0;border-bottom:1px solid var(--line);font-size:.85rem}
.hours .r:last-child{border-bottom:0}
.hours .off{color:#6b6b74}
.days{display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem}
.days a{background:var(--surface);border:1px solid var(--line);border-radius:.8rem;padding:.6rem .3rem;text-align:center;text-decoration:none;color:inherit;font-size:.74rem;line-height:1.3}
.days a.on{background:var(--p);color:var(--on);border-color:var(--p)}
.slots{display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem}
.slots a{background:var(--surface);border:1px solid var(--line);border-radius:.7rem;padding:.65rem 0;text-align:center;text-decoration:none;color:inherit;font-size:.9rem;font-weight:600}
.slots a:active{background:var(--p);color:var(--on);border-color:var(--p)}
.empty{background:var(--surface);border:1px dashed var(--line);border-radius:1rem;padding:1rem;color:var(--muted);font-size:.86rem}
nav.tabs{position:fixed;bottom:0;left:0;right:0;z-index:20;background:rgba(25,26,29,.96);backdrop-filter:blur(8px);border-top:1px solid var(--line);display:flex;padding-bottom:env(safe-area-inset-bottom)}
nav.tabs a{flex:1;text-align:center;padding:.6rem 0 .7rem;text-decoration:none;color:#6f6f79;font-size:.66rem;font-weight:600}
nav.tabs a.on{color:var(--p)}
nav.tabs .ico{display:block;font-size:1.05rem;line-height:1.25}
footer{padding:1.5rem 0 1rem;text-align:center;color:#5e5e67;font-size:.7rem}
footer a{color:var(--muted);text-decoration:none}`;
}

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function fmtTime(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}

function fmtDay(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: timezone }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

type Crumb = { label: string; href: string };

function appPage(options: {
  row: Record<string, unknown>;
  name: string;
  canonical: string;
  title: string;
  description: string;
  body: string;
  nav?: "inicio" | "agendar" | "conta";
  crumbs?: Crumb[];
}): string {
  const theme = themeOf(options.row);
  const city = String(options.row.city ?? "").trim();
  const logo = String(options.row.logo_url ?? "").trim();
  const logoHtml = /^https:\/\//.test(logo)
    ? `<img class="logo" src="${escapeHtml(logo)}" alt="">`
    : `<span class="logo">${escapeHtml(initials(options.name))}</span>`;
  const crumbs = (options.crumbs ?? [])
    .map((crumb) => `<a class="ghost" href="${escapeHtml(crumb.href)}">${escapeHtml(crumb.label)}</a>`)
    .join("");
  const nav = (key: "inicio" | "agendar" | "conta", label: string, icon: string, href: string) =>
    `<a class="${options.nav === key ? "on" : ""}" href="${escapeHtml(href)}"><span class="ico">${icon}</span>${label}</a>`;
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="${escapeHtml(theme.primary)}"><title>${escapeHtml(options.title)}</title><meta name="description" content="${escapeHtml(options.description)}"><link rel="canonical" href="${escapeHtml(options.canonical)}"><style>${appCss(theme)}</style></head><body><header><div class="wrap">${logoHtml}<span><span class="name">${escapeHtml(options.name)}</span>${city ? `<br><span class="city">${escapeHtml(city)}</span>` : ""}</span></div></header><main><div class="wrap">${options.body}</div></main><nav class="tabs">${nav("inicio", "Início", "⌂", "/")}${nav("agendar", "Agendar", "◷", "/agendar")}${nav("conta", "Conta", "☺", "/conta")}</nav><footer><div class="wrap">Feito com <a href="https://barber.workloop.com.br">BarberClub</a></div></footer></body></html>`;
}


function hoursApp(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const table = raw as Record<string, unknown>;
  const rows = WEEKDAYS.map(([key, label]) => {
    const value = typeof table[key] === "string" ? String(table[key]).trim() : "";
    return value
      ? `<div class="r"><span>${label}</span><span>${escapeHtml(value)}</span></div>`
      : `<div class="r"><span>${label}</span><span class="off">Fechado</span></div>`;
  }).join("");
  return `<h2>Horários</h2><div class="hours">${rows}</div>`;
}

function todayIn(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function nextDays(fromIso: string, count: number): string[] {
  const base = Date.parse(`${fromIso}T12:00:00Z`);
  const days: string[] = [];
  for (let index = 0; index < count; index += 1) {
    days.push(new Date(base + index * 86_400_000).toISOString().slice(0, 10));
  }
  return days;
}

function renderHome(o: {
  row: Record<string, unknown>;
  slug: string;
  nome: string;
  timezone: string;
  canonical: string;
  services: Awaited<ReturnType<typeof listServices>>;
  staff: Awaited<ReturnType<typeof listStaff>>;
}): string {
  const address = String(o.row.address_line ?? "").trim();
  const city = String(o.row.city ?? "").trim();
  const state = String(o.row.state ?? "").trim();
  const local = [address, [city, state].filter(Boolean).join("/")].filter(Boolean).join(" — ");
  const wa = whatsappLink(o.row.whatsapp_public, o.nome);
  const cards = o.services.length
    ? o.services
        .map(
          (service) =>
            `<a class="card" href="/agendar?servico=${escapeHtml(service.service_id)}"><div class="row"><span class="t">${escapeHtml(service.name)}</span><span class="price">${escapeHtml(money(service.price_cents))}</span></div><span class="d">${Number(service.duration_min)} min${
              service.description ? ` · ${escapeHtml(String(service.description))}` : ""
            }</span></a>`,
        )
        .join("")
    : `<p class="empty">Os serviços estão sendo cadastrados.</p>`;
  const team = o.staff.length
    ? `<h2>Equipe</h2><div class="team">${o.staff
        .map((member) => `<div class="who"><div class="avatar">${escapeHtml(initials(member.display_name))}</div>${escapeHtml(member.display_name)}</div>`)
        .join("")}</div>`
    : "";
  const body = `<h1>${escapeHtml(o.nome)}</h1>${local ? `<p class="sub">${escapeHtml(local)}</p>` : ""}<a class="cta" href="/agendar">Agendar horário</a>${wa ? `<a class="ghost" href="${escapeHtml(wa)}" target="_blank" rel="noopener noreferrer">Falar no WhatsApp</a>` : ""}<h2>Serviços</h2>${cards}${team}${hoursApp(o.row.opening_hours)}`;
  return appPage({
    row: o.row,
    name: o.nome,
    canonical: o.canonical,
    title: city ? `${o.nome} — ${city}` : o.nome,
    description: `${o.nome}${city ? ` em ${city}` : ""}. Veja os serviços, os horários e agende seu atendimento.`,
    body,
    nav: "inicio",
  });
}

async function renderBooking(o: {
  request: Request;
  row: Record<string, unknown>;
  slug: string;
  nome: string;
  timezone: string;
  canonical: string;
}): Promise<string> {
  const params = new URL(o.request.url).searchParams;
  const servico = (params.get("servico") ?? "").trim();
  const dia = (params.get("dia") ?? "").trim();
  const hora = (params.get("hora") ?? "").trim();
  const services = await listServices(o.slug);
  const base = {
    row: o.row,
    name: o.nome,
    canonical: `${o.canonical}agendar`,
    title: `Agendar — ${o.nome}`,
    description: `Escolha serviço, dia e horário na ${o.nome}.`,
    nav: "agendar" as const,
  };

  if (!services.length) {
    return appPage({ ...base, body: `<h1>Agendar</h1><p class="empty">Os serviços estão sendo cadastrados. Fale com a barbearia para marcar.</p>` });
  }

  const service = services.find((item) => item.service_id === servico);
  if (!service) {
    const list = services
      .map(
        (item) =>
          `<a class="card" href="/agendar?servico=${escapeHtml(item.service_id)}"><div class="row"><span class="t">${escapeHtml(item.name)}</span><span class="price">${escapeHtml(money(item.price_cents))}</span></div><span class="d">${Number(item.duration_min)} min</span></a>`,
      )
      .join("");
    return appPage({ ...base, body: `<h1>Escolha o serviço</h1><p class="sub">Passo 1 de 3</p>${list}` });
  }

  const serviceLabel = escapeHtml(service.name);
  const back = `<a class="ghost" href="/agendar">Trocar serviço</a>`;

  if (!dia) {
    const days = nextDays(todayIn(o.timezone), 14);
    const grid = days
      .map((day) => {
        const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
        return `<a href="/agendar?servico=${escapeHtml(service.service_id)}&dia=${day}">${escapeHtml(DIAS[weekday])}<br>${day.slice(8, 10)}/${day.slice(5, 7)}</a>`;
      })
      .join("");
    return appPage({
      ...base,
      body: `<h1>${serviceLabel}</h1><p class="sub">Passo 2 de 3 · escolha o dia</p><div class="days">${grid}</div>${back}`,
    });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
    return appPage({ ...base, body: `<h1>${serviceLabel}</h1><p class="empty">Dia inválido.</p>${back}` });
  }

  const slots = await listFreeSlots(o.slug, service.service_id, dia);
  const equipe = await listStaff(o.slug);
  const primeiroNome = new Map(equipe.map((item) => [item.staff_id, item.display_name.split(/\s+/)[0] ?? item.display_name]));
  const dayLabel = fmtDay(`${dia}T12:00:00Z`, o.timezone);

  if (hora) {
    const staffId = (params.get("staff") ?? "").trim();
    const chosen = slots.find((slot) => slot.starts_at === hora && (!staffId || slot.staff_id === staffId));
    const label = chosen ? fmtTime(chosen.starts_at, o.timezone) : hora.slice(11, 16);
    const quem = chosen ? (primeiroNome.get(chosen.staff_id) ?? "") : "";
    const next = `/agendar?servico=${encodeURIComponent(service.service_id)}&dia=${dia}&hora=${encodeURIComponent(hora)}&staff=${encodeURIComponent(chosen?.staff_id ?? staffId)}`;
    const { accessToken } = readSession(o.request);
    // Com sessão: botão que grava de verdade. Sem sessão: o mesmo botão vira entrada,
    // porque book_appointment exige cliente identificado.
    const acao = accessToken
      ? `<form method="post" action="/confirmar">` +
        `<input type="hidden" name="servico" value="${escapeHtml(service.service_id)}">` +
        `<input type="hidden" name="staff" value="${escapeHtml(chosen?.staff_id ?? staffId)}">` +
        `<input type="hidden" name="dia" value="${escapeHtml(dia)}">` +
        `<input type="hidden" name="hora" value="${escapeHtml(hora)}">` +
        `<button class="cta" type="submit">Confirmar horário</button></form>`
      : `<a class="cta" href="/entrar?next=${encodeURIComponent(next)}">Entrar e confirmar</a>`;
    return appPage({
      ...base,
      body:
        `<h1>${serviceLabel}</h1><p class="sub">${escapeHtml(dayLabel)} às ${escapeHtml(label)}${quem ? ` · ${escapeHtml(quem)}` : ""}</p>` +
        `<div class="card"><div class="row"><span class="t">${escapeHtml(service.name)}</span><span class="price">${escapeHtml(money(service.price_cents))}</span></div><span class="d">${Number(service.duration_min)} min</span></div>` +
        acao +
        `<a class="ghost" href="/agendar?servico=${escapeHtml(service.service_id)}&dia=${dia}">Escolher outro horário</a>`,
    });
  }

  const grid = slots.length
    ? slots
        .map((slot) => {
          const quem = primeiroNome.get(slot.staff_id) ?? "";
          return `<a href="/agendar?servico=${escapeHtml(service.service_id)}&dia=${dia}&hora=${encodeURIComponent(slot.starts_at)}&staff=${encodeURIComponent(slot.staff_id)}">${escapeHtml(fmtTime(slot.starts_at, o.timezone))}${quem ? `<br><span style="font-size:.6rem;opacity:.65">${escapeHtml(quem)}</span>` : ""}</a>`;
        })
        .join("")
    : "";
  const body = grid
    ? `<h1>${serviceLabel}</h1><p class="sub">Passo 3 de 3 · ${escapeHtml(dayLabel)}</p><div class="slots">${grid}</div><a class="ghost" href="/agendar?servico=${escapeHtml(service.service_id)}">Trocar o dia</a>`
    : `<h1>${serviceLabel}</h1><p class="sub">${escapeHtml(dayLabel)}</p><p class="empty">Nenhum horário livre neste dia. Escolha outro dia.</p><a class="ghost" href="/agendar?servico=${escapeHtml(service.service_id)}">Trocar o dia</a>`;
  return appPage({ ...base, body });
}

// ---------- painel do barbeiro ----------
// Quem entra aqui é membro da barbearia (memberships), não cliente. A permissão é
// conferida no banco (server_api.set_appointment_status recebe o ator e valida o papel).

function offsetEm(timezone: string, iso: string): string {
  try {
    const partes = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" }).formatToParts(
      new Date(iso),
    );
    const nome = partes.find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
    const m = nome.match(/GMT([+-])(\d{2}):?(\d{2})?/);
    return m ? `${m[1]}${m[2]}:${m[3] ?? "00"}` : "+00:00";
  } catch {
    return "+00:00";
  }
}

// Janela do dia no fuso da barbearia. Sem isso, "hoje" em São Paulo começaria às 21h
// do dia anterior em UTC e a agenda mostraria a noite errada.
function janelaDoDia(dia: string, timezone: string): { from: string; to: string } {
  const proximo = new Date(`${dia}T12:00:00Z`);
  proximo.setUTCDate(proximo.getUTCDate() + 1);
  const dia2 = proximo.toISOString().slice(0, 10);
  return {
    from: `${dia}T00:00:00${offsetEm(timezone, `${dia}T12:00:00Z`)}`,
    to: `${dia2}T00:00:00${offsetEm(timezone, `${dia2}T12:00:00Z`)}`,
  };
}

function somaDia(dia: string, delta: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

const ACAO_STATUS: Record<string, Array<{ status: string; rotulo: string }>> = {
  hold: [
    { status: "confirmed", rotulo: "Confirmar" },
    { status: "canceled", rotulo: "Cancelar" },
  ],
  pending_payment: [
    { status: "confirmed", rotulo: "Confirmar" },
    { status: "canceled", rotulo: "Cancelar" },
  ],
  confirmed: [
    { status: "completed", rotulo: "Concluir" },
    { status: "no_show", rotulo: "Faltou" },
    { status: "canceled", rotulo: "Cancelar" },
  ],
};

function renderPainelEntrar(o: { row: Record<string, unknown>; nome: string; canonical: string; erro?: string }): string {
  const erro = o.erro ? `<p class="empty">${escapeHtml(o.erro)}</p>` : "";
  return appPage({
    row: o.row,
    name: o.nome,
    canonical: `${o.canonical}painel`,
    title: `Painel — ${o.nome}`,
    description: `Acesso da equipe da ${o.nome}.`,
    body:
      `<h1>Painel</h1><p class="sub">Acesso da equipe da barbearia.</p>${erro}` +
      `<form method="post" action="/painel/entrar"><div class="card">` +
      `<label class="d" for="email">E-mail</label><input id="email" name="email" required type="email" autocomplete="email" ${CAMPO}>` +
      `<label class="d" for="senha">Senha</label><input id="senha" name="senha" required type="password" autocomplete="current-password" ${CAMPO.replace(".85rem", ".2rem")}>` +
      `</div><button class="cta" type="submit">Entrar no painel</button></form>` +
      `<a class="ghost" href="/">Voltar ao site</a>`,
  });
}

function renderPainel(o: {
  row: Record<string, unknown>;
  nome: string;
  canonical: string;
  timezone: string;
  papel: string;
  dia: string;
  resumo: { total: number; confirmados: number; concluidos: number; cancelados: number; faturamento_cents: number };
  agenda: Array<{
    appointment_id: string;
    starts_at: string;
    status: string;
    customer_name: string | null;
    customer_phone: string | null;
    service_name: string | null;
    staff_name: string | null;
    price_cents: number | null;
  }>;
  erro?: string;
}): string {
  const hoje = todayIn(o.timezone);
  const numero = (v: number) => String(Number(v) || 0);
  const kpi =
    `<div class="hours" style="margin-bottom:.75rem">` +
    `<div class="r"><span>Agendamentos</span><span><strong>${numero(o.resumo.total)}</strong></span></div>` +
    `<div class="r"><span>Confirmados</span><span>${numero(o.resumo.confirmados)}</span></div>` +
    `<div class="r"><span>Concluídos</span><span>${numero(o.resumo.concluidos)}</span></div>` +
    `<div class="r"><span>Cancelados / faltas</span><span>${numero(o.resumo.cancelados)}</span></div>` +
    `<div class="r"><span>Previsto em caixa</span><span class="price" style="color:var(--p)">${escapeHtml(money(o.resumo.faturamento_cents))}</span></div>` +
    `</div>`;

  const nav =
    `<div class="days" style="grid-template-columns:repeat(3,1fr);margin-bottom:.75rem">` +
    `<a href="/painel?dia=${somaDia(o.dia, -1)}">Ontem<br>${somaDia(o.dia, -1).slice(8, 10)}/${somaDia(o.dia, -1).slice(5, 7)}</a>` +
    `<a class="${o.dia === hoje ? "on" : ""}" href="/painel?dia=${hoje}">Hoje<br>${hoje.slice(8, 10)}/${hoje.slice(5, 7)}</a>` +
    `<a href="/painel?dia=${somaDia(o.dia, 1)}">Amanhã<br>${somaDia(o.dia, 1).slice(8, 10)}/${somaDia(o.dia, 1).slice(5, 7)}</a>` +
    `</div>`;

  const lista = o.agenda.length
    ? o.agenda
        .map((a) => {
          const acoes = (ACAO_STATUS[a.status] ?? [])
            .map(
              (acao) =>
                `<form method="post" action="/painel/status" style="display:inline">` +
                `<input type="hidden" name="agendamento" value="${escapeHtml(a.appointment_id)}">` +
                `<input type="hidden" name="status" value="${escapeHtml(acao.status)}">` +
                `<input type="hidden" name="dia" value="${escapeHtml(o.dia)}">` +
                `<button type="submit" class="ghost" style="display:inline-block;margin:.35rem .35rem 0 0;padding:.45rem .8rem;font-size:.76rem;cursor:pointer">${escapeHtml(acao.rotulo)}</button></form>`,
            )
            .join("");
          const zap = String(a.customer_phone ?? "").replace(/\D/g, "");
          return (
            `<div class="card"><div class="row"><span class="t">${escapeHtml(fmtTime(a.starts_at, o.timezone))} · ${escapeHtml(a.customer_name ?? "Cliente")}</span>` +
            `<span class="price">${a.price_cents ? escapeHtml(money(a.price_cents)) : ""}</span></div>` +
            `<span class="d">${escapeHtml(a.service_name ?? "Atendimento")}${a.staff_name ? ` · ${escapeHtml(a.staff_name)}` : ""}</span>` +
            `<span class="d">${escapeHtml(ROTULO_STATUS[a.status] ?? a.status)}${zap ? ` · <a href="https://wa.me/55${escapeHtml(zap)}" target="_blank" rel="noopener noreferrer" style="color:var(--p)">${escapeHtml(a.customer_phone ?? "")}</a>` : ""}</span>` +
            `${acoes}</div>`
          );
        })
        .join("")
    : `<p class="empty">Nenhum agendamento neste dia.</p>`;

  return appPage({
    row: o.row,
    name: o.nome,
    canonical: `${o.canonical}painel`,
    title: `Painel — ${o.nome}`,
    description: `Agenda e caixa da ${o.nome}.`,
    body:
      `<h1>Painel</h1><p class="sub">${escapeHtml(o.papel)} · ${escapeHtml(fmtDay(`${o.dia}T12:00:00Z`, o.timezone))}</p>` +
      (o.erro ? `<p class="empty">${escapeHtml(o.erro)}</p>` : "") +
      `${kpi}${nav}${lista}` +
      `<a class="ghost" href="/sair">Sair</a>`,
  });
}


// O cliente não cria senha: informa nome e WhatsApp e o servidor abre a sessão.
// Isso basta para book_appointment, que exige auth.uid() e linha em customers.

const CAMPO =
  'style="width:100%;margin:.35rem 0 .85rem;padding:.7rem;border-radius:.7rem;border:1px solid var(--line);background:var(--surface2);color:var(--txt);font:inherit"';

function renderLogin(o: {
  row: Record<string, unknown>;
  nome: string;
  canonical: string;
  next: string;
  erro?: string;
  email?: string;
}): string {
  const erro = o.erro ? `<p class="empty">${escapeHtml(o.erro)}</p>` : "";
  return appPage({
    row: o.row,
    name: o.nome,
    canonical: `${o.canonical}entrar`,
    title: `Entrar — ${o.nome}`,
    description: `Crie sua conta na ${o.nome} com nome, telefone, e-mail e senha.`,
    nav: "conta",
    body:
      `<h1>Entrar</h1><p class="sub">Crie sua conta para agendar e ver seus horários.</p>${erro}` +
      `<form method="post" action="/entrar"><h2>Criar conta</h2><div class="card">` +
      `<label class="d" for="nome">Nome</label><input id="nome" name="nome" required maxlength="80" autocomplete="name" ${CAMPO}>` +
      `<label class="d" for="telefone">Telefone com DDD</label><input id="telefone" name="telefone" required inputmode="tel" maxlength="20" autocomplete="tel" placeholder="(11) 99999-9999" ${CAMPO}>` +
      `<label class="d" for="email">E-mail</label><input id="email" name="email" required type="email" maxlength="254" autocomplete="email" value="${escapeHtml(o.email ?? "")}" ${CAMPO}>` +
      `<label class="d" for="senha">Senha (mínimo 8 caracteres)</label><input id="senha" name="senha" required type="password" minlength="8" autocomplete="new-password" ${CAMPO.replace(".85rem", ".2rem")}>` +
      `</div><input type="hidden" name="next" value="${escapeHtml(o.next)}">` +
      `<button class="cta" type="submit">Criar conta e continuar</button></form>` +
      `<form method="post" action="/entrar/entrar"><h2>Já tenho conta</h2><div class="card">` +
      `<label class="d" for="email2">E-mail</label><input id="email2" name="email" required type="email" autocomplete="email" ${CAMPO}>` +
      `<label class="d" for="senha2">Senha</label><input id="senha2" name="senha" required type="password" autocomplete="current-password" ${CAMPO.replace(".85rem", ".2rem")}>` +
      `</div><input type="hidden" name="next" value="${escapeHtml(o.next)}">` +
      `<button class="ghost" type="submit" style="width:100%;cursor:pointer;font:inherit">Entrar</button></form>` +
      `<p class="d" style="text-align:center;color:var(--muted);font-size:.74rem">Seu telefone é usado só para a barbearia falar com você sobre o atendimento.</p>`,
  });
}

function renderConfirmed(o: {
  row: Record<string, unknown>;
  nome: string;
  canonical: string;
  timezone: string;
  appointmentId: string;
  serviceName: string;
  staffName: string;
  startsAt: string;
  confirmado: boolean;
}): string {
  const wa = whatsappLink(o.row.whatsapp_public, o.nome);
  const titulo = o.confirmado ? "Horário confirmado" : "Horário reservado";
  const aviso = o.confirmado
    ? "Está confirmado. Não precisa fazer mais nada."
    : "A barbearia ainda precisa confirmar. Se não confirmar, o horário volta a ficar livre em alguns minutos.";
  return appPage({
    row: o.row,
    name: o.nome,
    canonical: o.canonical,
    title: `${titulo} — ${o.nome}`,
    description: `Seu horário na ${o.nome}.`,
    nav: "conta",
    body:
      `<h1>${titulo}</h1><p class="sub">${escapeHtml(fmtDay(o.startsAt, o.timezone))} às ${escapeHtml(fmtTime(o.startsAt, o.timezone))}</p>` +
      `<div class="card"><div class="row"><span class="t">${escapeHtml(o.serviceName)}</span></div>` +
      `<span class="d">com ${escapeHtml(o.staffName)}</span></div>` +
      `<p class="d" style="color:var(--muted);font-size:.8rem">${escapeHtml(aviso)}</p>` +
      `<p class="d" style="color:var(--muted);font-size:.78rem">Código <code>${escapeHtml(o.appointmentId.slice(0, 8))}</code> — aparece também em Minha conta.</p>` +
      (wa ? `<a class="cta" href="${escapeHtml(wa)}" target="_blank" rel="noopener noreferrer">Avisar no WhatsApp</a>` : "") +
      `<a class="ghost" href="/conta">Ver meus agendamentos</a><a class="ghost" href="/">Voltar ao início</a>`,
  });
}

// Moeda do programa de fidelidade. O banco guarda unidade menor inteira (1 BBT = 100),
// então R$ 45,00 com 10% vira 4,50 BBT. Nunca exibir "R$" no saldo de fidelidade:
// é token da barbearia, não dinheiro em conta.
function bbt(centavos: number): string {
  const valor = (Number(centavos) || 0) / 100;
  return `${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BBT`;
}

const ROTULO_STATUS: Record<string, string> = {
  hold: "aguardando confirmação",
  pending_payment: "aguardando pagamento",
  confirmed: "confirmado",
  completed: "atendido",
  canceled: "cancelado",
  no_show: "não compareceu",
  expired: "expirado",
  payment_conflict: "pagamento em análise",
};

function renderConta(o: {
  row: Record<string, unknown>;
  nome: string;
  canonical: string;
  timezone: string;
  dados: { fullName: string | null; phone: string | null; email: string | null };
  agendamentos: Array<{
    appointment_id: string;
    starts_at: string;
    status: string;
    service_name: string | null;
    staff_name: string | null;
    price_cents: number | null;
  }>;
  cashback: { balance_cents: number; entries: Array<{ kind: string; amount_cents: number; memo: string | null; created_at: string }> };
  novo: boolean;
}): string {
  const bemVindo = o.novo
    ? `<div class="card" style="border-color:var(--p)"><div class="t">Conta criada</div><span class="d">Você já está dentro — não precisa confirmar nada por e-mail.</span></div>`
    : "";
  const saldo = Number(o.cashback.balance_cents) || 0;
  const movimentos = o.cashback.entries.length
    ? o.cashback.entries
        .slice(0, 5)
        .map(
          (e) =>
            `<div class="r"><span>${escapeHtml(e.memo ?? (e.kind === "credit" ? "cashback" : "uso de cashback"))}` +
            `<br><span class="off" style="font-size:.7rem">${escapeHtml(String(e.created_at).slice(0, 10).split("-").reverse().join("/"))}</span></span>` +
            `<span style="color:${e.kind === "credit" ? "var(--p)" : "var(--txt)"}">${e.kind === "credit" ? "+" : "−"} ${escapeHtml(bbt(e.amount_cents))}</span></div>`,
        )
        .join("")
    : `<div class="r"><span class="off">Nenhum movimento ainda</span></div>`;
  const cashbackBlock =
    `<h2>BBT — Barber Token</h2>` +
    `<div class="card"><div class="row"><span class="t">Saldo</span><span class="price">${escapeHtml(bbt(saldo))}</span></div>` +
    `<span class="d">${saldo > 0 ? "Use na próxima visita, no balcão." : "Ganhe BBT a cada atendimento concluído."}</span></div>` +
    `<div class="hours">${movimentos}</div>` +
    `<p class="d" style="color:var(--muted);font-size:.72rem;margin:.4rem 0 0">1 BBT equivale a R$ 1,00 em serviços desta barbearia. Não é dinheiro em conta e não pode ser transferido.</p>`;
  const nome = o.dados.fullName ?? "Cliente";
  const lista = o.agendamentos.length
    ? o.agendamentos
        .map(
          (a) =>
            `<div class="card"><div class="row"><span class="t">${escapeHtml(a.service_name ?? "Atendimento")}</span>` +
            `<span class="price">${a.price_cents ? escapeHtml(money(a.price_cents)) : ""}</span></div>` +
            `<span class="d">${escapeHtml(fmtDay(a.starts_at, o.timezone))} às ${escapeHtml(fmtTime(a.starts_at, o.timezone))}` +
            `${a.staff_name ? ` · ${escapeHtml(a.staff_name)}` : ""}</span>` +
            `<span class="d">${escapeHtml(ROTULO_STATUS[a.status] ?? a.status)}</span></div>`,
        )
        .join("")
    : `<p class="empty">Nenhum horário marcado ainda.</p>`;
  return appPage({
    row: o.row,
    name: o.nome,
    canonical: `${o.canonical}conta`,
    title: `Minha conta — ${o.nome}`,
    description: `Seus dados e seus horários na ${o.nome}.`,
    nav: "conta",
    body:
      `${bemVindo}<h1>Olá, ${escapeHtml(nome.split(/\s+/)[0] ?? nome)}</h1>` +
      `<p class="sub">${escapeHtml(o.dados.email ?? "")}${o.dados.phone ? ` · ${escapeHtml(o.dados.phone)}` : ""}</p>` +
      `<h2>Meus horários</h2>${lista}` +
      cashbackBlock +
      `<a class="cta" href="/agendar">Marcar outro horário</a>` +
      `<a class="ghost" href="/sair">Sair da conta</a>`,
  });
}

function renderFalha(o: { row: Record<string, unknown>; nome: string; canonical: string; mensagem: string; voltar: string }): string {
  return appPage({
    row: o.row,
    name: o.nome,
    canonical: o.canonical,
    title: `Não foi possível — ${o.nome}`,
    description: `Não foi possível concluir a reserva.`,
    nav: "agendar",
    body: `<h1>Não deu para reservar</h1><p class="empty">${escapeHtml(o.mensagem)}</p><a class="ghost" href="${escapeHtml(o.voltar)}">Escolher outro horário</a>`,
  });
}

function html(corpo: string, status = 200): Response {
  return new Response(corpo, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function POST(request: Request, context: { params: Promise<{ tenant: string; path?: string[] }> }) {
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

  const timezone = String(row.timezone ?? "America/Sao_Paulo").trim() || "America/Sao_Paulo";
  const canonical = canonicalUrl({ kind: "tenant", slug }, "/", cfg);
  const nome = String(row.display_name ?? "").trim() || slug;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return html(renderFalha({ row, nome, canonical, mensagem: "Formulário inválido.", voltar: "/agendar" }));
  }
  const texto = (chave: string) => String(form.get(chave) ?? "").trim();

  if (path?.[0] === "painel" && path[1] === "entrar" && path.length === 2) {
    const login = await loginStaff({ email: texto("email"), password: texto("senha") });
    if (!login.ok || !login.session) {
      return html(renderPainelEntrar({ row, nome, canonical, erro: "E-mail ou senha não conferem." }), 400);
    }
    const tenant = await tenantBySlug(slug);
    if (!tenant) return neutral();
    const papel = await panelRole(tenant.id, login.session.userId);
    if (!papel) {
      return html(
        renderPainelEntrar({ row, nome, canonical, erro: "Esta conta não é da equipe desta barbearia." }),
        403,
      );
    }
    const headers = new Headers({ location: "/painel" });
    for (const item of sessionHeaders(login.session)) headers.append("set-cookie", item);
    return new Response(null, { status: 303, headers });
  }

  if (path?.[0] === "painel" && path[1] === "status" && path.length === 2) {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) {
      return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    }
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(texto("dia")) ? texto("dia") : todayIn(timezone);
    const alvo = texto("status");
    const agendamento = texto("agendamento");
    const resultado = await setAppointmentStatus(userId, agendamento, alvo);
    // Cashback nasce do atendimento concluído, nunca de reserva cancelada ou falta.
    let credito = 0;
    if (resultado.ok && alvo === "completed") credito = await creditCashback(agendamento);
    const destino = `/painel?dia=${encodeURIComponent(dia)}${resultado.ok ? "" : "&erro=1"}`;
    const headers = new Headers({ location: destino });
    if (credito > 0) headers.set("x-cashback-creditado", String(credito));
    return new Response(null, { status: 303, headers });
  }

  if (path?.[0] === "entrar" && (path.length === 1 || (path[1] === "entrar" && path.length === 2))) {
    const next = texto("next");
    const padrao = path[1] === "entrar" ? "/conta" : "/conta?novo=1";
    const destino = next.startsWith("/") && !next.startsWith("//") ? next : padrao;
    const email = texto("email");
    const resultado =
      path[1] === "entrar"
        ? await entrar({ slug, email, password: texto("senha") })
        : await cadastrar({ slug, name: texto("nome"), phone: texto("telefone"), email, password: texto("senha") });
    if (!resultado.ok) {
      const mensagens: Record<string, string> = {
        dados_invalidos: "Confira nome, e-mail e senha (mínimo 8 caracteres).",
        email_em_uso: "Esse e-mail já tem conta. Use a senha dele em “Já tenho conta”.",
        senha_incorreta: "E-mail ou senha não conferem.",
        sem_supabase: "O login está indisponível agora. Fale com a barbearia no WhatsApp.",
        falha: "Não foi possível concluir agora. Tente de novo em instantes.",
      };
      const headers = new Headers({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      const pagina = renderLogin({
        row,
        nome,
        canonical,
        next: destino,
        email,
        erro: mensagens[resultado.reason] ?? "Não foi possível concluir agora.",
      });
      return new Response(pagina, { status: 400, headers });
    }
    const headers = new Headers({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store", location: destino });
    for (const item of sessionHeaders(resultado.session)) headers.append("set-cookie", item);
    return new Response(null, { status: 303, headers });
  }

  if (path?.[0] === "confirmar" && path.length === 1) {
    const serviceId = texto("servico");
    const staffId = texto("staff");
    const hora = (() => {
      const bruto = texto("hora");
      // O valor pode chegar já codificado (%3A em vez de :) quando vem de link copiado
      // à mão. Sem decodificar, o banco recusa o timestamp e o cliente vê "erro
      // genérico" sem motivo.
      try {
        return bruto.includes("%") ? decodeURIComponent(bruto) : bruto;
      } catch {
        return bruto;
      }
    })();
    const dia = texto("dia");
    const voltar = `/agendar?servico=${encodeURIComponent(serviceId)}&dia=${encodeURIComponent(dia)}`;
    const { accessToken } = readSession(request);
    if (!accessToken) {
      const headers = new Headers({ location: `/entrar?next=${encodeURIComponent(request.url ? new URL(request.url).pathname + new URL(request.url).search : voltar)}` });
      return new Response(null, { status: 303, headers });
    }
    if (!serviceId || !staffId || !dia || !hora) {
      return html(renderFalha({ row, nome, canonical, mensagem: "Escolha o serviço, o dia e o horário.", voltar: "/agendar" }));
    }
    const tenant = await tenantBySlug(slug);
    if (!tenant) return neutral();
    const resultado = await bookWithSession({
      sessionToken: accessToken,
      tenantId: tenant.id,
      staffId,
      serviceId,
      startsAt: hora,
      idempotencyKey: idempotencyKeyFor([tenant.id, staffId, serviceId, hora]),
    });
    if (!resultado.ok) {
      if (resultado.reason === "sem_sessao") {
        const headers = new Headers({ location: `/entrar?next=${encodeURIComponent(new URL(request.url).pathname)}` });
        for (const item of clearSessionHeaders()) headers.append("set-cookie", item);
        return new Response(null, { status: 303, headers });
      }
      const mensagem =
        resultado.reason === "slot_taken"
          ? "Esse horário acabou de ser pego por outra pessoa. Escolha outro."
          : resultado.reason === "not_a_customer"
            ? "Sua sessão não está ligada a esta barbearia. Entre de novo."
            : "Não foi possível reservar agora. Tente de novo em instantes.";
      return html(renderFalha({ row, nome, canonical, mensagem, voltar }));
    }
    const servicos = await listServices(slug);
    const equipe = await listStaff(slug);
    // pagamento no local: confirma na hora, senão o horário se solta em 10 minutos
    const confirmado = await confirmAppointment(resultado.appointmentId);
    const pagina = renderConfirmed({
      row,
      nome,
      canonical: `${canonical}agendar`,
      timezone,
      appointmentId: resultado.appointmentId,
      serviceName: servicos.find((item) => item.service_id === serviceId)?.name ?? "Atendimento",
      staffName: equipe.find((item) => item.staff_id === staffId)?.display_name ?? "Profissional",
      startsAt: hora,
      confirmado,
    });
    return new Response(pagina, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  return neutral();
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
  const timezone = String(row.timezone ?? "America/Sao_Paulo").trim() || "America/Sao_Paulo";
  const canonical = canonicalUrl({ kind: "tenant", slug }, "/", cfg);
  const nome = String(row.display_name ?? "").trim() || slug;
  if (path && path.length > 0) {
    if (path[0] === "painel" && path[1] === "entrar") {
      return html(renderPainelEntrar({ row, nome, canonical }));
    }
    if (path[0] === "painel" && path.length === 1) {
      const { accessToken, userId } = readSession(request);
      if (!accessToken || !userId) {
        return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
      }
      const tenant = await tenantBySlug(slug);
      if (!tenant) return neutral();
      const papel = await panelRole(tenant.id, userId);
      if (!papel) {
        // Logado, mas sem vínculo ativo com esta barbearia: não é painel dele.
        const headers = new Headers({ location: "/painel/entrar" });
        for (const item of clearSessionHeaders()) headers.append("set-cookie", item);
        return new Response(null, { status: 303, headers });
      }
      const busca = new URL(request.url).searchParams;
      const diaBruto = busca.get("dia") ?? "";
      const dia = /^\d{4}-\d{2}-\d{2}$/.test(diaBruto) ? diaBruto : todayIn(timezone);
      const { from, to } = janelaDoDia(dia, timezone);
      const [resumo, agenda] = await Promise.all([panelResumo(tenant.id, from, to), panelAgenda(tenant.id, from, to)]);
      const erro = busca.get("erro") ? "Não foi possível mudar o status desse atendimento." : undefined;
      return html(renderPainel({ row, nome, canonical, timezone, papel, dia, resumo, agenda, erro }));
    }
    if (path[0] === "sair" && path.length === 1) {
      const headers = new Headers({ location: "/" });
      for (const item of clearSessionHeaders()) headers.append("set-cookie", item);
      return new Response(null, { status: 303, headers });
    }
    if (path[0] === "conta" && path.length === 1) {
      const { accessToken, userId } = readSession(request);
      const novo = new URL(request.url).searchParams.get("novo") === "1";
      if (!accessToken || !userId) {
        const headers = new Headers({ location: "/entrar?next=%2Fconta" });
        return new Response(null, { status: 303, headers });
      }
      const tenant = await tenantBySlug(slug);
      if (!tenant) return neutral();
      const [dados, agendamentos, cashback] = await Promise.all([
        customerMe(tenant.id, userId),
        customerAppointments(tenant.id, userId),
        customerCashback(tenant.id, userId),
      ]);
      const pagina = renderConta({ row, nome, canonical, timezone, dados, agendamentos, cashback, novo });
      return new Response(pagina, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    if (path[0] === "entrar" && path.length === 1) {
      const bruto = new URL(request.url).searchParams.get("next") ?? "/agendar";
      const next = bruto.startsWith("/") && !bruto.startsWith("//") ? bruto : "/agendar";
      const pagina = renderLogin({ row, nome, canonical, next });
      return new Response(pagina, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    if (path[0] !== "agendar" || path.length > 1) return neutral();
    const pagina = await renderBooking({ request, row, slug, nome, timezone, canonical });
    return new Response(pagina, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const services = await listServices(slug);
  const name = escapeHtml(nome);
  const wa = whatsappLink(row.whatsapp_public, nome);
  const phone = String(row.phone_public ?? "").trim();
  const city = String(row.city ?? "").trim();
  const state = String(row.state ?? "").trim();
  const address = String(row.address_line ?? "").trim();
  const local = [address, [city, state].filter(Boolean).join("/")].filter(Boolean).join(" — ");
  const policy = String(row.booking_policy_text ?? "").trim();
  const cta = [
    `<a class="btn btn-primary" href="/agendar">Agendar horário</a>`,
    wa
      ? `<a class="btn btn-ghost" href="${escapeHtml(wa)}" target="_blank" rel="noopener noreferrer">Falar no WhatsApp</a>`
      : "",
    phone
      ? `<a class="btn btn-ghost" href="tel:${escapeHtml(phone.replace(/[^\d+]/g, ""))}">Ligar — ${escapeHtml(phone)}</a>`
      : "",
  ].join("");
  const pagina = renderHome({ row, slug, nome, timezone, canonical, services, staff: await listStaff(slug) });
  return new Response(pagina, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
