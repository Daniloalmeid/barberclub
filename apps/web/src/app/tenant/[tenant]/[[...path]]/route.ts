import { isReservedSlug } from "@barberclub/config/reserved";
import { isSlugShape } from "@barberclub/config/slug";
import { canonicalUrl, classifyHost, loadConfig } from "@barberclub/core";
import { forwardedHost } from "@/server/request-host";
import { escapeHtml } from "@/server/html";
import { getProduct, getTenantPublic, listFreeSlots, listProducts, listServices, listStaff, UpstreamError } from "@/server/tenant-public";
import {
  aceitarConvite,
  bookWithSession,
  cadastrar,
  clearSessionHeaders,
  confirmAppointment,
  convidarMembro,
  creditCashback,
  customerAppointments,
  customerCashback,
  customerMe,
  entrar,
  idempotencyKeyFor,
  listMembers,
  loginStaff,
  panelAgenda,
  abandonarCliente,
  addExpense,
  blockTime,
  bookForCustomer,
  cancelExpense,
  clienteDeBalcao,
  panelBlocks,
  addStaff,
  linkStaffUser,
  panelCommissions,
  panelCustomers,
  panelProducts,
  panelExpenses,
  panelFinanceiro,
  panelResultado,
  panelServices,
  panelStaff,
  panelResumo,
  setCommission,
  setProductActive,
  setProductImage,
  setTenantLogo,
  setStaffActive,
  setStaffServices,
  panelRole,
  usuarioPorEmail,
  debitCashback,
  readSession,
  recordPayment,
  upsertProduct,
  rescheduleAppointment,
  revogarMembro,
  sessionHeaders,
  subirFotoProduto,
  subirLogo,
  setAppointmentStatus,
  setDailyGoal,
  setHours,
  setServiceActive,
  unblockTime,
  tenantBySlug,
  updateBranding,
  upsertService,
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

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean.slice(0, 6);
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const um = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${um(r)}${um(g)}${um(b)}`;
}

// mistura colorida: fração 1 = alvo, 0 = cor original
function mixer(hex: string, alvo: string, fracao: number): string {
  const [r1, g1, b1] = hexToRgb(hex);
  const [r2, g2, b2] = hexToRgb(alvo);
  const f = Math.max(0, Math.min(1, fracao));
  return rgbToHex(r1 + (r2 - r1) * f, g1 + (g2 - g1) * f, b1 + (b2 - b1) * f);
}

// contraste WCAG, para decidir texto sem escolher no olho
function contraste(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = hexToRgb(hex).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const l1 = lum(a);
  const l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// Tira a saturação: fundo com a cor pura vira parede monocromática. Mantendo só uma
// lembrança do matiz, o fundo acompanha a marca sem engolir as outras duas cores.
function neutralizar(hex: string, forca: number): string {
  const [r, g, b] = hexToRgb(hex);
  const cinza = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const f = Math.max(0, Math.min(1, forca));
  return rgbToHex(r + (cinza - r) * f, g + (cinza - g) * f, b + (cinza - b) * f);
}

// Se a cor se confunde com o fundo, empurra para o lado oposto até dar leitura.
function visivelSobre(cor: string, fundo: string, alvo = 3): string {
  let atual = cor;
  const escuro = luminance(fundo) < 0.5;
  for (let passo = 0; passo < 10 && contraste(atual, fundo) < alvo; passo += 1) {
    atual = mixer(atual, escuro ? "#ffffff" : "#000000", 0.16);
  }
  return atual;
}

function themeOf(row: Record<string, unknown>): {
  primary: string;
  secondary: string;
  accent: string;
  onPrimary: string;
  bg: string;
  surface: string;
  surface2: string;
  line: string;
  txt: string;
  muted: string;
  escuro: boolean;
} {
  const pick = (value: unknown, fallback: string) => {
    const text = String(value ?? "").trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(text) ? text : fallback;
  };
  const primary = pick(row.color_primary, "#6deaed");
  const secondary = pick(row.color_secondary, "#26262b");
  const accent = pick(row.color_accent, "#9ca3af");

  // A cor secundária é o fundo da casa: o site inteiro puxa o tom dela, escuro ou claro
  // conforme a luminância escolhida. Antes --bg/--surface eram pretos fixos no código e
  // --s/--a eram definidos e nunca usados: só a principal aparecia.
  const escuro = luminance(secondary) < 0.55;
  // Escuro: fundo puxado para o preto e cartões mais claros que o fundo.
  // Claro: fundo levemente tingido pela cor e cartões mais claros que o fundo — se o
  // fundo também fosse branco, cartão e página ficavam indistinguíveis.
  const base = neutralizar(secondary, escuro ? 0.74 : 0.82);
  const bg = escuro ? mixer(base, "#000000", 0.7) : mixer(base, "#ffffff", 0.42);
  const surface = escuro ? mixer(base, "#000000", 0.56) : mixer(base, "#ffffff", 0.78);
  const surface2 = escuro ? mixer(base, "#000000", 0.44) : mixer(base, "#ffffff", 0.58);
  const line = escuro ? mixer(base, "#ffffff", 0.18) : mixer(base, "#000000", 0.18);

  return {
    primary,
    secondary,
    accent: visivelSobre(accent, bg, 3.2),
    onPrimary:
      contraste(primary, "#ffffff") >= 4.5
        ? "#ffffff"
        : contraste(primary, "#101012") >= 4.5
          ? "#101012"
          : "#000000",
    bg,
    surface,
    surface2,
    line,
    txt: escuro ? "#f4f4f5" : mixer(secondary, "#000000", 0.88),
    muted: escuro ? mixer(secondary, "#ffffff", 0.66) : mixer(secondary, "#000000", 0.55),
    escuro,
  };
}

function appCss(t: ReturnType<typeof themeOf>): string {
  return `:root{color-scheme:${t.escuro ? "dark" : "light"};--p:${t.primary};--s:${t.secondary};--a:${t.accent};--on:${t.onPrimary};
--bg:${t.bg};--surface:${t.surface};--surface2:${t.surface2};--line:${t.line};--txt:${t.txt};--muted:${t.muted}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.55;padding-bottom:5.5rem;-webkit-font-smoothing:antialiased}
.wrap{width:100%;max-width:34rem;margin:0 auto;padding:0 1rem}
header{position:sticky;top:0;z-index:10;background:${t.bg}f2;border-bottom:2px solid var(--p);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
header .wrap{display:flex;align-items:center;gap:.65rem;padding:.85rem 1rem}
.logo{width:2.25rem;height:2.25rem;border-radius:.65rem;object-fit:contain;background:var(--surface2);color:var(--p);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.85rem;border:1px solid var(--line)}
header .name{font-weight:650;letter-spacing:-.01em;font-size:.98rem}
header .city{font-size:.72rem;color:var(--muted)}
main{padding:1.1rem 0 2rem}
h1{font-size:1.55rem;font-weight:700;letter-spacing:-.025em;margin:0 0 .25rem}
.sub{color:var(--muted);font-size:.88rem;margin:0}
h2{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.16em;color:var(--a);margin:1.6rem 0 .6rem}
.card{display:block;background:var(--surface);border:1px solid var(--line);border-radius:1rem;padding:.9rem 1rem;text-decoration:none;color:inherit;margin-bottom:.55rem}
.card:active{border-color:var(--p)}
.card .row{display:flex;justify-content:space-between;gap:.75rem;align-items:baseline}
.card .t{font-weight:600;font-size:.95rem}
.card .d{color:var(--muted);font-size:.78rem;margin-top:.15rem}
.card .price{font-weight:700;white-space:nowrap;color:var(--p)}
.cta{display:block;text-align:center;text-decoration:none;background:var(--p);color:var(--on);font-weight:700;font-size:.95rem;padding:.9rem 1rem;border-radius:.9rem;margin:1rem 0 .5rem}
.ghost{display:block;text-align:center;text-decoration:none;border:1px solid var(--line);background:var(--surface);color:var(--txt);font-weight:500;font-size:.88rem;padding:.8rem 1rem;border-radius:.9rem;margin:.5rem 0}
.prods{display:grid;grid-template-columns:repeat(2,1fr);gap:.7rem;margin-top:.6rem}
.prod{display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--line);border-radius:1rem;overflow:hidden;text-decoration:none;color:inherit}
.prod-media{position:relative;display:grid;place-items:center;height:8.6rem;padding:.55rem;background:linear-gradient(145deg,var(--p),var(--s));}
.prod-media.tem-foto{background:var(--surface2);padding:.6rem}
.prod-media img{max-height:100%;max-width:100%;width:auto;height:auto;object-fit:contain;border-radius:.45rem}
.prod-ini{font-weight:800;font-size:1.15rem;letter-spacing:.06em;color:var(--on);opacity:.92}
.prod-off{position:absolute;top:.45rem;left:.45rem;background:var(--a);color:#101012;font-size:.6rem;font-weight:800;padding:.16rem .38rem;border-radius:.4rem}
.prod-body{display:flex;flex-direction:column;gap:.22rem;padding:.6rem .7rem .7rem;flex:1}
.prod-cat{font-size:.6rem;text-transform:uppercase;letter-spacing:.1em;color:var(--a);font-weight:800}
.prod-tit{font-size:.82rem;font-weight:650;line-height:1.25;margin:0}
.prod-desc{font-size:.68rem;color:var(--muted);line-height:1.3;margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.prod-preco{display:flex;align-items:baseline;gap:.3rem;flex-wrap:wrap;margin-top:auto}
.prod-preco .agora{font-weight:800;font-size:.88rem;color:var(--p)}
.prod-preco .antes{font-size:.66rem;color:var(--muted);text-decoration:line-through}
.prod-btn{display:block;text-align:center;text-decoration:none;background:var(--p);color:var(--on);font-weight:700;font-size:.72rem;padding:.5rem;border-radius:.6rem;margin-top:.4rem}
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
nav.tabs{position:fixed;bottom:0;left:0;right:0;z-index:20;background:var(--surface);backdrop-filter:blur(8px);border-top:1px solid var(--line);display:flex;padding-bottom:env(safe-area-inset-bottom)}
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


// Reduz a foto no proprio celular antes de enviar. Foto de celular tem 3-6 MB, e o
// servidor recusava por tamanho — o dono via "nao foi possivel salvar" e nao entendia.
// Aqui o canvas reencoda em JPEG de no maximo 1200px: sobe ~150 KB, abre rapido no 4G.
// Se o navegador nao souber decodificar (formato estranho), o envio segue pelo caminho
// normal e a validacao do servidor decide.
const REDUTOR = `
for (const f of document.querySelectorAll("form[data-redimensionar]")) {
  f.addEventListener("submit", async (evento) => {
    const campo = f.querySelector('input[type="file"]');
    if (!campo || !campo.files || !campo.files[0]) return;
    evento.preventDefault();
    const botao = f.querySelector("button");
    if (botao) { botao.disabled = true; botao.textContent = "Enviando..."; }
    const arquivo = campo.files[0];
    try {
      const limite = Number(f.dataset.redimensionar) || 1200;
      const bitmap = await createImageBitmap(arquivo);
      const escala = Math.min(1, limite / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * escala));
      canvas.height = Math.max(1, Math.round(bitmap.height * escala));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", 0.86));
      if (!blob) throw new Error("sem blob");
      const dados = new FormData(f);
      dados.set(campo.name, new File([blob], "foto.jpg", { type: "image/jpeg" }), "foto.jpg");
      const resposta = await fetch(f.action, { method: "POST", body: dados, redirect: "follow" });
      window.location.href = resposta.url || f.action;
    } catch (erro) {
      f.submit();
    }
  });
}
`;

type Crumb = { label: string; href: string };

function appPage(options: {
  row: Record<string, unknown>;
  name: string;
  canonical: string;
  title: string;
  description: string;
  body: string;
  nav?: "inicio" | "agendar" | "produtos" | "conta";
  // "painel" troca a barra de baixo: quem trabalha na barbearia não deve ser levado
  // para a área do cliente ao tocar em Início.
  shell?: "cliente" | "painel";
  crumbs?: Crumb[];
  // Script inline exige o nonce da CSP (script-src 'self' 'nonce-...'). Sem ele o
  // navegador bloqueia e o upload grande volta a falhar em silêncio.
  script?: string;
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
  const nav = (key: "inicio" | "agendar" | "produtos" | "conta", label: string, icon: string, href: string) =>
    `<a class="${options.nav === key ? "on" : ""}" href="${escapeHtml(href)}"><span class="ico">${icon}</span>${label}</a>`;
  const abas =
    options.shell === "painel"
      ? `<a class="on" href="/painel"><span class="ico">▤</span>Painel</a>` +
        `<a href="/painel/agenda"><span class="ico">◷</span>Agenda</a>` +
        `<a href="/painel/clientes"><span class="ico">☺</span>Clientes</a>` +
        `<a href="/painel/equipe"><span class="ico">☰</span>Equipe</a>` +
        `<a href="/painel/financeiro"><span class="ico">$</span>Caixa</a>`
      : `${nav("inicio", "Início", "⌂", "/")}${nav("agendar", "Agendar", "◷", "/agendar")}${nav("produtos", "Produtos", "🛍", "/produtos")}${nav("conta", "Conta", "☺", "/conta")}`;
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="${escapeHtml(theme.primary)}"><title>${escapeHtml(options.title)}</title><meta name="description" content="${escapeHtml(options.description)}"><link rel="canonical" href="${escapeHtml(options.canonical)}"><style>${appCss(theme)}</style></head><body><header><div class="wrap">${logoHtml}<span><span class="name">${escapeHtml(options.name)}</span>${city ? `<br><span class="city">${escapeHtml(city)}</span>` : ""}</span></div></header><main><div class="wrap">${options.body}</div></main><nav class="tabs">${abas}</nav><footer><div class="wrap">Feito com <a href="https://barber.workloop.com.br">BarberClub</a></div></footer>${options.script ?? ""}</body></html>`;
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
  produtos: Awaited<ReturnType<typeof listProducts>>;
  // Quem trabalha na barbearia precisa de um caminho de volta ao painel; sem isso,
  // logado como dono, a home o trata como cliente e ele fica sem porta de entrada.
  papel?: string | null;
}): string {
  const atalhoPainel = o.papel
    ? `<a class="card" href="/painel" style="border-color:var(--p)"><div class="row"><span class="t">Painel da barbearia</span><span class="price">→</span></div><span class="d">Agenda do dia, caixa e ações — você entra como ${escapeHtml(o.papel)}</span></a>`
    : "";
  const address = String(o.row.address_line ?? "").trim();
  const city = String(o.row.city ?? "").trim();
  const state = String(o.row.state ?? "").trim();
  const local = [address, [city, state].filter(Boolean).join("/")].filter(Boolean).join(" — ");
  const wa = whatsappLink(o.row.whatsapp_public, o.nome);
  const insta = String(o.row.instagram_handle ?? "").replace(/^@/, "").trim();
  const tel = String(o.row.phone_public ?? "").trim();
  const instaLinha = insta
    ? `<div class="r"><span>Instagram</span><span><a href="https://instagram.com/${encodeURIComponent(insta)}" target="_blank" rel="noopener noreferrer" style="color:var(--p);text-decoration:none">@${escapeHtml(insta)}</a></span></div>`
    : "";
  const telLinha = tel
    ? `<div class="r"><span>Telefone</span><span><a href="tel:${escapeHtml(tel.replace(/[^\d+]/g, ""))}" style="color:var(--p);text-decoration:none">${escapeHtml(tel)}</a></span></div>`
    : "";
  const localLinha = local ? `<div class="r"><span>Endereço</span><span style="text-align:right;max-width:60%">${escapeHtml(local)}</span></div>` : "";
  const contato =
    instaLinha || telLinha || localLinha
      ? `<h2>Contato</h2><div class="hours">${localLinha}${telLinha}${instaLinha}</div>`
      : "";
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
        .map(
          (member) =>
            `<a class="who" href="/agendar?profissional=${encodeURIComponent(member.staff_id)}" style="text-decoration:none;color:inherit"><div class="avatar">${escapeHtml(initials(member.display_name))}</div>${escapeHtml(member.display_name)}</a>`,
        )
        .join("")}</div>`
    : "";
  const body = `<h1>${escapeHtml(o.nome)}</h1>${local ? `<p class="sub">${escapeHtml(local)}</p>` : ""}${atalhoPainel}<a class="cta" href="/agendar">Agendar horário</a>${wa ? `<a class="ghost" href="${escapeHtml(wa)}" target="_blank" rel="noopener noreferrer">Falar no WhatsApp</a>` : ""}${contato}` +
    (o.produtos.length
      ? `<a class="card" href="/produtos" style="border-color:var(--p)"><div class="row"><span class="t">Produtos da barbearia</span><span class="price">${o.produtos.length} →</span></div><span class="d">Pomadas, óleo de barba, presentes</span></a>`
      : "") +
    `<h2>Serviços</h2>${cards}${team}${hoursApp(o.row.opening_hours)}`;
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
  // "" = ainda não escolheu · "todos" = sem preferência · id = profissional escolhido
  const profissional = (params.get("profissional") ?? "").trim();
  const services = await listServices(o.slug);
  const equipe = await listStaff(o.slug);
  const nomeDe = new Map(equipe.map((item) => [item.staff_id, item.display_name]));
  const primeiroNome = new Map(equipe.map((item) => [item.staff_id, item.display_name.split(/\s+/)[0] ?? item.display_name]));
  const base = {
    row: o.row,
    name: o.nome,
    canonical: `${o.canonical}agendar`,
    title: `Agendar — ${o.nome}`,
    description: `Escolha serviço, profissional e horário na ${o.nome}.`,
    nav: "agendar" as const,
  };
  const qp = (extra: Record<string, string>) => {
    const q = new URLSearchParams(extra);
    return `/agendar?${q.toString()}`;
  };

  if (!services.length) {
    return appPage({ ...base, body: `<h1>Agendar</h1><p class="empty">Os serviços estão sendo cadastrados. Fale com a barbearia para marcar.</p>` });
  }

  const service = services.find((item) => item.service_id === servico);

  // Passo 1 — serviço. Se já veio um profissional, só mostra o que ele faz.
  if (!service) {
    const doProfissional =
      profissional && profissional !== "todos"
        ? equipe.find((item) => item.staff_id === profissional)?.service_ids ?? []
        : null;
    const lista = services.filter((item) => !doProfissional || doProfissional.includes(item.service_id));
    const cartoes = lista
      .map(
        (item) =>
          `<a class="card" href="${qp(profissional ? { servico: item.service_id, profissional } : { servico: item.service_id })}"><div class="row"><span class="t">${escapeHtml(item.name)}</span><span class="price">${escapeHtml(money(item.price_cents))}</span></div><span class="d">${Number(item.duration_min)} min</span></a>`,
      )
      .join("");
    const quem = profissional && profissional !== "todos" ? `${nomeDe.get(profissional) ?? ""} · ` : "";
    return appPage({
      ...base,
      body: `<h1>Escolha o serviço</h1><p class="sub">${escapeHtml(quem)}Passo 1 de 3</p>${cartoes}`,
    });
  }

  const serviceLabel = escapeHtml(service.name);

  // Passo 2 — profissional. "Sem preferência" vem primeiro: a maioria só quer cortar.
  if (!profissional) {
    const candidatos = equipe.filter((item) => item.service_ids.includes(service.service_id));
    if (!candidatos.length) {
      // Ninguém marcado para este serviço: oferecer "sem preferência" seria mentir e o
      // cliente só descobriria no fim, ao confirmar.
      return appPage({
        ...base,
        body:
          `<h1>${serviceLabel}</h1><p class="empty">Nenhum profissional está marcado para este serviço. Fale com a barbearia para marcar.</p>` +
          `<a class="ghost" href="/agendar">Escolher outro serviço</a>`,
      });
    }
    const cards =
      `<a class="card" href="${qp({ servico: service.service_id, profissional: "todos" })}" style="border-color:var(--p)">` +
      `<div class="row"><span class="t">Sem preferência</span><span class="price">→</span></div>` +
      `<span class="d">O primeiro horário livre, com qualquer profissional</span></a>` +
      candidatos
        .map(
          (item) =>
            `<a class="card" href="${qp({ servico: service.service_id, profissional: item.staff_id })}"><div class="row"><span class="t">${escapeHtml(item.display_name)}</span><span class="price">→</span></div><span class="d">Ver só os horários dele</span></a>`,
        )
        .join("");
    return appPage({
      ...base,
      body: `<h1>${serviceLabel}</h1><p class="sub">Passo 2 de 3 · com quem?</p>${cards}`,
    });
  }

  const staffFiltro = profissional === "todos" ? undefined : profissional;
  const staffLabel = profissional === "todos" ? "" : ` · ${nomeDe.get(profissional) ?? ""}`;
  const voltarProf = `<a class="ghost" href="${qp({ servico: service.service_id })}">Trocar profissional</a>`;

  // Confirmação do horário escolhido.
  if (hora) {
    const slots = await listFreeSlots(o.slug, service.service_id, dia, staffFiltro);
    const staffId = (params.get("staff") ?? "").trim();
    const chosen = slots.find((slot) => slot.starts_at === hora && (!staffId || slot.staff_id === staffId));
    const label = chosen ? fmtTime(chosen.starts_at, o.timezone) : hora.slice(11, 16);
    const quem = chosen ? (primeiroNome.get(chosen.staff_id) ?? "") : "";
    const dayLabel = fmtDay(`${dia}T12:00:00Z`, o.timezone);
    const next = qp({
      servico: service.service_id,
      profissional,
      dia,
      hora,
      staff: chosen?.staff_id ?? staffId,
    });
    const { accessToken } = readSession(o.request);
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
        `<h1>${serviceLabel}</h1><p class="sub">Passo 3 de 3 · ${escapeHtml(dayLabel)} às ${escapeHtml(label)}${quem ? ` · ${escapeHtml(quem)}` : ""}</p>` +
        `<div class="card"><div class="row"><span class="t">${escapeHtml(service.name)}</span><span class="price">${escapeHtml(money(service.price_cents))}</span></div><span class="d">${Number(service.duration_min)} min</span></div>` +
        acao +
        `<a class="ghost" href="${qp({ servico: service.service_id, profissional, dia })}">Escolher outro horário</a>`,
    });
  }

  // Passo 3 — dia e horário na mesma tela: escolher o dia primeiro e só então ver as horas
  // é um toque a mais para quem já escolheu serviço e profissional.
  const dias = nextDays(todayIn(o.timezone), 14);
  let alvo = /^\d{4}-\d{2}-\d{2}$/.test(dia) && dias.includes(dia) ? dia : "";
  let slots: Awaited<ReturnType<typeof listFreeSlots>> = [];
  if (alvo) {
    slots = await listFreeSlots(o.slug, service.service_id, alvo, staffFiltro);
  } else {
    // Sem dia escolhido: mostra o primeiro dia que tenha horário, no máximo 7 à frente.
    for (const candidato of dias.slice(0, 7)) {
      const livres = await listFreeSlots(o.slug, service.service_id, candidato, staffFiltro);
      if (livres.length) {
        alvo = candidato;
        slots = livres;
        break;
      }
    }
  }

  const strip = dias
    .map((day) => {
      const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
      return `<a class="${day === alvo ? "on" : ""}" href="${qp({ servico: service.service_id, profissional, dia: day })}">${escapeHtml(DIAS[weekday])}<br>${day.slice(8, 10)}/${day.slice(5, 7)}</a>`;
    })
    .join("");

  const grid = slots.length
    ? slots
        .map((slot) => {
          const quem = primeiroNome.get(slot.staff_id) ?? "";
          return `<a href="${qp({ servico: service.service_id, profissional, dia: alvo, hora: slot.starts_at, staff: slot.staff_id })}">${escapeHtml(fmtTime(slot.starts_at, o.timezone))}${quem ? `<br><span style="font-size:.6rem;opacity:.65">${escapeHtml(quem)}</span>` : ""}</a>`;
        })
        .join("")
    : "";

  const diaLabel = alvo ? fmtDay(`${alvo}T12:00:00Z`, o.timezone) : "";
  const corpo = grid
    ? `<h2>${escapeHtml(diaLabel)}</h2><div class="slots">${grid}</div>`
    : `<p class="empty">${alvo ? `Nenhum horário livre em ${escapeHtml(diaLabel)}.` : "Nenhum horário livre nos próximos dias."} Escolha outro dia.</p>`;

  return appPage({
    ...base,
    body:
      `<h1>${serviceLabel}</h1><p class="sub">Passo 3 de 3 · escolha o dia e a hora${escapeHtml(staffLabel)}</p>` +
      `<div class="days" style="grid-template-columns:repeat(4,1fr);margin-bottom:.8rem">${strip}</div>` +
      corpo +
      voltarProf,
  });
}

function renderEquipe(o: {
  row: Record<string, unknown>;
  nome: string;
  canonical: string;
  papel: string;
  membros: Array<{ user_id: string; email: string; full_name: string | null; role: string; status: string }>;
  comissoes?: Array<{ staff_id: string; staff_name: string; commission_bps: number; atendimentos: number; base_cents: number; comissao_cents: number }>;
  profissionais?: Array<{ staff_id: string; display_name: string; active: boolean; commission_bps: number; access_email: string | null; access_role: string | null; service_ids?: string[] | null }>;
  servicos?: Array<{ service_id: string; name: string }>;
  link?: string;
  ok?: string;
  erro?: string;
}): string {
  const erro = o.erro ? `<p class="empty">${escapeHtml(o.erro)}</p>` : "";
  const caixaLink = o.link
    ? `<div class="card" style="border-color:var(--p)"><div class="t">Convite criado</div>` +
      `<span class="d">Mande este link para a pessoa. Ela define a senha e entra. Vale 7 dias, uma vez só.</span>` +
      `<p style="word-break:break-all;font-size:.78rem;color:var(--p);margin:.5rem 0">${escapeHtml(o.link)}</p>` +
      `<a class="ghost" href="https://wa.me/?text=${encodeURIComponent(`Acesso ao painel da ${o.nome}: ${o.link}`)}" target="_blank" rel="noopener noreferrer">Mandar no WhatsApp</a></div>`
    : "";

  // Profissionais (quem atende) e acessos (quem entra no painel) são coisas diferentes.
  // Antes esta tela só listava logins, e o dono não encontrava os barbeiros.
  const comissaoDe = (staffId: string) => o.comissoes?.find((c) => c.staff_id === staffId);
  const profissionaisBloco =
    `<h2>Profissionais</h2><p class="d" style="color:var(--muted);font-size:.72rem;margin:0 0 .4rem">Quem atende. Comissão sobre o preço do serviço nos atendimentos concluídos do mês.</p>` +
    (o.profissionais ?? [])
      .map((st) => {
        const c = comissaoDe(st.staff_id);
        const acesso = st.access_email
          ? `${escapeHtml(st.access_email)}${st.access_role ? ` · ${escapeHtml(st.access_role)}` : ""}`
          : "sem acesso ao painel";
        const campos =
          `<form method="post" action="/painel/comissao" style="margin-top:.45rem">` +
          `<input type="hidden" name="profissional" value="${escapeHtml(st.staff_id)}">` +
          `<label class="d" for="pc_${st.staff_id}">Comissão (%)</label>` +
          `<input id="pc_${st.staff_id}" name="percentual" inputmode="decimal" value="${(Number(st.commission_bps) / 100).toFixed(2).replace(".", ",")}" style="width:100%;margin:.2rem 0 .4rem;padding:.5rem;border-radius:.6rem;border:1px solid var(--line);background:var(--surface2);color:var(--txt);font:inherit;font-size:.85rem">` +
          `<button type="submit" class="ghost" style="width:100%;padding:.4rem;font-size:.76rem;cursor:pointer;margin:0">Salvar percentual</button></form>` +
          `<form method="post" action="/painel/equipe/profissional" style="margin-top:.35rem">` +
          `<input type="hidden" name="profissional" value="${escapeHtml(st.staff_id)}">` +
          `<input type="hidden" name="ativo" value="${st.active ? "0" : "1"}">` +
          `<button type="submit" class="ghost" style="width:100%;padding:.4rem;font-size:.76rem;cursor:pointer;margin:0">${st.active ? "Desativar (sai da agenda)" : "Reativar na agenda"}</button></form>` +
          `<details style="margin-top:.35rem"><summary class="d" style="cursor:pointer">Serviços que ele faz (${(st.service_ids ?? []).length})</summary>` +
          `<form method="post" action="/painel/equipe/servicos" style="margin-top:.4rem">` +
          `<input type="hidden" name="profissional" value="${escapeHtml(st.staff_id)}">` +
          (o.servicos ?? [])
            .map(
              (sv) =>
                `<label class="d" style="display:flex;gap:.45rem;align-items:center;margin:.25rem 0;font-size:.8rem">` +
                `<input type="checkbox" name="servico" value="${escapeHtml(sv.service_id)}"${(st.service_ids ?? []).includes(sv.service_id) ? " checked" : ""} style="width:1.05rem;height:1.05rem;accent-color:var(--p)">` +
                `${escapeHtml(sv.name)}</label>`,
            )
            .join("") +
          `<button type="submit" class="ghost" style="width:100%;padding:.4rem;font-size:.76rem;cursor:pointer;margin:.35rem 0 0">Salvar serviços</button></form>` +
          `<p class="d" style="color:var(--muted);font-size:.68rem;margin:.25rem 0 0">Serviço desmarcado deixa de ser oferecido com ele no agendamento.</p></details>` +
          (st.access_email
            ? ""
            : `<details style="margin-top:.35rem"><summary class="d" style="cursor:pointer">Dar acesso ao painel</summary>` +
              `<form method="post" action="/painel/equipe/acesso" style="margin-top:.4rem">` +
              `<input type="hidden" name="profissional" value="${escapeHtml(st.staff_id)}">` +
              `<label class="d" for="ae_${st.staff_id}">E-mail do profissional</label>` +
              `<input id="ae_${st.staff_id}" name="email" type="email" required style="width:100%;margin:.2rem 0 .4rem;padding:.5rem;border-radius:.6rem;border:1px solid var(--line);background:var(--surface2);color:var(--txt);font:inherit;font-size:.85rem">` +
              `<input type="hidden" name="papel" value="staff">` +
              `<button type="submit" class="ghost" style="width:100%;padding:.4rem;font-size:.76rem;cursor:pointer;margin:0">Gerar convite</button></form></details>`);
        return (
          `<div class="card"><div class="row"><span class="t">${escapeHtml(st.display_name)}</span>` +
          `<span class="price">${st.active ? "" : "inativo"}</span></div>` +
          `<span class="d">${escapeHtml(acesso)}</span>` +
          (c ? `<span class="d">${Number(c.atendimentos) || 0} atendimentos · base ${escapeHtml(money(c.base_cents))} · ${escapeHtml(money(c.comissao_cents))}</span>` : "") +
          campos +
          `</div>`
        );
      })
      .join("") +
    `<details class="card"><summary style="cursor:pointer;font-weight:600">+ Adicionar profissional</summary>` +
    `<form method="post" action="/painel/equipe/novo" style="margin-top:.5rem">` +
    `<label class="d" for="np2">Nome</label><input id="np2" name="nome" required maxlength=60 style="width:100%;margin:.2rem 0 .5rem;padding:.55rem;border-radius:.6rem;border:1px solid var(--line);background:var(--surface2);color:var(--txt);font:inherit">` +
    `<label class="d" for="nc2">Comissão (%)</label><input id="nc2" name="percentual" inputmode="decimal" value="0" style="width:100%;margin:.2rem 0 .5rem;padding:.55rem;border-radius:.6rem;border:1px solid var(--line);background:var(--surface2);color:var(--txt);font:inherit">` +
    `<span class="d">O que ele faz:</span>` +
    (o.servicos ?? [])
      .map(
        (sv) =>
          `<label class="d" style="display:flex;gap:.45rem;align-items:center;margin:.25rem 0;font-size:.8rem">` +
          `<input type="checkbox" name="servico" value="${escapeHtml(sv.service_id)}" checked style="width:1.05rem;height:1.05rem;accent-color:var(--p)">` +
          `${escapeHtml(sv.name)}</label>`,
      )
      .join("") +
    `<button type="submit" class="cta" style="margin:.5rem 0 0">Adicionar</button></form></details>`;

  const lista = o.membros.length
    ? o.membros
        .map(
          (m) =>
            `<div class="card"><div class="row"><span class="t">${escapeHtml(m.full_name ?? m.email)}</span>` +
            `<span class="price">${escapeHtml(m.role)}</span></div>` +
            `<span class="d">${escapeHtml(m.email)} · ${escapeHtml(m.status)}</span>` +
            (m.status === "active" && m.role !== "owner"
              ? `<form method="post" action="/painel/equipe/revogar" style="display:inline"><input type="hidden" name="membro" value="${escapeHtml(m.user_id)}">` +
                `<button type="submit" class="ghost" style="display:inline-block;margin:.35rem .35rem 0 0;padding:.4rem .75rem;font-size:.74rem;cursor:pointer">Revogar acesso</button></form>`
              : "") +
            `</div>`,
        )
        .join("")
    : `<p class="empty">Ninguém além de você.</p>`;
  return appPage({
    row: o.row,
    name: o.nome,
    canonical: `${o.canonical}painel`,
    title: `Equipe — ${o.nome}`,
    description: `Quem tem acesso ao painel da ${o.nome}.`,
    shell: "painel" as const,
    body:
      `<h1>Equipe</h1><p class="sub">Quem trabalha aqui · você é ${escapeHtml(o.papel)}</p>${erro}${caixaLink}` +
      profissionaisBloco +
      `<h2>Quem tem acesso ao painel</h2>${lista}` +
      `<h2>Convidar</h2><form method="post" action="/painel/equipe/convidar"><div class="card">` +
      `<label class="d" for="nome2">Nome</label><input id="nome2" name="nome" required maxlength="80" ${CAMPO}>` +
      `<label class="d" for="email3">E-mail</label><input id="email3" name="email" required type="email" maxlength="254" ${CAMPO}>` +
      `<label class="d" for="papel">Papel</label><select id="papel" name="papel" ${CAMPO}>` +
      `<option value="staff">Barbeiro — só os próprios atendimentos</option>` +
      `<option value="manager">Gerente — agenda e equipe</option>` +
      `<option value="owner">Dono — tudo</option></select>` +
      `</div><button class="cta" type="submit">Gerar link de convite</button></form>` +
      `<a class="ghost" href="/painel">Voltar para a agenda</a>`,
  });
}

function renderConvite(o: { row: Record<string, unknown>; nome: string; canonical: string; code: string; erro?: string }): string {
  const erro = o.erro ? `<p class="empty">${escapeHtml(o.erro)}</p>` : "";
  return appPage({
    row: o.row,
    name: o.nome,
    canonical: `${o.canonical}painel`,
    title: `Convite — ${o.nome}`,
    description: `Defina sua senha para acessar o painel da ${o.nome}.`,
    body:
      `<h1>Você foi convidado</h1><p class="sub">Defina sua senha para entrar no painel da ${escapeHtml(o.nome)}.</p>${erro}` +
      `<form method="post" action="/painel/convite"><div class="card">` +
      `<input type="hidden" name="c" value="${escapeHtml(o.code)}">` +
      `<label class="d" for="s1">Senha (mínimo 8 caracteres)</label><input id="s1" name="senha" required type="password" minlength="8" autocomplete="new-password" ${CAMPO}>` +
      `<label class="d" for="s2">Repita a senha</label><input id="s2" name="senha2" required type="password" minlength="8" autocomplete="new-password" ${CAMPO.replace(".85rem", ".2rem")}>` +
      `</div><button class="cta" type="submit">Entrar no painel</button></form>`,
  });
}

// Visão geral: a porta do painel. Responde "como está hoje" e leva a cada módulo.
function renderVisaoGeral(o: {
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
    service_name: string | null;
    staff_name: string | null;
    price_cents: number | null;
  }>;
  clientes: number;
  sumidos: number;
}): string {
  const hoje = todayIn(o.timezone);
  const proximos = o.agenda
    .filter((a) => a.status === "confirmed" || a.status === "hold")
    .slice(0, 3)
    .map(
      (a) =>
        `<div class="r"><span>${escapeHtml(fmtTime(a.starts_at, o.timezone))} · ${escapeHtml(a.customer_name ?? "Cliente")}` +
        `<br><span class="off" style="font-size:.7rem">${escapeHtml(a.service_name ?? "Atendimento")}${a.staff_name ? ` · ${escapeHtml(a.staff_name)}` : ""}</span></span>` +
        `<span>${a.price_cents ? escapeHtml(money(a.price_cents)) : ""}</span></div>`,
    )
    .join("");

  const modulo = (href: string, titulo: string, desc: string, badge?: string) =>
    `<a class="card" href="${escapeHtml(href)}"><div class="row"><span class="t">${escapeHtml(titulo)}</span>` +
    `<span class="price">${escapeHtml(badge ?? "→")}</span></div><span class="d">${escapeHtml(desc)}</span></a>`;


  return appPage({
    row: o.row,
    name: o.nome,
    canonical: `${o.canonical}painel`,
    title: `Painel — ${o.nome}`,
    description: `Visão geral da ${o.nome}.`,
    shell: "painel" as const,
    body:
      `<h1>Olá, ${escapeHtml(o.papel)}</h1><p class="sub">${escapeHtml(fmtDay(`${hoje}T12:00:00Z`, o.timezone))}</p>` +
      `<div class="hours" style="margin:.75rem 0">` +
      `<div class="r"><span>Agendamentos hoje</span><span><strong>${Number(o.resumo.total) || 0}</strong></span></div>` +
      `<div class="r"><span>Confirmados</span><span>${Number(o.resumo.confirmados) || 0}</span></div>` +
      `<div class="r"><span>Concluídos</span><span>${Number(o.resumo.concluidos) || 0}</span></div>` +
      `<div class="r"><span>Previsto em caixa</span><span class="price" style="color:var(--p)">${escapeHtml(money(o.resumo.faturamento_cents))}</span></div>` +
      `</div>` +
      (proximos ? `<h2>Próximos de hoje</h2><div class="hours">${proximos}</div>` : "") +
      `<h2>Módulos</h2>` +
      modulo("/painel/agenda", "Agenda", "Dia a dia, escolher data, confirmar e concluir") +
      modulo("/painel/clientes", "Clientes", `Histórico, ticket médio e quem parou de voltar`, String(o.clientes)) +
      modulo("/painel/equipe", "Equipe", "Quem tem acesso ao painel e com que papel") +
      modulo("/painel/financeiro", "Caixa", "Quanto entrou de verdade e a meta do dia") +
      modulo("/painel/despesas", "Despesas", "O que saiu este mês e o que sobrou") +
      modulo("/painel/barbearia", "Minha barbearia", "Nome, contato, cores e horários") +
      modulo("/painel/servicos", "Serviços", "Preços e duração do que você vende") +
      modulo("/painel/produtos", "Produtos", "A vitrine que o cliente vê no app") +
      (o.sumidos > 0
        ? `<a class="card" href="/painel/clientes?filtro=sumidos" style="border-color:var(--p)"><div class="row"><span class="t">Clientes sumidos</span><span class="price">${o.sumidos}</span></div><span class="d">Sem voltar há 45 dias ou mais — hora de chamar</span></a>`
        : "") +
      `<a class="ghost" href="/">Ver o site da barbearia</a><a class="ghost" href="/sair">Sair</a>`,
  });
}

// Clientes: o histórico que o barbeiro usa para decidir quem chamar.
function renderClientes(o: {
  row: Record<string, unknown>;
  nome: string;
  canonical: string;
  timezone: string;
  papel: string;
  busca: string;
  filtro: string;
  clientes: Array<{
    customer_id: string;
    nome: string | null;
    telefone: string | null;
    visitas: number;
    ultima_visita: string | null;
    total_cents: number;
    ticket_medio_cents: number;
    dias_sem_voltar: number | null;
  }>;
}): string {
  const semVoltar = (dias: number | null) => {
    if (dias === null) return "nunca veio";
    if (dias <= 0) return "atendimento futuro";
    return `há ${dias} dia${dias === 1 ? "" : "s"}`;
  };
  const lista = o.clientes.length
    ? o.clientes
        .map((c) => {
          const zap = String(c.telefone ?? "").replace(/\D/g, "");
          const alerta = c.dias_sem_voltar !== null && c.dias_sem_voltar >= 45;
          return (
            `<div class="card"${alerta ? ' style="border-color:var(--p)"' : ""}>` +
            `<div class="row"><span class="t">${escapeHtml(c.nome ?? "Cliente")}</span>` +
            `<span class="price">${Number(c.visitas) || 0} visita${Number(c.visitas) === 1 ? "" : "s"}</span></div>` +
            `<span class="d">${zap ? `<a href="https://wa.me/55${escapeHtml(zap)}" target="_blank" rel="noopener noreferrer" style="color:var(--p)">${escapeHtml(c.telefone ?? "")}</a> · ` : ""}` +
            `ticket ${escapeHtml(money(c.ticket_medio_cents))} · ${escapeHtml(semVoltar(c.dias_sem_voltar))}</span></div>`
          );
        })
        .join("")
    : `<p class="empty">${o.busca ? "Nenhum cliente com esse nome ou telefone." : "Nenhum cliente ainda."}</p>`;

  return appPage({
    row: o.row,
    name: o.nome,
    canonical: `${o.canonical}painel/clientes`,
    title: `Clientes — ${o.nome}`,
    description: `Clientes da ${o.nome}.`,
    shell: "painel" as const,
    body:
      `<h1>Clientes</h1><p class="sub">${o.clientes.length} na lista${o.busca ? ` · busca “${escapeHtml(o.busca)}”` : ""}</p>` +
      `<form method="get" action="/painel/clientes" style="display:flex;gap:.5rem;margin:.75rem 0">` +
      `<input name="q" value="${escapeHtml(o.busca)}" placeholder="nome ou telefone" aria-label="Buscar cliente" style="flex:1;min-width:0;padding:.65rem;border-radius:.7rem;border:1px solid var(--line);background:var(--surface2);color:var(--txt);font:inherit">` +
      `<button type="submit" class="ghost" style="margin:0;padding:.6rem 1rem;cursor:pointer;font:inherit">Buscar</button></form>` +
      `<div class="days" style="grid-template-columns:repeat(2,1fr);margin-bottom:.75rem">` +
      `<a class="${o.filtro === "sumidos" ? "on" : ""}" href="/painel/clientes?filtro=sumidos">Sumidos 45+ dias</a>` +
      `<a class="${o.filtro === "todos" ? "on" : ""}" href="/painel/clientes">Todos</a>` +
      `</div>${lista}`,
  });
}



// Caixa: entrou de verdade, por meio, contra a meta do dia.
function renderFinanceiro(o: {
  row: Record<string, unknown>;
  nome: string;
  canonical: string;
  timezone: string;
  papel: string;
  hoje: string;
  dia: number;
  semana: number;
  mes: number;
  atual: { recebido_cents: number; pagamentos: number; ticket_medio_cents: number; pix_cents: number; dinheiro_cents: number; cartao_cents: number; outros_cents: number; concluidos_cents: number; sem_pagamento: number; meta_cents: number };
  erro?: string;
}): string {
  const meta = Number(o.atual.meta_cents) || 0;
  const recebido = Number(o.atual.recebido_cents) || 0;
  const pct = meta > 0 ? Math.min(100, Math.round((recebido / meta) * 100)) : 0;
  const barra = meta > 0
    ? `<div style="height:.5rem;border-radius:9999px;background:var(--surface2);overflow:hidden;margin:.5rem 0">` +
      `<div style="height:100%;width:${pct}%;background:var(--p)"></div></div>` +
      `<span class="d">${pct}% da meta de ${escapeHtml(money(meta))}</span>`
    : `<span class="d">Nenhuma meta definida para hoje.</span>`;
  const linha = (rotulo: string, valor: string) => `<div class="r"><span>${escapeHtml(rotulo)}</span><span>${escapeHtml(valor)}</span></div>`;
  return appPage({
    row: o.row,
    name: o.nome,
    canonical: `${o.canonical}painel/financeiro`,
    title: `Caixa — ${o.nome}`,
    description: `Entradas da ${o.nome}.`,
    shell: "painel" as const,
    body:
      `<h1>Caixa</h1><p class="sub">Somente dinheiro recebido — faturamento previsto é outra coisa</p>` +
      (o.erro ? `<p class="empty">${escapeHtml(o.erro)}</p>` : "") +
      `<h2>Hoje</h2><div class="hours">` +
      linha("Recebido hoje", money(recebido)) +
      linha("Atendimentos pagos", String(Number(o.atual.pagamentos) || 0)) +
      linha("Ticket médio", money(o.atual.ticket_medio_cents)) +
      `</div><div class="card" style="margin-top:.6rem">${barra}</div>` +
      `<form method="post" action="/painel/meta" style="display:flex;gap:.5rem;margin:.6rem 0">` +
      `<input name="meta" inputmode="decimal" value="${meta > 0 ? (meta / 100).toFixed(2).replace(".", ",") : ""}" placeholder="meta do dia (R$)" aria-label="Meta diária" style="flex:1;min-width:0;padding:.6rem;border-radius:.7rem;border:1px solid var(--line);background:var(--surface2);color:var(--txt);font:inherit">` +
      `<button type="submit" class="ghost" style="margin:0;padding:.6rem 1rem;cursor:pointer;font:inherit">Salvar meta</button></form>` +
      `<h2>Por forma de pagamento (hoje)</h2><div class="hours">` +
      linha("Pix", money(o.atual.pix_cents)) +
      linha("Dinheiro", money(o.atual.dinheiro_cents)) +
      linha("Cartão", money(o.atual.cartao_cents)) +
      (Number(o.atual.outros_cents) > 0 ? linha("Outro", money(o.atual.outros_cents)) : "") +
      `</div>` +
      `<h2>Períodos</h2><div class="hours">` +
      linha("Últimos 7 dias", money(o.semana)) +
      linha("Este mês", money(o.mes)) +
      `</div>` +
      `<h2>Pendências</h2><div class="hours">` +
      linha("Concluídos sem pagamento registrado", String(Number(o.atual.sem_pagamento) || 0)) +
      `</div>` +
      `<p class="d" style="color:var(--muted);font-size:.72rem;margin-top:.6rem">Recebido é dinheiro que entrou. Serviço concluído sem pagamento registrado aparece em Pendências, para você cobrar ou lançar.</p>` +
      `<a class="ghost" href="/painel/agenda">Ir para a agenda</a>`,
  });
}


// Minha barbearia: o dono muda o próprio negócio. Nome, contato, cores, horários.
function renderBarbearia(o: {
  row: Record<string, unknown>;
  nome: string;
  canonical: string;
  papel: string;
  nonce?: string;
  ok?: boolean;
  erro?: string;
}): string {
  // Campo de contato vazio apaga o botão do site inteiro: avisar em vez de deixar passar.
  const avisoContato =
    !String(o.row.whatsapp_public ?? "").trim() || !String(o.row.phone_public ?? "").trim()
      ? `<p class="empty" style="border-color:#b45309">Sem WhatsApp ou telefone, o site fica sem botão de contato. Preencha os dois.</p>`
      : "";
  const campo = (id: string, rotulo: string, valor: string, tipo = "text", extra = "") =>
    `<label class="d" for="${id}">${escapeHtml(rotulo)}</label>` +
    `<input id="${id}" name="${id}" type="${tipo}" value="${escapeHtml(valor)}" ${extra} ${CAMPO}>`;
  const horarios = String(o.row.opening_hours ? JSON.stringify(o.row.opening_hours) : "{}");
  const tabela = JSON.parse(horarios) as Record<string, unknown>;
  const linhas = [["mon","Segunda"],["tue","Terça"],["wed","Quarta"],["thu","Quinta"],["fri","Sexta"],["sat","Sábado"],["sun","Domingo"]]
    .map(([chave, label]) => {
      const valor = typeof tabela[chave] === "string" ? String(tabela[chave]) : "";
      return `<label class="d" for="h_${chave}">${label}</label>` +
        `<input id="h_${chave}" name="h_${chave}" value="${escapeHtml(valor)}" placeholder="09:00-19:00 (vazio = fechado)" ${CAMPO.replace(".85rem", ".3rem")}>`;
    })
    .join("");
  const blocoLogo =
    (String(o.row.logo_url ?? "").startsWith("https://")
        ? `<div class="card" style="margin:0 0 .5rem"><span class="d">Logo atual</span><div style="display:flex;align-items:center;gap:.6rem;margin-top:.4rem">` +
          `<img src="${escapeHtml(String(o.row.logo_url))}" alt="" style="width:2.6rem;height:2.6rem;border-radius:.6rem;object-fit:contain;background:var(--surface2)">` +
          `<form method="post" action="/painel/logo"><input type="hidden" name="remover" value="1"><button type="submit" class="ghost" style="padding:.3rem .6rem;font-size:.72rem;cursor:pointer">Remover logo</button></form>` +
          `</div></div>`
        : "") +
      `<div class="card" style="margin:0 0 .5rem"><span class="d">Logo da barbearia (quadrado, até 2 MB)</span>` +
      `<form method="post" action="/painel/logo" enctype="multipart/form-data" data-redimensionar="512" style="margin-top:.4rem">` +
      `<input name="arquivo" type="file" accept="image/jpeg,image/png,image/webp" style="width:100%;font-size:.78rem;color:var(--muted)">` +
      `<button type="submit" class="ghost" style="width:100%;padding:.4rem;font-size:.78rem;cursor:pointer;margin:.35rem 0 0">Enviar logo</button></form>` +
      `<span class="d" style="display:block;margin-top:.35rem">Aparece no topo do site do cliente. Sem logo, fica as iniciais.</span></div>`;
  return appPage({
    script: o.nonce ? `<script nonce="${escapeHtml(o.nonce)}">${REDUTOR}</script>` : "",
    row: o.row,
    name: o.nome,
    canonical: `${o.canonical}painel/barbearia`,
    title: `Minha barbearia — ${o.nome}`,
    description: `Dados, cores e horários da ${o.nome}.`,
    shell: "painel" as const,
    body:
      `<h1>Minha barbearia</h1><p class="sub">O que você mudar aqui aparece no site na hora</p>` +
      (o.ok ? `<p class="empty" style="border-color:var(--p)">Salvo.</p>` : "") +
      (o.erro ? `<p class="empty">${escapeHtml(o.erro)}</p>` : "") +
      avisoContato +
      // Fora do formulário de propósito: form dentro de form é HTML inválido, o navegador
      // ignora o interno e fecha o externo — foi o que deixou o Salvar sem ação.
      blocoLogo +
      `<form method="post" action="/painel/barbearia"><h2>Identidade</h2>` +
      `<p class="d" style="color:var(--muted);font-size:.72rem;margin:0 0 .4rem">Campo deixado em branco não altera o que já está gravado.</p><div class="card">` +
      campo("nome", "Nome da barbearia", String(o.row.display_name ?? o.nome), "text", "required maxlength=80") +
      campo("endereco", "Endereço", String(o.row.address_line ?? ""), "text", "maxlength=120") +
      campo("cidade", "Cidade", String(o.row.city ?? ""), "text", "maxlength=60") +
      campo("estado", "UF", String(o.row.state ?? ""), "text", "maxlength=2") +
      campo("telefone", "Telefone", String(o.row.phone_public ?? ""), "tel", "maxlength=20") +
      campo("whatsapp", "WhatsApp (só números, com 55)", String(o.row.whatsapp_public ?? ""), "tel", "maxlength=20") +
      campo("instagram", "Instagram (sem @)", String(o.row.instagram_handle ?? ""), "text", "maxlength=40") +
      campo("logo", "Ou cole um link (https)", String(o.row.logo_url ?? ""), "url", "maxlength=300") +
      campo("politica", "Aviso no agendamento", String(o.row.booking_policy_text ?? ""), "text", "maxlength=200") +
      `</div><h2>Cores</h2><div class="card">` +
      campo("cor_primaria", "Cor principal — botões, preços e destaques", String(o.row.color_primary ?? "#6deaed"), "color") +
      campo("cor_secundaria", "Cor de fundo — o tom da página (entra suavizado)", String(o.row.color_secondary ?? "#26262b"), "color") +
      campo("cor_acento", "Cor de apoio — títulos de seção", String(o.row.color_accent ?? "#9ca3af"), "color") +
      `<span class="d">Prévia com as cores salvas:</span>` +
      `<div style="display:flex;gap:.4rem;align-items:center;margin:.4rem 0 .2rem">` +
      `<span style="flex:1;text-align:center;padding:.55rem;border-radius:.7rem;background:${escapeHtml(String(o.row.color_primary ?? "#6deaed"))};color:#111;font-weight:700;font-size:.8rem">Agendar</span>` +
      `<span style="flex:1;text-align:center;padding:.55rem;border-radius:.7rem;background:${escapeHtml(String(o.row.color_secondary ?? "#26262b"))};color:#fff;font-size:.8rem">Fundo</span>` +
      `<span style="flex:1;text-align:center;padding:.55rem;border-radius:.7rem;border:1px solid var(--line);color:${escapeHtml(String(o.row.color_accent ?? "#9ca3af"))};font-size:.8rem;letter-spacing:.1em;text-transform:uppercase;font-weight:700">Apoio</span>` +
      `</div>` +
      `</div><h2>Horário de funcionamento</h2><div class="card">${linhas}</div>` +
      `<button class="cta" type="submit">Salvar</button></form>` +
      `<a class="ghost" href="/painel">Voltar ao painel</a>`,
  });
}

// Serviços: o que a barbearia vende, com preço e duração.
function renderServicos(o: {
  row: Record<string, unknown>;
  nome: string;
  canonical: string;
  papel: string;
  servicos: Array<{ service_id: string; name: string; description: string | null; duration_min: number; price_cents: number; active: boolean }>;
  ok?: boolean;
  erro?: string;
}): string {
  const reais = (cents: number) => (Number(cents) / 100).toFixed(2).replace(".", ",");
  const lista = o.servicos
    .map(
      (s) =>
        `<div class="card"><form method="post" action="/painel/servicos">` +
        `<input type="hidden" name="servico" value="${escapeHtml(s.service_id)}">` +
        `<div class="row"><span class="t">${escapeHtml(s.name)}</span><span class="price">${s.active ? "" : "inativo"}</span></div>` +
        `<label class="d" for="n_${s.service_id}">Nome</label><input id="n_${s.service_id}" name="nome" value="${escapeHtml(s.name)}" required maxlength=80 ${CAMPO.replace(".85rem", ".3rem")}>` +
        `<label class="d" for="d_${s.service_id}">Duração (min)</label><input id="d_${s.service_id}" name="duracao" value="${Number(s.duration_min)}" inputmode="numeric" required ${CAMPO.replace(".85rem", ".3rem")}>` +
        `<label class="d" for="p_${s.service_id}">Preço (R$)</label><input id="p_${s.service_id}" name="preco" value="${reais(s.price_cents)}" inputmode="decimal" required ${CAMPO.replace(".85rem", ".3rem")}>` +
        `<button type="submit" class="ghost" style="width:100%;margin:.5rem 0 0;padding:.5rem;cursor:pointer;font:inherit;font-size:.78rem">Salvar</button>` +
        `</form>` +
        `<form method="post" action="/painel/servicos/ativo"><input type="hidden" name="servico" value="${escapeHtml(s.service_id)}">` +
        `<input type="hidden" name="ativo" value="${s.active ? "0" : "1"}">` +
        `<button type="submit" class="ghost" style="width:100%;margin:.35rem 0 0;padding:.5rem;cursor:pointer;font:inherit;font-size:.78rem">${s.active ? "Desativar" : "Ativar"}</button></form>`,
    )
    .join("");
  return appPage({
    row: o.row,
    name: o.nome,
    canonical: `${o.canonical}painel/servicos`,
    title: `Serviços — ${o.nome}`,
    description: `Serviços e preços da ${o.nome}.`,
    shell: "painel" as const,
    body:
      `<h1>Serviços</h1><p class="sub">${o.servicos.filter((s) => s.active).length} ativos de ${o.servicos.length}</p>` +
      (o.ok ? `<p class="empty" style="border-color:var(--p)">Salvo.</p>` : "") +
      (o.erro ? `<p class="empty">${escapeHtml(o.erro)}</p>` : "") +
      `<h2>Novo serviço</h2><form method="post" action="/painel/servicos"><div class="card">` +
      `<label class="d" for="nn">Nome</label><input id="nn" name="nome" required maxlength=80 ${CAMPO}>` +
      `<label class="d" for="nd">Duração (min)</label><input id="nd" name="duracao" value="30" inputmode="numeric" required ${CAMPO}>` +
      `<label class="d" for="np">Preço (R$)</label><input id="np" name="preco" value="40,00" inputmode="decimal" required ${CAMPO}>` +
      `</div><button class="cta" type="submit">Adicionar</button></form>` +
      `<h2>Existentes</h2>${lista}` +
      `<a class="ghost" href="/painel/barbearia">Editar dados e horários</a><a class="ghost" href="/painel">Voltar ao painel</a>`,
  });
}


// Despesas e resultado: o número que interessa é o que sobrou.
function renderDespesas(o: {
  row: Record<string, unknown>;
  nome: string;
  canonical: string;
  papel: string;
  mes: string;
  despesas: Array<{ expense_id: string; description: string; category: string; amount_cents: number; method: string; spent_on: string }>;
  resultado: { recebido_cents: number; despesas_cents: number; comissoes_cents: number; bbt_concedido_cents: number; sobrou_cents: number };
  ok?: boolean;
  erro?: string;
}): string {
  const categorias: Array<[string, string]> = [
    ["aluguel", "Aluguel"], ["produtos", "Produtos"], ["energia", "Energia"], ["agua", "Água"],
    ["internet", "Internet"], ["salario", "Salários"], ["marketing", "Marketing"],
    ["manutencao", "Manutenção"], ["impostos", "Impostos"], ["outros", "Outros"],
  ];
  const porCategoria = new Map<string, number>();
  for (const d of o.despesas) {
    porCategoria.set(d.category, (porCategoria.get(d.category) ?? 0) + Number(d.amount_cents));
  }
  const resumo = [...porCategoria.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, valor]) => `<div class="r"><span>${escapeHtml(categorias.find(([k]) => k === cat)?.[1] ?? cat)}</span><span>${escapeHtml(money(valor))}</span></div>`)
    .join("");
  const sobrou = Number(o.resultado.sobrou_cents) || 0;
  const linha = (rotulo: string, valor: string, cor?: string) =>
    `<div class="r"><span>${escapeHtml(rotulo)}</span><span${cor ? ` style="color:${cor}"` : ""}>${escapeHtml(valor)}</span></div>`;
  const lista = o.despesas.length
    ? o.despesas
        .map(
          (d) =>
            `<div class="card"><div class="row"><span class="t">${escapeHtml(d.description)}</span><span class="price">${escapeHtml(money(d.amount_cents))}</span></div>` +
            `<span class="d">${escapeHtml(categorias.find(([k]) => k === d.category)?.[1] ?? d.category)} · ${escapeHtml(d.method)} · ${escapeHtml(d.spent_on.slice(8, 10) + "/" + d.spent_on.slice(5, 7))}</span>` +
            `<form method="post" action="/painel/despesas/cancelar" style="margin-top:.35rem">` +
            `<input type="hidden" name="despesa" value="${escapeHtml(d.expense_id)}">` +
            `<button type="submit" class="ghost" style="padding:.35rem .7rem;font-size:.74rem;cursor:pointer;margin:0">Cancelar</button></form></div>`,
        )
        .join("")
    : `<p class="empty">Nenhuma despesa lançada neste mês.</p>`;
  const campo = CAMPO.replace(".85rem", ".3rem");
  return appPage({
    row: o.row,
    name: o.nome,
    canonical: `${o.canonical}painel/despesas`,
    title: `Despesas — ${o.nome}`,
    description: `Despesas e resultado da ${o.nome}.`,
    shell: "painel" as const,
    body:
      `<h1>Despesas</h1><p class="sub">Mês de ${escapeHtml(o.mes)}</p>` +
      `<form method="get" action="/painel/despesas" style="display:flex;gap:.5rem;margin-bottom:.6rem">` +
      `<input type="month" name="mes" value="${escapeHtml(o.mes)}" aria-label="Escolher o mês" style="flex:1;min-width:0;padding:.6rem;border-radius:.7rem;border:1px solid var(--line);background:var(--surface2);color:var(--txt);font:inherit">` +
      `<button type="submit" class="ghost" style="margin:0;padding:.6rem .9rem;cursor:pointer;font:inherit">Ver mês</button></form>` +
      (o.ok ? `<p class="empty" style="border-color:var(--p)">Salvo.</p>` : "") +
      (o.erro ? `<p class="empty">${escapeHtml(o.erro)}</p>` : "") +
      `<h2>Resultado do mês</h2><div class="hours">` +
      linha("Recebido", money(o.resultado.recebido_cents)) +
      linha("Despesas", "− " + money(o.resultado.despesas_cents)) +
      linha("Comissões", "− " + money(o.resultado.comissoes_cents)) +
      linha(sobrou >= 0 ? "Sobrou" : "Faltou", money(Math.abs(sobrou)), sobrou >= 0 ? "var(--p)" : "#ff8f8f") +
      `</div><p class="d" style="color:var(--muted);font-size:.72rem;margin:.4rem 0 .8rem">` +
      `BBT concedido no mês: ${escapeHtml(bbt(o.resultado.bbt_concedido_cents))} — não é despesa em dinheiro, é desconto prometido.</p>` +
      `<h2>Despesas do mês</h2>` +
      (resumo ? `<div class="hours">${resumo}</div>` : "") +
      lista +
      `<h2>Lançar despesa</h2><form method="post" action="/painel/despesas"><div class="card">` +
      `<label class="d" for="dv">Descrição</label><input id="dv" name="descricao" required maxlength=120 ${campo}>` +
      `<label class="d" for="dc">Categoria</label><select id="dc" name="categoria" style="width:100%;margin:.3rem 0 .8rem;padding:.65rem;border-radius:.6rem;border:1px solid var(--line);background:var(--surface2);color:var(--txt);font:inherit">` +
      categorias.map(([k, v]) => `<option value="${k}">${v}</option>`).join("") + `</select>` +
      `<label class="d" for="dval">Valor (R$)</label><input id="dval" name="valor" inputmode="decimal" required ${campo}>` +
      `<label class="d" for="dd">Data</label><input id="dd" name="data" type="date" value="${escapeHtml(o.mes)}-01" required ${campo}>` +
      `<label class="d" for="dm">Pago com</label><select id="dm" name="meio" style="width:100%;margin:.3rem 0 .8rem;padding:.65rem;border-radius:.6rem;border:1px solid var(--line);background:var(--surface2);color:var(--txt);font:inherit">` +
      `<option value="dinheiro">Dinheiro</option><option value="pix">Pix</option><option value="cartao">Cartão</option><option value="boleto">Boleto</option><option value="outro">Outro</option></select>` +
      `</div><button class="cta" type="submit">Lançar</button></form>` +
      `<a class="ghost" href="/painel/financeiro">Ver o caixa</a><a class="ghost" href="/painel">Voltar ao painel</a>`,
  });
}


