// Identificação do cliente da barbearia, sem senha e sem SMS.
//
// O cliente informa nome e WhatsApp. O servidor — que tem a chave secreta — cria ou
// reaproveita o usuário em auth.users, garante a linha em public.customers e abre uma
// sessão de verdade para ele. A partir daí book_appointment funciona, porque
// auth.uid() existe e a linha de customer existe.
//
// LIMITE CONHECIDO E DECLARADO: como não há código de confirmação, quem souber o
// telefone de outra pessoa entra como ela. O próximo degrau é o código de 6 dígitos
// por WhatsApp (a instância Evolution já está no ar) — sem isso, isto é identificação,
// não autenticação.
//
// As variáveis são lidas por concatenação de propósito: o Next inlina
// `process.env.SUPABASE_...` no build e o valor congelado vaza para o bundle.

const env = (name: string): string | undefined => process.env[name];

function projectUrl(): string | null {
  const url = env(["SUPABASE", "URL"].join("_"));
  return url ? url.replace(/\/$/, "") : null;
}

function publishableKey(): string | undefined {
  return env(["SUPABASE", "PUBLISHABLE", "KEY"].join("_"));
}

function secretKey(): string | undefined {
  return env(["SUPABASE", "SECRET", "KEY"].join("_"));
}

export type Session = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  expiresIn: number;
};

export type Resultado =
  | { ok: true; session: Session; customerId: string | null }
  | {
      ok: false;
      reason:
        | "sem_supabase"
        | "dados_invalidos"
        | "email_em_uso"
        | "senha_incorreta"
        | "telefone_invalido"
        | "falha";
    };

const COOKIE_AT = "bc_at";
const COOKIE_RT = "bc_rt";
const COOKIE_UID = "bc_uid";

export function normalizePhone(raw: string): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  // 10 ou 11 dígitos com DDD; aceita quem digita o 55 na frente
  const local = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length < 10 || local.length > 11) return null;
  return local;
}

function emailOk(raw: string): boolean {
  const value = String(raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value) && value.length <= 254;
}

// 8 caracteres é o mínimo do GoTrue. Exigir mais que isso no balcão de uma barbearia
// só empurra o cliente para "12345678".
function passwordOk(raw: string): boolean {
  return String(raw ?? "").length >= 8;
}

// --- server_api: só o servidor, com a chave secreta ------------------------------

async function rpcServer<T>(fn: string, body: Record<string, unknown>): Promise<T[]> {
  const url = projectUrl();
  const key = secretKey();
  if (!url || !key) return [];
  const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "content-profile": "server_api",
      "accept-profile": "server_api",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  });
  // O corpo do erro do banco traz o motivo real (só_dono_cria_dono, sem_permissao);
  // sem ele, todo erro virava "falhou" e o usuário não sabia o que corrigir.
  if (!response.ok) {
    const corpo = await response.text().catch(() => "");
    throw new Error(`server_api.${fn} ${response.status} ${corpo.slice(0, 300)}`);
  }
  const json: unknown = await response.json();
  // Função que retorna TABLE devolve array; função que retorna escalar (text, bigint)
  // devolve o valor solto. Tratar só array fazia panel_role virar null e o barbeiro
  // levar 403 mesmo sendo dono da barbearia.
  if (Array.isArray(json)) return json as T[];
  return json === null ? [] : ([json] as T[]);
}

type TenantRow = { id: string; display_name: string; timezone: string; status: string };

export async function tenantBySlug(slug: string): Promise<TenantRow | null> {
  const rows = await rpcServer<TenantRow>("tenant_by_slug", { p_slug: slug });
  return rows[0] ?? null;
}

// --- auth: cria usuário, define senha efêmera, abre sessão ----------------------