// Vitrine: o que a barbearia vende no balcão. Sem foto inventada — o bloco colorido usa
// as cores da casa e as iniciais; a foto entra quando a barbearia subir a dela.
function renderProdutos(o: {
  row: Record<string, unknown>;
  nome: string;
  canonical: string;
  produtos: Array<{ product_id: string; slug: string; name: string; description: string | null; category: string; price_cents: number; compare_price_cents: number | null; image_url: string | null }>;
  whatsapp: unknown;
}): string {
  const categorias = [...new Set(o.produtos.map((p) => p.category))];
  const cards = o.produtos
    .map((item) => {
      const de = Number(item.compare_price_cents) || 0;
      const por = Number(item.price_cents) || 0;
      const off = de > por && por > 0 ? Math.round(((de - por) / de) * 100) : 0;
      const iniciais = item.name
        .split(/\s+/)
        .filter((palavra) => palavra.length > 2)
        .slice(0, 2)
        .map((palavra) => palavra[0]?.toUpperCase() ?? "")
        .join("") || item.name.slice(0, 2).toUpperCase();
      return (
        `<article class="prod">` +
        `<a href="/produtos/${encodeURIComponent(item.slug)}" style="text-decoration:none;color:inherit"><div class="prod-media${item.image_url ? " tem-foto" : ""}">` +
        (off > 0 ? `<span class="prod-off">-${off}%</span>` : "") +
        (item.image_url
          ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.name)}" loading="lazy">`
          : `<span class="prod-ini">${escapeHtml(iniciais)}</span>`) +
        `</div></a>` +
        `<div class="prod-body">` +
        `<span class="prod-cat">${escapeHtml(item.category)}</span>` +
        `<a href="/produtos/${encodeURIComponent(item.slug)}" style="text-decoration:none;color:inherit"><h3 class="prod-tit">${escapeHtml(item.name)}</h3></a>` +
        (item.description ? `<p class="prod-desc">${escapeHtml(item.description)}</p>` : "") +
        `<div class="prod-preco"><span class="agora">${escapeHtml(money(por))}</span>${de > por ? `<span class="antes">${escapeHtml(money(de))}</span>` : ""}</div>` +
        `<a class="prod-btn" href="/produtos/${encodeURIComponent(item.slug)}">Ver produto</a>` +
        `</div></article>`
      );
    })
    .join("");

  const corpo = o.produtos.length
    ? `<div class="prods">${cards}</div>` +
      `<p class="d" style="color:var(--muted);font-size:.7rem;margin:.8rem 0 0">Preços da loja física. A reserva é pelo WhatsApp e o pagamento é no balcão.</p>`
    : `<p class="empty">A barbearia ainda não cadastrou produtos.</p>`;

  return appPage({
    row: o.row,
    name: o.nome,
    canonical: `${o.canonical}produtos`,
    title: `Produtos — ${o.nome}`,
    description: `Produtos de cabelo, barba e presentes da ${o.nome}.`,
    nav: "produtos" as const,
    body:
      `<h1>Produtos</h1><p class="sub">${o.produtos.length} itens${categorias.length ? ` · ${escapeHtml(categorias.join(" · "))}` : ""}</p>` +
      corpo +
      `<a class="ghost" href="/agendar">Agendar um horário</a>`,
  });
}