async function adminCall(path: string, method: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const url = projectUrl();
  const key = secretKey();
  if (!url || !key) return { status: 503, json: null };
  const response = await fetch(`${url}/auth/v1/admin/${path}`, {
    method,
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  const json: unknown = await response.json().catch(() => null);
  return { status: response.status, json };
}

// Devolve o status junto porque 422 (e-mail já cadastrado) é resposta de negócio,
// não erro interno: quem já tem conta precisa ver "entre com sua senha", não "falhou".
async function createUser(
  email: string,
  password: string,
  fullName: string,
  phone: string,
): Promise<{ id: string | null; status: number }> {
  const { status, json } = await adminCall("users", "POST", {
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone },
  });
  if (status === 200 || status === 201) {
    const id = (json as { id?: string } | null)?.id;
    return { id: typeof id === "string" ? id : null, status };
  }
  return { id: null, status };
}

async function signIn(email: string, password: string): Promise<Session | null> {
  const url = projectUrl();
  const key = publishableKey();
  if (!url || !key) return null;
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  const json = (await response.json()) as Record<string, unknown>;
  const accessToken = typeof json.access_token === "string" ? json.access_token : null;
  const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : null;
  const user = json.user as { id?: string } | undefined;
  if (!accessToken || !refreshToken || !user?.id) return null;
  return {
    accessToken,
    refreshToken,
    userId: user.id,
    expiresIn: Number(json.expires_in ?? 3600),
  };
}

async function garantirCliente(o: {
  tenantId: string;
  userId: string;
  nome: string;
  telefone: string | null;
  email: string;
}): Promise<string | null> {
  const rows = await rpcServer<{ ensure_customer: string }>("ensure_customer", {
    p_tenant: o.tenantId,
    p_user: o.userId,
    p_name: o.nome,
    p_phone: o.telefone,
    p_email: o.email,
  }).catch(() => []);
  return rows[0]?.ensure_customer ?? null;
}

// Cadastro: a senha é a que o cliente escolheu, e ele já sai daqui dentro.
//
// O usuário nasce confirmado (email_confirm) porque o projeto está com confirmação de
// e-mail ligada e sem SMTP próprio: pelo /signup ele ficaria sem sessão esperando um
// e-mail que talvez nunca chegue. A consequência, declarada: não há prova de que o
// e-mail existe. Para exigir prova, é ligar SMTP e trocar isto por signup + link.
export async function cadastrar(o: {
  slug: string;
  name: string;
  phone: string;
  email: string;
  password: string;
}): Promise<Resultado> {
  if (!projectUrl() || !secretKey() || !publishableKey()) return { ok: false, reason: "sem_supabase" };
  const email = String(o.email ?? "").trim().toLowerCase();
  const nome = String(o.name ?? "").trim();
  if (!nome || !emailOk(email) || !passwordOk(o.password)) return { ok: false, reason: "dados_invalidos" };
  const telefone = normalizePhone(o.phone);

  try {
    const tenant = await tenantBySlug(o.slug);
    if (!tenant) return { ok: false, reason: "falha" };

    const criado = await createUser(email, o.password, nome, telefone ?? String(o.phone ?? "").trim());
    if (!criado.id) {
      if (criado.status === 422 || criado.status === 400) return { ok: false, reason: "email_em_uso" };
      return { ok: false, reason: "falha" };
    }

    const session = await signIn(email, o.password);
    if (!session) return { ok: false, reason: "falha" };

    const customerId = await garantirCliente({
      tenantId: tenant.id,
      userId: session.userId,
      nome,
      telefone,
      email,
    });
    return { ok: true, session, customerId };
  } catch {
    return { ok: false, reason: "falha" };
  }
}

// Entrada de quem já tem conta. Não completa nome: quem manda no nome é o cadastro.
export async function entrar(o: { slug: string; email: string; password: string }): Promise<Resultado> {
  if (!projectUrl() || !secretKey() || !publishableKey()) return { ok: false, reason: "sem_supabase" };
  const email = String(o.email ?? "").trim().toLowerCase();
  if (!emailOk(email) || !passwordOk(o.password)) return { ok: false, reason: "senha_incorreta" };

  try {
    const session = await signIn(email, o.password);
    if (!session) return { ok: false, reason: "senha_incorreta" };
    const tenant = await tenantBySlug(o.slug);
    if (!tenant) return { ok: false, reason: "falha" };
    // D3: a identidade é uma só. Quem se cadastrou em outra barbearia chega aqui sem
    // a linha de customer desta — a função garante a linha sem apagar o nome.
    const customerId = await garantirCliente({
      tenantId: tenant.id,
      userId: session.userId,
      nome: "",
      telefone: null,
      email,
    });
    return { ok: true, session, customerId };
  } catch {
    return { ok: false, reason: "falha" };
  }
}

// --- conta do cliente -----------------------------------------------------------

export type MeuDados = { customerId: string | null; fullName: string | null; phone: string | null; email: string | null };

export async function customerMe(tenantId: string, userId: string): Promise<MeuDados> {
  const rows = await rpcServer<{ customer_id: string; full_name: string | null; phone: string | null; email: string | null }>(
    "customer_me",
    { p_tenant: tenantId, p_user: userId },
  ).catch(() => []);
  const row = rows[0];
  return {
    customerId: row?.customer_id ?? null,
    fullName: row?.full_name ?? null,
    phone: row?.phone ?? null,
    email: row?.email ?? null,
  };
}

export type MeuAgendamento = {
  appointment_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  service_name: string | null;
  staff_name: string | null;
  price_cents: number | null;
};

export async function customerAppointments(tenantId: string, userId: string): Promise<MeuAgendamento[]> {
  return rpcServer<MeuAgendamento>("customer_appointments", { p_tenant: tenantId, p_user: userId }).catch(() => []);
}

// Confirma a reserva quando o pagamento é no local: sem isso ela morre em
// hold_minutes (10 min) e o horário do cliente volta a ficar livre.
export async function confirmAppointment(appointmentId: string): Promise<boolean> {
  const rows = await rpcServer<{ status: string }>("confirm_appointment", { p_appointment: appointmentId }).catch(() => []);
  return rows[0]?.status === "confirmed";
}

// --- painel do barbeiro ----------------------------------------------------------

// Entrada do barbeiro: só abre sessão. Não cria linha de customer — quem trabalha na
// barbearia é membro (memberships), não cliente.
export async function loginStaff(o: { email: string; password: string }): Promise<{ ok: boolean; session?: Session }> {
  const email = String(o.email ?? "").trim().toLowerCase();
  if (!emailOk(email) || !passwordOk(o.password)) return { ok: false };
  const session = await signIn(email, o.password);
  return session ? { ok: true, session } : { ok: false };
}

export type Papel = "owner" | "manager" | "staff" | null;

export async function panelRole(tenantId: string, userId: string): Promise<Papel> {
  const rows = await rpcServer<string>("panel_role", { p_tenant: tenantId, p_user: userId }).catch(() => []);
  const papel = rows[0];
  return papel === "owner" || papel === "manager" || papel === "staff" ? papel : null;
}

export type PainelAgendamento = {
  appointment_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  customer_name: string | null;
  customer_phone: string | null;
  service_name: string | null;
  staff_name: string | null;
  price_cents: number | null;
};

export async function panelAgenda(tenantId: string, from: string, to: string): Promise<PainelAgendamento[]> {
  return rpcServer<PainelAgendamento>("panel_agenda", { p_tenant: tenantId, p_from: from, p_to: to }).catch(() => []);
}

export type PainelResumo = {
  total: number;
  confirmados: number;
  concluidos: number;
  cancelados: number;
  faturamento_cents: number;
};

export async function panelResumo(tenantId: string, from: string, to: string): Promise<PainelResumo> {
  const rows = await rpcServer<PainelResumo>("panel_resumo", { p_tenant: tenantId, p_from: from, p_to: to }).catch(() => []);
  return rows[0] ?? { total: 0, confirmados: 0, concluidos: 0, cancelados: 0, faturamento_cents: 0 };
}

// O ator vai junto: a função do banco confere o papel e, para staff, se o atendimento
// é dele. A checagem não fica só aqui no servidor.
export async function setAppointmentStatus(
  actorId: string,
  appointmentId: string,
  status: string,
): Promise<{ ok: boolean; erro?: string }> {
  try {
    const rows = await rpcServer<string>("set_appointment_status", {
      p_actor: actorId,
      p_appointment: appointmentId,
      p_status: status,
    });
    return { ok: rows[0] === status };
  } catch (error) {
    const texto = String((error as Error)?.message ?? "");
    return { ok: false, erro: texto.includes("transicao_invalida") ? "transicao_invalida" : "falha" };
  }
}

export async function creditCashback(appointmentId: string): Promise<number> {
  const rows = await rpcServer<number>("credit_cashback", { p_appointment: appointmentId }).catch(() => []);
  return Number(rows[0] ?? 0);
}

export type CashbackCliente = {
  balance_cents: number;
  entries: Array<{ kind: string; amount_cents: number; memo: string | null; created_at: string }>;
};

export async function customerCashback(tenantId: string, userId: string): Promise<CashbackCliente> {
  const rows = await rpcServer<{ balance_cents: number; entries: CashbackCliente["entries"] }>("customer_cashback", {
    p_tenant: tenantId,
    p_user: userId,
  }).catch(() => []);
  return { balance_cents: Number(rows[0]?.balance_cents ?? 0), entries: rows[0]?.entries ?? [] };
}

// --- equipe: convite, papéis e meta ---------------------------------------------

async function adminSetPassword(userId: string, password: string): Promise<boolean> {
  const { status } = await adminCall(`users/${userId}`, "PUT", { password });
  return status === 200;
}

export type Membro = { user_id: string; email: string; full_name: string | null; role: string; status: string };

export async function listMembers(tenantId: string, actorId: string): Promise<Membro[]> {
  return rpcServer<Membro>("list_members", { p_tenant: tenantId, p_actor: actorId }).catch(() => []);
}

export function inviteCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Cria (ou reaproveita) a conta do convidado e grava o convite. A senha aleatória aqui
// não serve para entrar: quem define a senha é o convidado, ao abrir o link.
export async function convidarMembro(o: {
  tenantId: string;
  actorId: string;
  email: string;
  nome: string;
  role: string;
}): Promise<{ ok: true; code: string; expires: string } | { ok: false; reason: string }> {
  const email = String(o.email ?? "").trim().toLowerCase();
  if (!emailOk(email)) return { ok: false, reason: "email_invalido" };
  if (!["owner", "manager", "staff"].includes(o.role)) return { ok: false, reason: "papel_invalido" };

  try {
    const existentes = await rpcServer<{ id: string }>("find_auth_user", { p_email: email }).catch(() => []);
    let userId = existentes[0]?.id ?? null;
    if (!userId) {
      const criado = await createUser(email, `tmp-${inviteCode()}`, o.nome, "");
      if (!criado.id) return { ok: false, reason: "falha" };
      userId = criado.id;
    }
    const code = inviteCode();
    const linhas = await rpcServer<string>("create_invite", {
      p_actor: o.actorId,
      p_tenant: o.tenantId,
      p_user: userId,
      p_role: o.role,
      p_code: code,
      p_days: 7,
    });
    return { ok: true, code, expires: String(linhas[0] ?? "") };
  } catch (error) {
    const texto = String((error as Error)?.message ?? "");
    if (texto.includes("só_dono_cria_dono") || texto.includes("42501")) return { ok: false, reason: "sem_permissao" };
    return { ok: false, reason: "falha" };
  }
}

// Consome o convite (uso único) e devolve quem é. Não usar para "validar": consumir é
// o próprio ato de aceitar, e chamar duas vezes invalida o convite.

// Aceita o convite: consome o código, define a senha do convidado, ativa a membership
// e devolve a sessão já aberta.
export async function aceitarConvite(o: {
  slug: string;
  code: string;
  password: string;
}): Promise<{ ok: true; session: Session } | { ok: false; reason: string }> {
  if (!passwordOk(o.password)) return { ok: false, reason: "senha_curta" };
  try {
    const rows = await rpcServer<{ user_id: string; tenant_id: string; role: string }>("consume_invite", {
      p_slug: o.slug,
      p_code: o.code,
    }).catch(() => []);
    const convite = rows[0];
    if (!convite?.user_id) return { ok: false, reason: "convite_invalido" };

    const usuario = await adminCall(`users/${convite.user_id}`, "GET", undefined).catch(() => ({ status: 0, json: null }));
    const email = (usuario.json as { email?: string } | null)?.email ?? "";
    if (!email) return { ok: false, reason: "falha" };
    if (!(await adminSetPassword(convite.user_id, o.password))) return { ok: false, reason: "falha" };
    await rpcServer<string>("activate_member", { p_tenant: convite.tenant_id, p_user: convite.user_id }).catch(() => []);

    const session = await signIn(email, o.password);
    if (!session) return { ok: false, reason: "falha" };
    return { ok: true, session };
  } catch {
    return { ok: false, reason: "falha" };
  }
}

export async function revogarMembro(tenantId: string, actorId: string, userId: string): Promise<boolean> {
  try {
    const rows = await rpcServer<string>("revoke_member", { p_tenant: tenantId, p_actor: actorId, p_user: userId });
    return rows[0] === "revoked";
  } catch {
    return false;
  }
}

export async function setDailyGoal(tenantId: string, actorId: string, cents: number): Promise<number> {
  const rows = await rpcServer<number>("set_daily_goal", { p_tenant: tenantId, p_actor: actorId, p_cents: cents }).catch(() => []);
  return Number(rows[0] ?? 0);
}

export type PainelCliente = {
  customer_id: string;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  visitas: number;
  ultima_visita: string | null;
  total_cents: number;
  ticket_medio_cents: number;
  dias_sem_voltar: number | null;
};

export async function panelCustomers(
  tenantId: string,
  actorId: string,
  busca?: string,
): Promise<PainelCliente[]> {
  const linhas = await rpcServer<PainelCliente>("panel_customers", {
    p_tenant: tenantId,
    p_actor: actorId,
    p_busca: busca && busca.trim() ? busca.trim() : null,
  }).catch(() => []);
  return linhas;
}

// --- cookies -------------------------------------------------------------------

export function readSession(request: Request): { accessToken: string | null; userId: string | null } {
  const header = request.headers.get("cookie") ?? "";
  const jar = new Map<string, string>();
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0) jar.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return { accessToken: jar.get(COOKIE_AT) ?? null, userId: jar.get(COOKIE_UID) ?? null };
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function sessionHeaders(session: Session): string[] {
  return [
    cookie(COOKIE_AT, session.accessToken, Math.max(60, session.expiresIn)),
    cookie(COOKIE_RT, session.refreshToken, 60 * 60 * 24 * 30),
    cookie(COOKIE_UID, session.userId, 60 * 60 * 24 * 30),
  ];
}

export function clearSessionHeaders(): string[] {
  return [cookie(COOKIE_AT, "", 0), cookie(COOKIE_RT, "", 0), cookie(COOKIE_UID, "", 0)];
}

// --- reserva -------------------------------------------------------------------

export type BookingResult =
  | { ok: true; appointmentId: string }
  | { ok: false; reason: "sem_sessao" | "not_a_customer" | "slot_taken" | "falha"; detail?: string };

// A reserva é feita com o token do CLIENTE, não com a chave secreta: assim quem
// valida permissão é o próprio banco (auth.uid()), e o servidor não ganha poder que
// não deveria ter.
export async function bookWithSession(o: {
  sessionToken: string;
  tenantId: string;
  staffId: string;
  serviceId: string;
  startsAt: string;
  idempotencyKey: string;
}): Promise<BookingResult> {
  const url = projectUrl();
  const key = publishableKey();
  if (!url || !key) return { ok: false, reason: "falha" };
  const response = await fetch(`${url}/rest/v1/rpc/book_appointment`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${o.sessionToken}`,
      "content-type": "application/json",
      "content-profile": "public_api",
      "accept-profile": "public_api",
    },
    body: JSON.stringify({
      p_tenant: o.tenantId,
      p_staff: o.staffId,
      p_service: o.serviceId,
      p_starts_at: o.startsAt,
      p_idempotency_key: o.idempotencyKey,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  const texto = await response.text();
  if (response.ok) {
    const id = texto.replace(/^"|"$/g, "").trim();
    return id ? { ok: true, appointmentId: id } : { ok: false, reason: "falha" };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: /not_a_customer/.test(texto) ? "not_a_customer" : "sem_sessao", detail: texto.slice(0, 120) };
  }
  if (/slot_unavailable|23P01|conflict|23505|exclusion/.test(texto)) return { ok: false, reason: "slot_taken" };
  return { ok: false, reason: "falha", detail: texto.slice(0, 160) };
}

export function idempotencyKeyFor(parts: string[]): string {
  return parts.join("|").toLowerCase().replace(/\s+/g, "");
}