// Produtos no painel: cadastrar, corrigir preço, tirar da vitrine.
function renderProdutosPainel(o: {
  row: Record<string, unknown>;
  nome: string;
  canonical: string;
  papel: string;
  produtos: Array<{ product_id: string; name: string; description: string | null; details: string | null; category: string; brand: string | null; size_label: string | null; price_cents: number; compare_price_cents: number | null; active: boolean; image_url: string | null }>;
  nonce?: string;
  ok?: boolean;
  erro?: string;
}): string {
  const campo = CAMPO.replace(".85rem", ".3rem");
  const reais = (cents: number | null) => (cents === null ? "" : (Number(cents) / 100).toFixed(2).replace(".", ","));
  const lista = o.produtos.length
    ? o.produtos
        .map(
          (item) =>
            `<div class="card"><form method="post" action="/painel/produtos">` +
            `<input type="hidden" name="produto" value="${escapeHtml(item.product_id)}">` +
            `<div class="row"><span class="t">${escapeHtml(item.name)}</span><span class="price">${item.active ? escapeHtml(money(item.price_cents)) : "fora da vitrine"}</span></div>` +
            (item.image_url
              ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.name)}" style="width:100%;height:7rem;object-fit:contain;background:var(--surface2);border-radius:.6rem;margin:.35rem 0">`
              : `<span class="d">sem foto — o card usa as iniciais</span>`) +
            `<label class="d" for="n_${item.product_id}">Nome</label><input id="n_${item.product_id}" name="nome" value="${escapeHtml(item.name)}" required maxlength=80 ${campo}>` +
            `<label class="d" for="d_${item.product_id}">Descrição</label><input id="d_${item.product_id}" name="descricao" value="${escapeHtml(item.description ?? "")}" maxlength=160 ${campo}>` +
            `<label class="d" for="c_${item.product_id}">Categoria</label><input id="c_${item.product_id}" name="categoria" value="${escapeHtml(item.category)}" maxlength=30 ${campo}>` +
            `<label class="d" for="p_${item.product_id}">Preço (R$)</label><input id="p_${item.product_id}" name="preco" value="${reais(item.price_cents)}" inputmode="decimal" required ${campo}>` +
            `<label class="d" for="d2_${item.product_id}">Preço antigo (deixe vazio se não há)</label><input id="d2_${item.product_id}" name="preco_de" value="${reais(item.compare_price_cents)}" inputmode="decimal" ${campo}>` +
            `<label class="d" for="m_${item.product_id}">Marca</label><input id="m_${item.product_id}" name="marca" value="${escapeHtml(item.brand ?? "")}" maxlength=40 ${campo}>` +
            `<label class="d" for="t_${item.product_id}">Tamanho / volume</label><input id="t_${item.product_id}" name="tamanho" value="${escapeHtml(item.size_label ?? "")}" maxlength=30 ${campo}>` +
            `<label class="d" for="det_${item.product_id}">Descrição completa</label><textarea id="det_${item.product_id}" name="detalhes" rows="4" maxlength=1200 ${campo}>${escapeHtml(item.details ?? "")}</textarea>` +
            `<button type="submit" class="ghost" style="width:100%;padding:.4rem;font-size:.78rem;cursor:pointer;margin:.3rem 0 0">Salvar</button></form>` +
            `<form method="post" action="/painel/produtos/foto" enctype="multipart/form-data" data-redimensionar="1200" style="margin-top:.35rem">` +
            `<input type="hidden" name="produto" value="${escapeHtml(item.product_id)}">` +
            `<label class="d" for="f_${item.product_id}">Foto (jpg, png ou webp · até 5 MB)</label>` +
            `<input id="f_${item.product_id}" name="arquivo" type="file" accept="image/jpeg,image/png,image/webp" style="width:100%;margin:.2rem 0 .3rem;font-size:.78rem;color:var(--muted)">` +
            `<button type="submit" class="ghost" style="width:100%;padding:.4rem;font-size:.76rem;cursor:pointer;margin:0">Enviar foto</button></form>` +
            (item.image_url
              ? `<form method="post" action="/painel/produtos/foto"><input type="hidden" name="produto" value="${escapeHtml(item.product_id)}"><input type="hidden" name="remover" value="1">` +
                `<button type="submit" class="ghost" style="width:100%;padding:.35rem;font-size:.72rem;cursor:pointer;margin:.25rem 0 0">Remover foto</button></form>`
              : "") +
            `<form method="post" action="/painel/produtos/ativo" style="margin-top:.3rem">` +
            `<input type="hidden" name="produto" value="${escapeHtml(item.product_id)}">` +
            `<input type="hidden" name="ativo" value="${item.active ? "0" : "1"}">` +
            `<button type="submit" class="ghost" style="width:100%;padding:.4rem;font-size:.76rem;cursor:pointer;margin:0">${item.active ? "Tirar da vitrine" : "Voltar para a vitrine"}</button></form></div>`,
        )
        .join("")
    : `<p class="empty">Nenhum produto cadastrado.</p>`;
  return appPage({
    script: o.nonce ? `<script nonce="${escapeHtml(o.nonce)}">${REDUTOR}</script>` : "",
    row: o.row,
    name: o.nome,
    canonical: `${o.canonical}painel/produtos`,
    title: `Produtos — ${o.nome}`,
    description: `Produtos da ${o.nome}.`,
    shell: "painel" as const,
    body:
      `<h1>Produtos</h1><p class="sub">${o.produtos.filter((p) => p.active).length} na vitrine de ${o.produtos.length}</p>` +
      (o.ok ? `<p class="empty" style="border-color:var(--p)">Salvo.</p>` : "") +
      (o.erro ? `<p class="empty">${escapeHtml(o.erro)}</p>` : "") +
      `<h2>Novo produto</h2><form method="post" action="/painel/produtos"><div class="card">` +
      `<label class="d" for="nn">Nome</label><input id="nn" name="nome" required maxlength=80 ${campo}>` +
      `<label class="d" for="nd">Descrição</label><input id="nd" name="descricao" maxlength=160 ${campo}>` +
      `<label class="d" for="nc">Categoria</label><input id="nc" name="categoria" value="Cabelo" maxlength=30 ${campo}>` +
      `<label class="d" for="np">Preço (R$)</label><input id="np" name="preco" inputmode="decimal" required ${campo}>` +
      `<label class="d" for="npd">Preço antigo (opcional)</label><input id="npd" name="preco_de" inputmode="decimal" ${campo}>` +
      `<label class="d" for="nm">Marca</label><input id="nm" name="marca" maxlength=40 ${campo}>` +
      `<label class="d" for="nt">Tamanho / volume</label><input id="nt" name="tamanho" maxlength=30 placeholder="120 g" ${campo}>` +
      `<label class="d" for="ndet">Descrição completa (aparece na página do produto)</label><textarea id="ndet" name="detalhes" rows="4" maxlength=1200 ${campo}></textarea>` +
      `</div><button class="cta" type="submit">Adicionar</button></form>` +
      `<h2>Cadastrados</h2>${lista}` +
      `<a class="ghost" href="/produtos">Ver a vitrine do cliente</a><a class="ghost" href="/painel">Voltar ao painel</a>`,
  });
}


// Página do produto: o card é vitrine, aqui é onde a pessoa decide.
function renderProduto(o: {
  row: Record<string, unknown>;
  nome: string;
  canonical: string;
  produto: { slug: string; name: string; description: string | null; details: string | null; category: string; brand: string | null; size_label: string | null; price_cents: number; compare_price_cents: number | null; image_url: string | null };
  whatsapp: unknown;
  parecidos: Array<{ slug: string; name: string; price_cents: number; image_url: string | null }>;
}): string {
  const p = o.produto;
  const de = Number(p.compare_price_cents) || 0;
  const por = Number(p.price_cents) || 0;
  const off = de > por && por > 0 ? Math.round(((de - por) / de) * 100) : 0;
  const numero = String(o.whatsapp ?? "").replace(/\D/g, "");
  const mensagem = `Ola! Quero o ${p.name} (${money(por)}) que vi no site da ${o.nome}.`;
  const link = numero ? `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}` : whatsappLink(o.whatsapp, o.nome) || "#";
  const iniciais = p.name
    .split(/\s+/)
    .filter((palavra) => palavra.length > 2)
    .slice(0, 2)
    .map((palavra) => palavra[0]?.toUpperCase() ?? "")
    .join("") || p.name.slice(0, 2).toUpperCase();

  const ficha = [
    ["Marca", p.brand],
    ["Tamanho", p.size_label],
    ["Categoria", p.category],
  ]
    .filter(([, valor]) => Boolean(valor))
    .map(([rotulo, valor]) => `<div class="r"><span>${escapeHtml(String(rotulo))}</span><span>${escapeHtml(String(valor))}</span></div>`)
    .join("");

  const parecidos = o.parecidos.length
    ? `<h2>Outros da mesma categoria</h2><div class="prods">${o.parecidos
        .map(
          (item) =>
            `<a class="prod" href="/produtos/${encodeURIComponent(item.slug)}"><div class="prod-media${item.image_url ? " tem-foto" : ""}">` +
            (item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.name)}" loading="lazy">` : `<span class="prod-ini">${escapeHtml(item.name.slice(0, 2).toUpperCase())}</span>`) +
            `</div><div class="prod-body"><h3 class="prod-tit">${escapeHtml(item.name)}</h3>` +
            `<div class="prod-preco"><span class="agora">${escapeHtml(money(item.price_cents))}</span></div></div></a>`,
        )
        .join("")}</div>`
    : "";

  return appPage({
    row: o.row,
    name: o.nome,
    canonical: `${o.canonical}produtos/${p.slug}`,
    title: `${p.name} — ${o.nome}`,
    description: p.description ?? `Produto da ${o.nome}.`,
    nav: "produtos" as const,
    body:
      `<div class="prod-media${p.image_url ? " tem-foto" : ""}" style="border-radius:1rem;margin-bottom:.8rem">` +
      (off > 0 ? `<span class="prod-off">-${off}%</span>` : "") +
      (p.image_url ? `<img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name)}">` : `<span class="prod-ini" style="font-size:2rem">${escapeHtml(iniciais)}</span>`) +
      `</div>` +
      `<span class="prod-cat">${escapeHtml(p.category)}</span>` +
      `<h1>${escapeHtml(p.name)}</h1>` +
      `<div class="prod-preco" style="margin:.4rem 0"><span class="agora" style="font-size:1.3rem">${escapeHtml(money(por))}</span>${de > por ? `<span class="antes" style="font-size:.85rem">${escapeHtml(money(de))}</span>` : ""}</div>` +
      (p.description ? `<p class="sub" style="margin-bottom:.6rem">${escapeHtml(p.description)}</p>` : "") +
      (ficha ? `<div class="hours">${ficha}</div>` : "") +
      (p.details ? `<h2>Sobre o produto</h2><div class="card"><p style="margin:0;font-size:.86rem;line-height:1.55">${escapeHtml(p.details)}</p></div>` : "") +
      `<h2>Como reservar</h2><div class="hours">` +
      `<div class="r"><span>1</span><span>Toque em Reservar — abre o WhatsApp com a mensagem pronta</span></div>` +
      `<div class="r"><span>2</span><span>A barbearia confirma se tem em estoque</span></div>` +
      `<div class="r"><span>3</span><span>Pagamento e retirada no balcão</span></div>` +
      `</div>` +
      `<a class="cta" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Reservar no WhatsApp</a>` +
      parecidos +
      `<a class="ghost" href="/produtos">Ver todos os produtos</a>`,
  });
}

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
    shell: "painel" as const,
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
    pago_cents: number;
    metodo: string | null;
    customer_id: string | null;
    bbt_cents: number;
    bbt_usado_cents: number;
  }>;
  staff: Array<{ staff_id: string; display_name: string }>;
  servicos: Array<{ service_id: string; name: string; duration_min: number; price_cents: number }>;
  bloqueios: Array<{ block_id: string; staff_id: string; starts_at: string; ends_at: string; reason: string | null }>;
  vagos: Array<{ staff_id: string; starts_at: string }>;
  servicoPadrao: string | null;
  filtro: string;
  erro?: string;
  aviso?: string;
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

  // Semana do dia escolhido, começando na segunda (semana brasileira) e indo até
  // domingo. O campo de data abre o calendário nativo do celular, que traz o mês —
  // é o jeito de escolher dia e mês sem inventar um calendário em HTML puro.
  const segundaDaSemana = (() => {
    const d = new Date(`${o.dia}T12:00:00Z`);
    const dow = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
    return d.toISOString().slice(0, 10);
  })();
  const qs = (dia: string) => `/painel/agenda?dia=${dia}${o.filtro ? `&staff=${encodeURIComponent(o.filtro)}` : ""}`;
  const link = (dia: string) => qs(dia);
  const semana = Array.from({ length: 7 }, (_, i) => somaDia(segundaDaSemana, i))
    .map((dia) => {
      const dow = new Date(`${dia}T12:00:00Z`).getUTCDay();
      const curto = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"][dow];
      return `<a class="${dia === o.dia ? "on" : ""}" href="${link(dia)}">${curto}<br>${dia.slice(8, 10)}</a>`;
    })
    .join("");

  const nav =
    `<form method="get" action="/painel" style="display:flex;gap:.5rem;margin-bottom:.6rem">` +
    `<input type="date" name="dia" value="${escapeHtml(o.dia)}" aria-label="Escolher o dia" style="flex:1;min-width:0;padding:.65rem;border-radius:.7rem;border:1px solid var(--line);background:var(--surface2);color:var(--txt);font:inherit">` +
    `<button type="submit" class="ghost" style="margin:0;padding:.6rem 1rem;cursor:pointer;font:inherit">Ver dia</button>` +
    `</form>` +
    `<div class="days" style="grid-template-columns:repeat(7,1fr);gap:.35rem;margin-bottom:.6rem">${semana}</div>` +
    `<div class="days" style="grid-template-columns:repeat(3,1fr);margin-bottom:.75rem">` +
    `<a href="${link(somaDia(o.dia, -1))}">◀ Ontem</a>` +
    `<a class="${o.dia === hoje ? "on" : ""}" href="${link(hoje)}">Hoje</a>` +
    `<a href="${link(somaDia(o.dia, 1))}">Amanhã ▶</a>` +
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
          const pago = Number(a.pago_cents) || 0;
          const saldoBbt = Number(a.bbt_cents) || 0;
          const usadoBbt = Number(a.bbt_usado_cents) || 0;
          const recebivel =
            (a.status === "confirmed" || a.status === "completed") &&
            pago === 0 &&
            !(usadoBbt > 0 && a.price_cents !== null && usadoBbt >= Number(a.price_cents));
          // Teto do abatimento: o menor entre o saldo do cliente e o preço do serviço.
          const tetoBbt = a.price_cents ? Math.min(saldoBbt, Number(a.price_cents)) : saldoBbt;
          const bbtCampo = saldoBbt > 0 && recebivel
            ? `<label class="d" for="bbt_${a.appointment_id}">Usar BBT (saldo ${escapeHtml(bbt(saldoBbt))})</label>` +
              `<input id="bbt_${a.appointment_id}" name="bbt" inputmode="decimal" value="${(tetoBbt / 100).toFixed(2).replace(".", ",")}" style="width:100%;margin:.2rem 0 .3rem;padding:.45rem;border-radius:.6rem;border:1px solid var(--line);background:var(--surface2);color:var(--txt);font:inherit;font-size:.78rem">`
            : "";
          const dinheiro = pago > 0
            ? `<span class="d" style="color:var(--p)">recebido ${escapeHtml(money(pago))}${a.metodo ? ` · ${escapeHtml(a.metodo)}` : ""}${usadoBbt > 0 ? ` · ${escapeHtml(bbt(usadoBbt))}` : ""}</span>`
            : usadoBbt > 0 && a.price_cents !== null && usadoBbt >= Number(a.price_cents)
              ? `<span class="d" style="color:var(--p)">pago com ${escapeHtml(bbt(usadoBbt))}</span>`
            : recebivel
              ? `<form method="post" action="/painel/receber" style="margin-top:.4rem">` +
                `<input type="hidden" name="agendamento" value="${escapeHtml(a.appointment_id)}">` +
                `<input type="hidden" name="dia" value="${escapeHtml(o.dia)}">` +
                bbtCampo +
                `<div style="display:flex;gap:.4rem">` +
                `<select name="meio" aria-label="Forma de pagamento" style="flex:1;padding:.45rem;border-radius:.6rem;border:1px solid var(--line);background:var(--surface2);color:var(--txt);font:inherit;font-size:.76rem">` +
                `<option value="pix">Pix</option><option value="dinheiro">Dinheiro</option><option value="cartao">Cartão</option><option value="outro">Outro</option></select>` +
                `<button type="submit" class="ghost" style="margin:0;padding:.45rem .8rem;font-size:.76rem;cursor:pointer">Receber ${a.price_cents ? escapeHtml(money(Math.max(0, Number(a.price_cents) - tetoBbt))) : ""}</button></div></form>`
              : "";
          return (
            `<div class="card"><div class="row"><span class="t">${escapeHtml(fmtTime(a.starts_at, o.timezone))} · ${escapeHtml(a.customer_name ?? "Cliente")}</span>` +
            `<span class="price">${a.price_cents ? escapeHtml(money(a.price_cents)) : ""}</span></div>` +
            `<span class="d">${escapeHtml(a.service_name ?? "Atendimento")}${a.staff_name ? ` · ${escapeHtml(a.staff_name)}` : ""}</span>` +
            `<span class="d">${escapeHtml(ROTULO_STATUS[a.status] ?? a.status)}${zap ? ` · <a href="https://wa.me/55${escapeHtml(zap)}" target="_blank" rel="noopener noreferrer" style="color:var(--p)">${escapeHtml(a.customer_phone ?? "")}</a>` : ""}</span>` +
            `${dinheiro}${acoes}` +
            (a.status === "confirmed" || a.status === "hold" || a.status === "pending_payment"
              ? `<details style="margin-top:.4rem"><summary class="d" style="cursor:pointer">Remarcar</summary>` +
                `<form method="post" action="/painel/remarcar" style="display:flex;gap:.35rem;margin-top:.35rem">` +
                `<input type="hidden" name="agendamento" value="${escapeHtml(a.appointment_id)}">` +
                `<input type="hidden" name="dia" value="${escapeHtml(o.dia)}">` +
                `<input type="date" name="data" value="${escapeHtml(o.dia)}" required style="flex:1;min-width:0;padding:.4rem;border-radius:.6rem;border:1px solid var(--line);background:var(--surface2);color:var(--txt);font:inherit;font-size:.75rem">` +
                `<input type="time" name="hora" required style="width:5.5rem;padding:.4rem;border-radius:.6rem;border:1px solid var(--line);background:var(--surface2);color:var(--txt);font:inherit;font-size:.75rem">` +
                `<button type="submit" class="ghost" style="margin:0;padding:.4rem .7rem;font-size:.75rem;cursor:pointer">OK</button></form></details>`
              : "") +
            `</div>`
          );
        })
        .join("")
    : `<p class="empty">Nenhum agendamento neste dia.</p>`;


  const opcoesStaff = o.staff
    .map((st) => `<option value="${escapeHtml(st.staff_id)}"${o.filtro === st.staff_id ? " selected" : ""}>${escapeHtml(st.display_name)}</option>`)
    .join("");
  const filtroForm =
    `<form method="get" action="/painel/agenda" style="display:flex;gap:.5rem;margin-bottom:.6rem">` +
    `<input type="hidden" name="dia" value="${escapeHtml(o.dia)}">` +
    `<select name="staff" aria-label="Filtrar por profissional" style="flex:1;min-width:0;padding:.6rem;border-radius:.7rem;border:1px solid var(--line);background:var(--surface2);color:var(--txt);font:inherit">` +
    `<option value="">Todos os profissionais</option>${opcoesStaff}</select>` +
    `<button type="submit" class="ghost" style="margin:0;padding:.6rem .9rem;cursor:pointer;font:inherit">Filtrar</button></form>`;

  const bloqueiosBloco = o.bloqueios.length
    ? `<h2>Bloqueios do dia</h2>` +
      o.bloqueios
        .map((b) => {
          const quem = o.staff.find((st) => st.staff_id === b.staff_id)?.display_name ?? "Profissional";
          return (
            `<div class="card"><div class="row"><span class="t">${escapeHtml(fmtTime(b.starts_at, o.timezone))}–${escapeHtml(fmtTime(b.ends_at, o.timezone))}</span>` +
            `<span class="price">${escapeHtml(b.reason ?? "bloqueado")}</span></div>` +
            `<span class="d">${escapeHtml(quem)}</span>` +
            `<form method="post" action="/painel/agenda/liberar" style="margin-top:.35rem">` +
            `<input type="hidden" name="bloqueio" value="${escapeHtml(b.block_id)}">` +
            `<input type="hidden" name="dia" value="${escapeHtml(o.dia)}">` +
            `<button type="submit" class="ghost" style="padding:.4rem .8rem;font-size:.76rem;cursor:pointer;margin:0">Liberar horário</button></form></div>`
          );
        })
        .join("")
    : "";

  const opcoesServico = o.servicos
    .map((sv) => `<option value="${escapeHtml(sv.service_id)}">${escapeHtml(sv.name)} — ${escapeHtml(money(sv.price_cents))}</option>`)
    .join("");
  const campoCurto = CAMPO.replace(".85rem", ".3rem");

  const novoForm =
    `<details class="card" style="margin-top:.75rem"><summary style="cursor:pointer;font-weight:600">+ Marcar cliente (telefone ou balcão)</summary>` +
    `<form method="post" action="/painel/agenda/novo" style="margin-top:.6rem">` +
    `<input type="hidden" name="dia" value="${escapeHtml(o.dia)}">` +
    `<label class="d" for="nnome">Nome do cliente</label><input id="nnome" name="nome" required maxlength=80 ${campoCurto}>` +
    `<label class="d" for="nfone">Telefone (WhatsApp)</label><input id="nfone" name="telefone" inputmode="tel" required placeholder="11987654321" ${campoCurto}>` +
    `<label class="d" for="nserv">Serviço</label><select id="nserv" name="servico" required style="width:100%;margin:.3rem 0 .8rem;padding:.65rem;border-radius:.6rem;border:1px solid var(--line);background:var(--surface2);color:var(--txt);font:inherit">${opcoesServico}</select>` +
    `<label class="d" for="nstaff">Profissional</label><select id="nstaff" name="profissional" required style="width:100%;margin:.3rem 0 .8rem;padding:.65rem;border-radius:.6rem;border:1px solid var(--line);background:var(--surface2);color:var(--txt);font:inherit">${opcoesStaff}</select>` +
    `<label class="d" for="ndata">Data</label><input id="ndata" name="data" type="date" value="${escapeHtml(o.dia)}" required ${campoCurto}>` +
    `<label class="d" for="nhora">Hora</label><input id="nhora" name="hora" type="time" required ${campoCurto}>` +
    `<button type="submit" class="cta" style="margin-top:.2rem">Marcar</button></form></details>`;

  const bloquearForm =
    `<details class="card" style="margin-top:.5rem"><summary style="cursor:pointer;font-weight:600">+ Bloquear horário (almoço, folga, médico)</summary>` +
    `<form method="post" action="/painel/agenda/bloquear" style="margin-top:.6rem">` +
    `<input type="hidden" name="dia" value="${escapeHtml(o.dia)}">` +
    `<label class="d" for="bstaff">Profissional</label><select id="bstaff" name="profissional" required style="width:100%;margin:.3rem 0 .8rem;padding:.65rem;border-radius:.6rem;border:1px solid var(--line);background:var(--surface2);color:var(--txt);font:inherit">${opcoesStaff}</select>` +
    `<label class="d" for="bdata">Data</label><input id="bdata" name="data" type="date" value="${escapeHtml(o.dia)}" required ${campoCurto}>` +
    `<label class="d" for="bde">De</label><input id="bde" name="de" type="time" value="12:00" required ${campoCurto}>` +
    `<label class="d" for="bate">Até</label><input id="bate" name="ate" type="time" value="13:00" required ${campoCurto}>` +
    `<label class="d" for="bmot">Motivo</label><input id="bmot" name="motivo" maxlength=60 placeholder="Almoço" ${campoCurto}>` +
    `<button type="submit" class="cta">Bloquear</button></form></details>`;

  // Horários vagos: é o que enche agenda vazia. O botão monta a mensagem com os horários
  // do dia e abre o WhatsApp — o barbeiro escolhe para quem mandar. Nada é enviado
  // sozinho: disparo automático é o caminho mais curto para o número ser bloqueado.
  const vagosBloco = (() => {
    if (!o.servicoPadrao) return "";
    if (!o.vagos.length) {
      return `<h2>Horários vagos</h2><p class="empty">Nenhum horário livre neste dia.</p>`;
    }
    const porProfissional = new Map<string, string[]>();
    for (const v of o.vagos) {
      const lista = porProfissional.get(v.staff_id) ?? [];
      if (!lista.includes(fmtTime(v.starts_at, o.timezone))) lista.push(fmtTime(v.starts_at, o.timezone));
      porProfissional.set(v.staff_id, lista);
    }
    const linhas = [...porProfissional.entries()]
      .map(([id, horas]) => {
        const quem = o.staff.find((st) => st.staff_id === id)?.display_name ?? "Profissional";
        return `<div class="r"><span>${escapeHtml(quem)}</span><span style="text-align:right">${escapeHtml(horas.join(" · "))}</span></div>`;
      })
      .join("");
    const todas = o.vagos.map((v) => fmtTime(v.starts_at, o.timezone));
    const unicas = [...new Set(todas)].sort().slice(0, 8);
    const zap = String((o.row as Record<string, unknown>).whatsapp_public ?? "").replace(/\D/g, "");
    const servico = o.servicos.find((sv) => sv.service_id === o.servicoPadrao)?.name ?? "atendimento";
    const diaBonito = fmtDay(`${o.dia}T12:00:00Z`, o.timezone);
    const mensagem =
      `Oi! Tenho horário livre na ${o.nome} ${diaBonito}: ` +
      `${unicas.join(", ")}. ` +
      `Dá para ${servico.toLowerCase()}. Quer que eu reserve? ` +
      `${o.canonical}agendar`;
    return (
      `<h2>Horários vagos</h2><div class="card"><span class="d">${escapeHtml(servico)} · ${o.vagos.length} horários livres</span>${linhas}</div>` +
      `<a class="cta" style="display:block;text-align:center;text-decoration:none;margin-top:.5rem" href="https://wa.me/${escapeHtml(zap)}?text=${encodeURIComponent(mensagem)}" target="_blank" rel="noopener noreferrer">Divulgar no WhatsApp</a>` +
      `<p class="d" style="color:var(--muted);font-size:.72rem;margin:.4rem 0 .8rem">Abre o WhatsApp com a mensagem pronta. Você escolhe para quem enviar.</p>`
    );
  })();

  return appPage({
    row: o.row,
    name: o.nome,
    canonical: `${o.canonical}painel`,
    title: `Painel — ${o.nome}`,
    description: `Agenda e caixa da ${o.nome}.`,
    shell: "painel" as const,
    body:
      `<h1>Agenda</h1><p class="sub">${escapeHtml(o.papel)} · ${escapeHtml(fmtDay(`${o.dia}T12:00:00Z`, o.timezone))}</p>` +
      (o.erro ? `<p class="empty">${escapeHtml(o.erro)}</p>` : "") +
      (o.aviso ? `<p class="empty" style="border-color:var(--p)">${escapeHtml(o.aviso)}</p>` : "") +
      `${kpi}${nav}${filtroForm}${lista}${vagosBloco}${bloqueiosBloco}${novoForm}${bloquearForm}`,
  });
}


// O cliente não cria senha: informa nome e WhatsApp e o servidor abre a sessão.
// Isso basta para book_appointment, que exige auth.uid() e linha em customers.


// Dinheiro digitado por gente: "150", "150,00", "1.200,00", "89.90", "R$ 89,90".
// Ponto seguido de exatamente 2 dígitos é decimal; 3 dígitos é separador de milhar.
// Antes disso o parser só entendia ponto como milhar, e quem digitasse "89.90" via o
// valor virar R$ 8.990,00 — erro de 100x que passava calado.
function valorEmCentavos(bruto: string): number | null {
  const limpo = String(bruto ?? "").replace(/[^\d,.]/g, "");
  if (!limpo) return null;
  let numero: number;
  if (limpo.includes(",")) {
    numero = Number(limpo.replace(/\./g, "").replace(",", "."));
  } else {
    const partes = limpo.split(".");
    numero = partes.length === 2 && partes[1].length === 2 ? Number(limpo) : Number(limpo.replace(/\./g, ""));
  }
  return Number.isFinite(numero) ? Math.round(numero * 100) : null;
}

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
  const lista = (chave: string) => form.getAll(chave).map((valor) => String(valor).trim()).filter(Boolean);

  if (path?.[0] === "painel" && path[1] === "convite" && path.length === 2) {
    const code = texto("c");
    if (texto("senha") !== texto("senha2")) {
      return html(renderConvite({ row, nome, canonical, code, erro: "As duas senhas não são iguais." }), 400);
    }
    const aceito = await aceitarConvite({ slug, code, password: texto("senha") });
    if (!aceito.ok) {
      const mensagem =
        aceito.reason === "senha_curta"
          ? "A senha precisa de pelo menos 8 caracteres."
          : "Este convite não vale mais. Peça outro a quem te convidou.";
      return html(renderConvite({ row, nome, canonical, code, erro: mensagem }), 400);
    }
    const headers = new Headers({ location: "/painel" });
    for (const item of sessionHeaders(aceito.session)) headers.append("set-cookie", item);
    return new Response(null, { status: 303, headers });
  }

  if (path?.[0] === "painel" && path[1] === "equipe" && path[2] === "convidar") {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) {
      return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    }
    const tenant = await tenantBySlug(slug);
    if (!tenant) return neutral();
    const papel = await panelRole(tenant.id, userId);
    if (!papel) {
      return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    }
    const convite = await convidarMembro({
      tenantId: tenant.id,
      actorId: userId,
      email: texto("email"),
      nome: texto("nome"),
      role: texto("papel"),
    });
    const membros = await listMembers(tenant.id, userId);
    if (!convite.ok) {
      const mensagem =
        convite.reason === "email_invalido"
          ? "E-mail inválido."
          : convite.reason === "sem_permissao"
            ? "Só o dono pode convidar outro dono."
            : "Não foi possível criar o convite.";
      return html(renderEquipe({ row, nome, canonical, papel, membros, erro: mensagem }), 400);
    }
    const link = `${canonical}painel/convite?c=${convite.code}`;
    return html(renderEquipe({ row, nome, canonical, papel, membros, link }));
  }

  if (path?.[0] === "painel" && path[1] === "equipe" && path[2] === "revogar") {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) {
      return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    }
    const tenant = await tenantBySlug(slug);
    if (!tenant) return neutral();
    const ok = await revogarMembro(tenant.id, userId, texto("membro"));
    return new Response(null, {
      status: 303,
      headers: new Headers({ location: ok ? "/painel/equipe" : "/painel/equipe?erro=1" }),
    });
  }

  if (path?.[0] === "painel" && path[1] === "barbearia" && path.length === 2) {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    const tenant = await tenantBySlug(slug);
    if (!tenant) return neutral();
    const okMarca = await updateBranding(tenant.id, userId, {
      nome: texto("nome"),
      endereco: texto("endereco"),
      cidade: texto("cidade"),
      estado: texto("estado"),
      telefone: texto("telefone"),
      whatsapp: texto("whatsapp"),
      politica: texto("politica"),
      instagram: texto("instagram"),
      corPrimaria: texto("cor_primaria"),
      corSecundaria: texto("cor_secundaria"),
      corAcento: texto("cor_acento"),
      logo: texto("logo"),
    });
    const horas: Record<string, string | null> = {};
    for (const dia of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]) {
      const valor = texto("h_" + dia);
      horas[dia] = valor === "" ? null : valor;
    }
    const okHoras = await setHours(tenant.id, userId, horas);
    return new Response(null, { status: 303, headers: new Headers({ location: `/painel/barbearia?${okMarca && okHoras ? "ok=1" : "erro=1"}` }) });
  }

  if (path?.[0] === "painel" && path[1] === "servicos" && path.length === 2) {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    const tenant = await tenantBySlug(slug);
    if (!tenant) return neutral();
    const precoCents = valorEmCentavos(texto("preco"));
    const duracao = Number(texto("duracao").replace(/\D/g, ""));
    const ok = await upsertService(tenant.id, userId, {
      id: texto("servico") || null,
      nome: texto("nome"),
      descricao: texto("descricao"),
      duracao: Number.isFinite(duracao) ? duracao : 0,
      precoCents: precoCents ?? -1,
    });
    return new Response(null, { status: 303, headers: new Headers({ location: `/painel/servicos?${ok ? "ok=1" : "erro=1"}` }) });
  }

  if (path?.[0] === "painel" && path[1] === "servicos" && path[2] === "ativo") {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    const tenant = await tenantBySlug(slug);
    if (!tenant) return neutral();
    await setServiceActive(tenant.id, userId, texto("servico"), texto("ativo") === "1");
    return new Response(null, { status: 303, headers: new Headers({ location: "/painel/servicos?ok=1" }) });
  }

  if (path?.[0] === "painel" && path[1] === "produtos" && path.length === 2) {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    const tenant = await tenantBySlug(slug);
    if (!tenant) return neutral();
    const preco = valorEmCentavos(texto("preco"));
    const precoDe = valorEmCentavos(texto("preco_de"));
    if (preco === null || preco <= 0) {
      return new Response(null, { status: 303, headers: new Headers({ location: "/painel/produtos?erro=1" }) });
    }
    const ok = await upsertProduct({
      tenantId: tenant.id,
      actorId: userId,
      productId: texto("produto") || null,
      nome: texto("nome"),
      descricao: texto("descricao"),
      categoria: texto("categoria") || "produto",
      precoCents: preco,
      precoDeCents: precoDe !== null && precoDe > preco ? precoDe : null,
      detalhes: texto("detalhes"),
      marca: texto("marca"),
      tamanho: texto("tamanho"),
    });
    return new Response(null, { status: 303, headers: new Headers({ location: `/painel/produtos?${ok ? "ok=1" : "erro=1"}` }) });
  }

  if (path?.[0] === "painel" && path[1] === "logo") {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    const tenant = await tenantBySlug(slug);
    if (!tenant) return neutral();

    if (texto("remover") === "1") {
      const ok = await setTenantLogo(tenant.id, userId, null);
      return new Response(null, { status: 303, headers: new Headers({ location: `/painel/barbearia?${ok ? "ok=1" : "erro=1"}` }) });
    }

    const arquivo = form.get("arquivo");
    if (!(arquivo instanceof File) || arquivo.size === 0) {
      return new Response(null, { status: 303, headers: new Headers({ location: "/painel/barbearia?erro=logo" }) });
    }
    const tipo = arquivo.type.toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(tipo) || arquivo.size > 10 * 1024 * 1024) {
      return new Response(null, { status: 303, headers: new Headers({ location: "/painel/barbearia?erro=logo" }) });
    }
    const url = await subirLogo(tenant.id, { bytes: await arquivo.arrayBuffer(), tipo });
    if (!url) {
      return new Response(null, { status: 303, headers: new Headers({ location: "/painel/barbearia?erro=logo" }) });
    }
    const ok = await setTenantLogo(tenant.id, userId, url);
    return new Response(null, { status: 303, headers: new Headers({ location: `/painel/barbearia?${ok ? "ok=1" : "erro=logo"}` }) });
  }

  if (path?.[0] === "painel" && path[1] === "produtos" && path[2] === "foto") {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    const tenant = await tenantBySlug(slug);
    if (!tenant) return neutral();
    const produto = texto("produto");

    if (texto("remover") === "1") {
      const ok = await setProductImage(tenant.id, userId, produto, null);
      return new Response(null, { status: 303, headers: new Headers({ location: `/painel/produtos?${ok ? "ok=1" : "erro=1"}` }) });
    }

    const arquivo = form.get("arquivo");
    if (!(arquivo instanceof File) || arquivo.size === 0) {
      return new Response(null, { status: 303, headers: new Headers({ location: "/painel/produtos?erro=foto" }) });
    }
    const tipo = arquivo.type.toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(tipo) || arquivo.size > 5 * 1024 * 1024) {
      return new Response(null, { status: 303, headers: new Headers({ location: "/painel/produtos?erro=foto" }) });
    }
    const url = await subirFotoProduto(tenant.id, produto, { bytes: await arquivo.arrayBuffer(), tipo });
    if (!url) {
      return new Response(null, { status: 303, headers: new Headers({ location: "/painel/produtos?erro=foto" }) });
    }
    const ok = await setProductImage(tenant.id, userId, produto, url);
    return new Response(null, { status: 303, headers: new Headers({ location: `/painel/produtos?${ok ? "ok=1" : "erro=foto"}` }) });
  }

  if (path?.[0] === "painel" && path[1] === "produtos" && path[2] === "ativo") {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    const tenant = await tenantBySlug(slug);
    if (!tenant) return neutral();
    const ok = await setProductActive(tenant.id, userId, texto("produto"), texto("ativo") === "1");
    return new Response(null, { status: 303, headers: new Headers({ location: `/painel/produtos?${ok ? "ok=1" : "erro=1"}` }) });
  }

  if (path?.[0] === "painel" && path[1] === "despesas" && path.length === 2) {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    const tenant = await tenantBySlug(slug);
    if (!tenant) return neutral();
    const valorCents = valorEmCentavos(texto("valor"));
    const dataBruta = texto("data");
    const descricao = texto("descricao");
    const erro =
      descricao.trim().length < 2
        ? "descricao"
        : !/^\d{4}-\d{2}-\d{2}$/.test(dataBruta)
          ? "data"
          : valorCents === null || valorCents <= 0
            ? "valor"
            : null;
    if (erro) {
      return new Response(null, { status: 303, headers: new Headers({ location: `/painel/despesas?erro=${erro}` }) });
    }
    const ok = await addExpense({
      actorId: userId,
      tenantId: tenant.id,
      descricao,
      categoria: texto("categoria") || "outros",
      valorCents: valorCents as number,
      data: dataBruta,
      meio: texto("meio") || "dinheiro",
    });
    const mesDaDespesa = dataBruta.slice(0, 7);
    return new Response(null, {
      status: 303,
      headers: new Headers({ location: `/painel/despesas?mes=${mesDaDespesa}&${ok ? "ok=1" : "erro=1"}` }),
    });
  }

  if (path?.[0] === "painel" && path[1] === "despesas" && path[2] === "cancelar") {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    const tenant = await tenantBySlug(slug);
    if (!tenant) return neutral();
    const ok = await cancelExpense(userId, tenant.id, texto("despesa"));
    return new Response(null, { status: 303, headers: new Headers({ location: `/painel/despesas?${ok ? "ok=1" : "erro=1"}` }) });
  }

  if (path?.[0] === "painel" && path[1] === "equipe" && path[2] === "acesso") {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    const tenant = await tenantBySlug(slug);
    if (!tenant) return neutral();
    const staffId = texto("profissional");
    const email = texto("email");
    const papel = ["owner", "manager", "staff"].includes(texto("papel")) ? texto("papel") : "staff";
    const nome = (await panelStaff(tenant.id, userId)).find((st) => st.staff_id === staffId)?.display_name ?? "Profissional";
    const convite = await convidarMembro({ tenantId: tenant.id, actorId: userId, email, nome, role: papel });
    if (!convite.ok) {
      return new Response(null, { status: 303, headers: new Headers({ location: `/painel/equipe?erro=${convite.reason === "email_invalido" ? "email" : "1"}` }) });
    }
    // Liga o profissional ao login: sem isso o convite dar acesso ao painel mas a agenda
    // continuaria sem saber quem é.
    const achado = await usuarioPorEmail(email);
    if (achado) await linkStaffUser(tenant.id, userId, staffId, achado);
    const base = canonical.replace(/\/$/, "");
    return new Response(null, {
      status: 303,
      headers: new Headers({ location: `/painel/equipe?ok=acesso&link=${encodeURIComponent(`${base}/painel/convite?c=${convite.code}`)}` }),
    });
  }

  if (path?.[0] === "painel" && path[1] === "equipe" && path[2] === "profissional") {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    const tenant = await tenantBySlug(slug);
    if (!tenant) return neutral();
    const ok = await setStaffActive(tenant.id, userId, texto("profissional"), texto("ativo") === "1");
    return new Response(null, { status: 303, headers: new Headers({ location: `/painel/equipe?${ok ? "ok=1" : "erro=1"}` }) });
  }

  if (path?.[0] === "painel" && path[1] === "equipe" && path[2] === "servicos") {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    const tenant = await tenantBySlug(slug);
    if (!tenant) return neutral();
    const ok = await setStaffServices(tenant.id, userId, texto("profissional"), lista("servico"));
    return new Response(null, { status: 303, headers: new Headers({ location: `/painel/equipe?${ok ? "ok=servicos" : "erro=1"}` }) });
  }

  if (path?.[0] === "painel" && path[1] === "equipe" && path[2] === "novo") {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    const tenant = await tenantBySlug(slug);
    if (!tenant) return neutral();
    const pct = Number(texto("percentual").replace(",", "."));
    const ok = Number.isFinite(pct) && pct >= 0 && pct <= 100
      ? await addStaff(tenant.id, userId, texto("nome"), Math.round(pct * 100), lista("servico"))
      : false;
    return new Response(null, { status: 303, headers: new Headers({ location: `/painel/equipe?${ok ? "ok=1" : "erro=1"}` }) });
  }

  if (path?.[0] === "painel" && path[1] === "comissao" && path.length === 2) {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    const tenant = await tenantBySlug(slug);
    if (!tenant) return neutral();
    const pct = Number(texto("percentual").replace(",", "."));
    const ok = Number.isFinite(pct) && pct >= 0 && pct <= 100
      ? await setCommission(userId, tenant.id, texto("profissional"), Math.round(pct * 100))
      : false;
    return new Response(null, { status: 303, headers: new Headers({ location: `/painel/equipe?${ok ? "ok=comissao" : "erro=1"}` }) });
  }

  if (path?.[0] === "painel" && path[1] === "agenda" && path[2] === "novo") {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    const tenant = await tenantBySlug(slug);
    if (!tenant) return neutral();
    const data = texto("data");
    const hora = texto("hora");
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : todayIn(timezone);
    const destino = `/painel/agenda?dia=${encodeURIComponent(dia)}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(hora)) {
      return new Response(null, { status: 303, headers: new Headers({ location: `${destino}&erro=1` }) });
    }
    const inicio = `${data}T${hora}:00${offsetEm(timezone, `${data}T12:00:00Z`)}`;
    const cliente = await clienteDeBalcao({
      tenantId: tenant.id,
      nome: texto("nome"),
      telefone: texto("telefone"),
    });
    if (!cliente) {
      return new Response(null, { status: 303, headers: new Headers({ location: `${destino}&erro=cliente` }) });
    }
    const criado = await bookForCustomer({
      actorId: userId,
      tenantId: tenant.id,
      staffId: texto("profissional"),
      serviceId: texto("servico"),
      startsAt: inicio,
      customerId: cliente.customerId,
    });
    // Horário ocupado não pode deixar cliente fantasma no CRM.
    if (!criado && cliente.criado) {
      await abandonarCliente(tenant.id, cliente.customerId);
    }
    return new Response(null, {
      status: 303,
      headers: new Headers({ location: `${destino}${criado ? "&ok=1" : "&erro=ocupado"}` }),
    });
  }

  if (path?.[0] === "painel" && path[1] === "agenda" && path[2] === "bloquear") {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    const tenant = await tenantBySlug(slug);
    if (!tenant) return neutral();
    const data = texto("data");
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : todayIn(timezone);
    const destino = `/painel/agenda?dia=${encodeURIComponent(dia)}`;
    const de = texto("de");
    const ate = texto("ate");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(de) || !/^\d{2}:\d{2}$/.test(ate) || de >= ate) {
      return new Response(null, { status: 303, headers: new Headers({ location: `${destino}&erro=1` }) });
    }
    const desloc = offsetEm(timezone, `${data}T12:00:00Z`);
    const ok = await blockTime({
      actorId: userId,
      tenantId: tenant.id,
      staffId: texto("profissional"),
      from: `${data}T${de}:00${desloc}`,
      to: `${data}T${ate}:00${desloc}`,
      reason: texto("motivo"),
    });
    return new Response(null, {
      status: 303,
      headers: new Headers({ location: `${destino}${ok ? "&ok=1" : "&erro=ocupado"}` }),
    });
  }

  if (path?.[0] === "painel" && path[1] === "agenda" && path[2] === "liberar") {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    const tenant = await tenantBySlug(slug);
    if (!tenant) return neutral();
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(texto("dia")) ? texto("dia") : todayIn(timezone);
    await unblockTime(userId, tenant.id, texto("bloqueio"));
    return new Response(null, {
      status: 303,
      headers: new Headers({ location: `/painel/agenda?dia=${encodeURIComponent(dia)}&ok=1` }),
    });
  }

  if (path?.[0] === "painel" && path[1] === "remarcar" && path.length === 2) {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    const data = texto("data");
    const hora = texto("hora");
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(texto("dia")) ? texto("dia") : todayIn(timezone);
    const destino = `/painel/agenda?dia=${encodeURIComponent(dia)}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(hora)) {
      return new Response(null, { status: 303, headers: new Headers({ location: `${destino}&erro=1` }) });
    }
    const ok = await rescheduleAppointment(
      userId,
      texto("agendamento"),
      `${data}T${hora}:00${offsetEm(timezone, `${data}T12:00:00Z`)}`,
    );
    return new Response(null, {
      status: 303,
      headers: new Headers({ location: `${destino}${ok ? "&ok=1" : "&erro=ocupado"}` }),
    });
  }

  if (path?.[0] === "painel" && path[1] === "receber" && path.length === 2) {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) {
      return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    }
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(texto("dia")) ? texto("dia") : todayIn(timezone);
    // BBT primeiro: se o resgate falhar (saldo, teto, repetição), o pagamento não entra
    // pela metade — o cliente não fica com desconto sem o sistema saber.
    const bbtCents = valorEmCentavos(texto("bbt")) ?? 0;
    if (bbtCents > 0) {
      const tenant = await tenantBySlug(slug);
      const okBbt = tenant ? await debitCashback(userId, tenant.id, texto("agendamento"), bbtCents, "BBT usado no atendimento") : false;
      if (!okBbt) {
        return new Response(null, {
          status: 303,
          headers: new Headers({ location: `/painel/agenda?dia=${encodeURIComponent(dia)}&erro=bbt` }),
        });
      }
    }
    const recebido = await recordPayment(userId, texto("agendamento"), texto("meio"), undefined, bbtCents);
    // 100% em BBT: a função devolve pagamento nulo e valor zero, e isso é sucesso.
    return new Response(null, {
      status: 303,
      headers: new Headers({
        location: `/painel/agenda?dia=${encodeURIComponent(dia)}${recebido || bbtCents > 0 ? "&ok=1" : "&erro=1"}`,
      }),
    });
  }

  if (path?.[0] === "painel" && path[1] === "meta" && path.length === 2) {
    const { accessToken, userId } = readSession(request);
    if (!accessToken || !userId) {
      return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
    }
    const tenant = await tenantBySlug(slug);
    if (!tenant) return neutral();
    const cents = valorEmCentavos(texto("meta")) ?? 0;
    if (cents < 0) {
      return new Response(null, { status: 303, headers: new Headers({ location: "/painel/financeiro?erro=1" }) });
    }
    await setDailyGoal(tenant.id, userId, cents);
    return new Response(null, { status: 303, headers: new Headers({ location: "/painel/financeiro" }) });
  }

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
  // O middleware gera o nonce e o coloca no header da REQUISICAO; o navegador so aceita
  // script inline marcado com ele.
  const nonce = request.headers.get("x-nonce") ?? "";
  if (path && path.length > 0) {
    if (path[0] === "produtos" && path.length === 2 && path[1]) {
      const alvo = decodeURIComponent(String(path[1]));
      const produto = await getProduct(slug, alvo);
      if (!produto) return neutral();
      const todos = await listProducts(slug);
      const parecidos = todos
        .filter((item) => item.category === produto.category && item.slug !== produto.slug)
        .slice(0, 4)
        .map((item) => ({ slug: item.slug, name: item.name, price_cents: Number(item.price_cents), image_url: item.image_url }));
      return html(renderProduto({ row, nome, canonical, produto, whatsapp: row.whatsapp_public, parecidos }));
    }
    if (path[0] === "produtos" && path.length === 1) {
      const produtos = await listProducts(slug);
      return html(renderProdutos({ row, nome, canonical, produtos, whatsapp: row.whatsapp_public }));
    }
    if (path[0] === "painel" && path[1] === "entrar") {
      return html(renderPainelEntrar({ row, nome, canonical }));
    }
    if (path[0] === "painel" && path[1] === "convite" && path.length === 2) {
      const code = (new URL(request.url).searchParams.get("c") ?? "").trim();
      return html(renderConvite({ row, nome, canonical, code }));
    }
    if (path[0] === "painel" && path[1] === "equipe" && path.length === 2) {
      const { accessToken, userId } = readSession(request);
      if (!accessToken || !userId) {
        return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
      }
      const tenant = await tenantBySlug(slug);
      if (!tenant) return neutral();
      const papel = await panelRole(tenant.id, userId);
      if (!papel) {
        return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
      }
      const membros = await listMembers(tenant.id, userId);
      const busca = new URL(request.url).searchParams;
      const erro = busca.get("erro")
        ? busca.get("erro") === "permissao"
          ? "Só dono ou gerente pode mexer na equipe."
          : "Não foi possível concluir a operação."
        : undefined;
      const hojeEq = todayIn(timezone);
      const inicioEq = `${hojeEq.slice(0, 7)}-01T00:00:00${offsetEm(timezone, `${hojeEq.slice(0, 7)}-01T12:00:00Z`)}`;
      const proxEq = new Date(`${hojeEq.slice(0, 7)}-01T12:00:00Z`);
      proxEq.setUTCMonth(proxEq.getUTCMonth() + 1);
      const [comissoes, profissionais, servicosPainel] = await Promise.all([
        panelCommissions(tenant.id, inicioEq, `${proxEq.toISOString().slice(0, 10)}T00:00:00${offsetEm(timezone, `${proxEq.toISOString().slice(0, 10)}T12:00:00Z`)}`),
        panelStaff(tenant.id, userId),
        panelServices(tenant.id, userId),
      ]);
      return html(
        renderEquipe({
          row,
          nome,
          canonical,
          papel,
          membros,
          comissoes,
          profissionais: profissionais.map((st) => ({
            staff_id: st.staff_id,
            display_name: st.display_name,
            active: st.active,
            commission_bps: Number(st.commission_bps) || 0,
            access_email: st.access_email,
            access_role: st.access_role,
            service_ids: st.service_ids ?? [],
          })),
          servicos: servicosPainel.filter((sv) => sv.active).map((sv) => ({ service_id: sv.service_id, name: sv.name })),
          link: busca.get("link") ?? undefined,
          ok: busca.get("ok") ?? undefined,
          erro,
        }),
      );
    }
    if (path[0] === "painel" && path[1] === "agenda" && path.length === 2) {
      const { accessToken, userId } = readSession(request);
      if (!accessToken || !userId) {
        return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
      }
      const tenant = await tenantBySlug(slug);
      if (!tenant) return neutral();
      const papel = await panelRole(tenant.id, userId);
      if (!papel) {
        const headers = new Headers({ location: "/painel/entrar" });
        for (const item of clearSessionHeaders()) headers.append("set-cookie", item);
        return new Response(null, { status: 303, headers });
      }
      const busca = new URL(request.url).searchParams;
      const diaBruto = busca.get("dia") ?? "";
      const dia = /^\d{4}-\d{2}-\d{2}$/.test(diaBruto) ? diaBruto : todayIn(timezone);
      const { from, to } = janelaDoDia(dia, timezone);
      const filtro = (busca.get("staff") ?? "").trim();
      const [resumo, agenda, staffLista, servicos, bloqueios] = await Promise.all([
        panelResumo(tenant.id, from, to),
        panelAgenda(tenant.id, from, to, filtro || null),
        listStaff(slug),
        panelServices(tenant.id, userId),
        panelBlocks(tenant.id, from, to),
      ]);
      const erro = busca.get("erro")
        ? busca.get("erro") === "ocupado"
          ? "Esse horário já está ocupado."
          : busca.get("erro") === "cliente"
            ? "Cliente não identificado — confira nome e telefone."
            : busca.get("erro") === "bbt"
              ? "BBT não aplicado: confira o saldo do cliente e o valor do serviço."
              : "Não foi possível concluir a operação."
        : undefined;
      const aviso = busca.get("ok") ? "Feito." : undefined;
      const ativos = servicos.filter((sv) => sv.active);
      const vagos = ativos[0] ? await listFreeSlots(slug, ativos[0].service_id, dia) : [];
      return html(
        renderPainel({
          row,
          nome,
          canonical,
          timezone,
          papel,
          dia,
          resumo,
          agenda,
          staff: staffLista.map((st) => ({ staff_id: st.staff_id, display_name: st.display_name })),
          servicos: servicos.filter((sv) => sv.active).map((sv) => ({ service_id: sv.service_id, name: sv.name, duration_min: Number(sv.duration_min), price_cents: Number(sv.price_cents) })),
          bloqueios,
          vagos: vagos.map((v) => ({ staff_id: v.staff_id, starts_at: v.starts_at })),
          servicoPadrao: ativos[0]?.service_id ?? null,
          filtro,
          erro,
          aviso,
        }),
      );
    }
    if (path[0] === "painel" && path[1] === "clientes" && path.length === 2) {
      const { accessToken, userId } = readSession(request);
      if (!accessToken || !userId) {
        return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
      }
      const tenant = await tenantBySlug(slug);
      if (!tenant) return neutral();
      const papel = await panelRole(tenant.id, userId);
      if (!papel) {
        return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
      }
      const busca = new URL(request.url).searchParams;
      const termo = (busca.get("q") ?? "").trim();
      const filtro = busca.get("filtro") === "sumidos" ? "sumidos" : "todos";
      let clientes = await panelCustomers(tenant.id, userId, termo);
      if (filtro === "sumidos") {
        clientes = clientes.filter((c) => c.dias_sem_voltar !== null && c.dias_sem_voltar >= 45);
      }
      return html(renderClientes({ row, nome, canonical, timezone, papel, busca: termo, filtro, clientes }));
    }
    if (path[0] === "painel" && path[1] === "financeiro" && path.length === 2) {
      const { accessToken, userId } = readSession(request);
      if (!accessToken || !userId) {
        return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
      }
      const tenant = await tenantBySlug(slug);
      if (!tenant) return neutral();
      const papel = await panelRole(tenant.id, userId);
      if (!papel) {
        return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
      }
      const hoje = todayIn(timezone);
      const dia = janelaDoDia(hoje, timezone);
      const semana = { from: `${somaDia(hoje, -6)}T00:00:00${offsetEm(timezone, `${somaDia(hoje, -6)}T12:00:00Z`)}`, to: dia.to };
      const primeiroDoMes = `${hoje.slice(0, 7)}-01`;
      const proximoMes = new Date(`${primeiroDoMes}T12:00:00Z`);
      proximoMes.setUTCMonth(proximoMes.getUTCMonth() + 1);
      const mes = {
        from: `${primeiroDoMes}T00:00:00${offsetEm(timezone, `${primeiroDoMes}T12:00:00Z`)}`,
        to: `${proximoMes.toISOString().slice(0, 10)}T00:00:00${offsetEm(timezone, `${proximoMes.toISOString().slice(0, 10)}T12:00:00Z`)}`,
      };
      const [atual, semanaSoma, mesSoma] = await Promise.all([
        panelFinanceiro(tenant.id, userId, dia.from, dia.to),
        panelFinanceiro(tenant.id, userId, semana.from, semana.to),
        panelFinanceiro(tenant.id, userId, mes.from, mes.to),
      ]);
      const erro = new URL(request.url).searchParams.get("erro") ? "Não foi possível salvar a meta." : undefined;
      return html(
        renderFinanceiro({
          row,
          nome,
          canonical,
          timezone,
          papel,
          hoje,
          dia: Number(atual.recebido_cents) || 0,
          semana: Number(semanaSoma.recebido_cents) || 0,
          mes: Number(mesSoma.recebido_cents) || 0,
          atual,
          erro,
        }),
      );
    }
    if (path[0] === "painel" && path[1] === "barbearia" && path.length === 2) {
      const { accessToken, userId } = readSession(request);
      if (!accessToken || !userId) {
        return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
      }
      const tenant = await tenantBySlug(slug);
      if (!tenant) return neutral();
      const papel = await panelRole(tenant.id, userId);
      if (!papel) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
      const busca = new URL(request.url).searchParams;
      const erroBarbearia =
        busca.get("erro") === "logo"
          ? "Logo não aceito: use jpg, png ou webp (até 10 MB)."
          : busca.get("erro")
            ? "Não foi possível salvar — confira os campos."
            : undefined;
      return html(renderBarbearia({ row, nome, canonical, papel, nonce, ok: busca.get("ok") === "1", erro: erroBarbearia }));
    }
    if (path[0] === "painel" && path[1] === "servicos" && path.length === 2) {
      const { accessToken, userId } = readSession(request);
      if (!accessToken || !userId) {
        return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
      }
      const tenant = await tenantBySlug(slug);
      if (!tenant) return neutral();
      const papel = await panelRole(tenant.id, userId);
      if (!papel) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
      const servicos = await panelServices(tenant.id, userId);
      const busca = new URL(request.url).searchParams;
      return html(renderServicos({ row, nome, canonical, papel, servicos, ok: busca.get("ok") === "1", erro: busca.get("erro") ? "Não foi possível salvar — confira nome, duração e preço." : undefined }));
    }
    if (path[0] === "painel" && path[1] === "despesas" && path.length === 2) {
      const { accessToken, userId } = readSession(request);
      if (!accessToken || !userId) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
      const tenant = await tenantBySlug(slug);
      if (!tenant) return neutral();
      const papel = await panelRole(tenant.id, userId);
      if (!papel) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
      const hoje = todayIn(timezone);
      const mesPedido = new URL(request.url).searchParams.get("mes") ?? "";
      const mesBase = /^\d{4}-\d{2}$/.test(mesPedido) ? mesPedido : hoje.slice(0, 7);
      const primeiro = `${mesBase}-01`;
      const proximo = new Date(`${primeiro}T12:00:00Z`);
      proximo.setUTCMonth(proximo.getUTCMonth() + 1);
      const ultimo = new Date(proximo.getTime() - 86400000).toISOString().slice(0, 10);
      const inicioMes = `${primeiro}T00:00:00${offsetEm(timezone, `${primeiro}T12:00:00Z`)}`;
      const fimMes = `${proximo.toISOString().slice(0, 10)}T00:00:00${offsetEm(timezone, `${proximo.toISOString().slice(0, 10)}T12:00:00Z`)}`;
      const [despesas, resumoMes] = await Promise.all([
        panelExpenses(tenant.id, primeiro, ultimo),
        panelResultado(tenant.id, inicioMes, fimMes),
      ]);
      const busca = new URL(request.url).searchParams;
      return html(
        renderDespesas({
          row,
          nome,
          canonical,
          papel,
          mes: mesBase,
          despesas,
          resultado: resumoMes,
          ok: busca.get("ok") === "1",
          erro:
            busca.get("erro") === "valor"
              ? "Valor não entendido. Escreva como 150 ou 150,00."
              : busca.get("erro") === "data"
                ? "Data inválida."
                : busca.get("erro") === "descricao"
                  ? "Descrição muito curta — escreva o que foi comprado."
                  : busca.get("erro")
                    ? "Não foi possível lançar a despesa."
                    : undefined,
        }),
      );
    }
    if (path[0] === "painel" && path[1] === "produtos" && path.length === 2) {
      const { accessToken, userId } = readSession(request);
      if (!accessToken || !userId) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
      const tenant = await tenantBySlug(slug);
      if (!tenant) return neutral();
      const papel = await panelRole(tenant.id, userId);
      if (!papel) return new Response(null, { status: 303, headers: new Headers({ location: "/painel/entrar" }) });
      const produtos = await panelProducts(tenant.id, userId);
      const busca = new URL(request.url).searchParams;
      return html(
        renderProdutosPainel({
          row,
          nome,
          canonical,
          papel,
          produtos,
          ok: busca.get("ok") === "1",
          erro:
            busca.get("erro") === "logo"
              ? "Logo não aceito: use jpg, png ou webp de até 2 MB."
              : busca.get("erro") === "foto"
              ? "Foto não aceita: use jpg, png ou webp de até 5 MB."
              : busca.get("erro")
                ? "Não foi possível salvar — confira nome e preço."
                : undefined,
        }),
      );
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
      const hoje = todayIn(timezone);
      const { from, to } = janelaDoDia(hoje, timezone);
      const [resumo, agenda, clientes] = await Promise.all([
        panelResumo(tenant.id, from, to),
        panelAgenda(tenant.id, from, to),
        panelCustomers(tenant.id, userId),
      ]);
      const sumidos = clientes.filter((c) => c.dias_sem_voltar !== null && c.dias_sem_voltar >= 45).length;
      return html(
        renderVisaoGeral({
          row,
          nome,
          canonical,
          timezone,
          papel,
          dia: hoje,
          resumo,
          agenda,
          clientes: clientes.length,
          sumidos,
        }),
      );
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
  // Quem já está logado e é da equipe vê o atalho para o painel na home.
  const sessao = readSession(request);
  let papel: string | null = null;
  if (sessao.accessToken && sessao.userId) {
    const tenant = await tenantBySlug(slug).catch(() => null);
    if (tenant) papel = await panelRole(tenant.id, sessao.userId).catch(() => null);
  }
  const [staffHome, produtosHome] = await Promise.all([listStaff(slug), listProducts(slug)]);
  const pagina = renderHome({ row, slug, nome, timezone, canonical, services, staff: staffHome, produtos: produtosHome, papel });
  return new Response(pagina, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
