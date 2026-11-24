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
  // Função que retorna void vem como 204 sem corpo: ler JSON aqui estourava e a tela
  // dizia "não foi possível salvar" depois de ter salvado.
  const texto = await response.text();
  if (!texto) return [];
  const json: unknown = JSON.parse(texto);
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
  pago_cents: number;
  metodo: string | null;
  customer_id: string | null;
  bbt_cents: number;
  bbt_usado_cents: number;
  auto_completed_at: string | null;
};

// Fechamento automático: passou do horário de término, o atendimento vira 'completed'.
// O cron da VPS roda a cada 5 minutos; esta chamada é a rede de segurança para quem abre
// o painel antes disso — e é o que faz o número aparecer na hora certa.
export type FechamentoVencidos = { fechados: number; cashback_cents: number };

// Cliente que não veio: desfaz o fechamento automático e estorna o BBT.
export async function marcarFalta(actorId: string, appointmentId: string): Promise<boolean> {
  try {
    await rpcServer<string>("marcar_falta", { p_actor: actorId, p_appointment: appointmentId });
    return true;
  } catch {
    return false;
  }
}

export async function fecharVencidos(tenantId: string): Promise<FechamentoVencidos> {
  const linhas = await rpcServer<FechamentoVencidos>("fechar_atendimentos_vencidos", { p_tenant: tenantId }).catch(() => []);
  return linhas[0] ?? { fechados: 0, cashback_cents: 0 };
}

export async function panelAgenda(
  tenantId: string,
  from: string,
  to: string,
  staffId?: string | null,
): Promise<PainelAgendamento[]> {
  return rpcServer<PainelAgendamento>("panel_agenda", {
    p_tenant: tenantId,
    p_from: from,
    p_to: to,
    p_staff: staffId ?? null,
  }).catch(() => []);
}

export type PainelResumo = {
  total: number;
  confirmados: number;
  concluidos: number;
  cancelados: number;
  faturamento_cents: number;
  a_receber_cents: number;
  pago_antes_cents: number;
};

export async function panelResumo(tenantId: string, from: string, to: string): Promise<PainelResumo> {
  const rows = await rpcServer<PainelResumo>("panel_resumo", { p_tenant: tenantId, p_from: from, p_to: to }).catch(() => []);
  return rows[0] ?? { total: 0, confirmados: 0, concluidos: 0, cancelados: 0, faturamento_cents: 0, a_receber_cents: 0, pago_antes_cents: 0 };
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


// --- caixa ---------------------------------------------------------------------

export type Recebimento = { payment_id: string; amount_cents: number; method: string };

// Registra o dinheiro que entrou. Não mexe no status do atendimento de propósito:
// "recebi" e "atendeu" são fatos diferentes, e o banco também os separa.
export async function recordPayment(
  actorId: string,
  appointmentId: string,
  method: string,
  amountCents?: number,
  bbtCents = 0,
): Promise<Recebimento | null> {
  try {
    const linhas = await rpcServer<Recebimento>("record_payment", {
      p_actor: actorId,
      p_appointment: appointmentId,
      p_method: method,
      p_amount_cents: typeof amountCents === "number" && amountCents > 0 ? amountCents : null,
      p_bbt_cents: Math.max(0, Math.round(bbtCents)),
    });
    return linhas[0] ?? null;
  } catch {
    return null;
  }
}

export type Financeiro = {
  recebido_cents: number;
  pagamentos: number;
  ticket_medio_cents: number;
  pix_cents: number;
  dinheiro_cents: number;
  cartao_cents: number;
  outros_cents: number;
  concluidos_cents: number;
  sem_pagamento: number;
  meta_cents: number;
  a_receber_cents: number;
  pago_antes_cents: number;
};

const FINANCEIRO_ZERO: Financeiro = {
  recebido_cents: 0,
  pagamentos: 0,
  ticket_medio_cents: 0,
  pix_cents: 0,
  dinheiro_cents: 0,
  cartao_cents: 0,
  outros_cents: 0,
  concluidos_cents: 0,
  sem_pagamento: 0,
  meta_cents: 0,
  a_receber_cents: 0,
  pago_antes_cents: 0,
};

export async function panelFinanceiro(
  tenantId: string,
  actorId: string,
  from: string,
  to: string,
): Promise<Financeiro> {
  const linhas = await rpcServer<Financeiro>("panel_financeiro", {
    p_tenant: tenantId,
    p_actor: actorId,
    p_from: from,
    p_to: to,
  }).catch(() => []);
  return { ...FINANCEIRO_ZERO, ...(linhas[0] ?? {}) };
}


// --- minha barbearia ------------------------------------------------------------

export type PainelServico = {
  service_id: string;
  name: string;
  description: string | null;
  duration_min: number;
  price_cents: number;
  display_order: number | null;
  active: boolean;
};

export async function panelServices(tenantId: string, actorId: string): Promise<PainelServico[]> {
  return rpcServer<PainelServico>("panel_services", { p_tenant: tenantId, p_actor: actorId }).catch(() => []);
}

export async function updateBranding(
  tenantId: string,
  actorId: string,
  dados: {
    nome: string;
    endereco: string;
    cidade: string;
    estado: string;
    telefone: string;
    whatsapp: string;
    politica: string;
    instagram: string;
    corPrimaria: string;
    corSecundaria: string;
    corAcento: string;
    logo: string;
  },
): Promise<boolean> {
  try {
    await rpcServer("update_branding", {
      p_tenant: tenantId,
      p_actor: actorId,
      p_display_name: dados.nome,
      p_address_line: dados.endereco,
      p_city: dados.cidade,
      p_state: dados.estado,
      p_phone_public: dados.telefone,
      p_whatsapp_public: dados.whatsapp,
      p_policy_text: dados.politica,
      p_instagram: dados.instagram,
      p_color_primary: dados.corPrimaria,
      p_color_secondary: dados.corSecundaria,
      p_color_accent: dados.corAcento,
      p_logo_url: dados.logo,
    });
    return true;
  } catch {
    return false;
  }
}

export async function setHours(tenantId: string, actorId: string, horas: Record<string, string | null>): Promise<boolean> {
  try {
    await rpcServer("set_hours", { p_tenant: tenantId, p_actor: actorId, p_hours: horas });
    return true;
  } catch {
    return false;
  }
}

export async function upsertService(
  tenantId: string,
  actorId: string,
  servico: { id?: string | null; nome: string; descricao: string; duracao: number; precoCents: number },
): Promise<boolean> {
  try {
    await rpcServer("upsert_service", {
      p_tenant: tenantId,
      p_actor: actorId,
      p_service: servico.id ?? null,
      p_name: servico.nome,
      p_description: servico.descricao,
      p_duration_min: servico.duracao,
      p_price_cents: servico.precoCents,
      p_display_order: null,
    });
    return true;
  } catch {
    return false;
  }
}

export async function setServiceActive(tenantId: string, actorId: string, serviceId: string, ativo: boolean): Promise<boolean> {
  try {
    const linhas = await rpcServer<boolean>("set_service_active", {
      p_tenant: tenantId,
      p_actor: actorId,
      p_service: serviceId,
      p_active: ativo,
    });
    return linhas[0] === ativo;
  } catch {
    return false;
  }
}


// --- agenda operável -------------------------------------------------------------

export type Bloqueio = { block_id: string; staff_id: string; starts_at: string; ends_at: string; reason: string | null };

export async function panelBlocks(tenantId: string, from: string, to: string): Promise<Bloqueio[]> {
  return rpcServer<Bloqueio>("panel_blocks", { p_tenant: tenantId, p_from: from, p_to: to }).catch(() => []);
}

export async function bookForCustomer(o: {
  actorId: string;
  tenantId: string;
  staffId: string;
  serviceId: string;
  startsAt: string;
  customerId: string;
}): Promise<string | null> {
  try {
    const linhas = await rpcServer<string>("book_for_customer", {
      p_actor: o.actorId,
      p_tenant: o.tenantId,
      p_staff: o.staffId,
      p_service: o.serviceId,
      p_starts_at: o.startsAt,
      p_customer: o.customerId,
    });
    return linhas[0] ?? null;
  } catch {
    return null;
  }
}

export async function rescheduleAppointment(actorId: string, appointmentId: string, startsAt: string): Promise<boolean> {
  try {
    await rpcServer("reschedule_appointment", { p_actor: actorId, p_appointment: appointmentId, p_starts_at: startsAt });
    return true;
  } catch {
    return false;
  }
}

export async function blockTime(o: {
  actorId: string;
  tenantId: string;
  staffId: string;
  from: string;
  to: string;
  reason: string;
}): Promise<boolean> {
  try {
    await rpcServer("block_time", {
      p_actor: o.actorId,
      p_tenant: o.tenantId,
      p_staff: o.staffId,
      p_from: o.from,
      p_to: o.to,
      p_reason: o.reason,
    });
    return true;
  } catch {
    return false;
  }
}

export async function unblockTime(actorId: string, tenantId: string, blockId: string): Promise<boolean> {
  try {
    const linhas = await rpcServer<boolean>("unblock_time", { p_actor: actorId, p_tenant: tenantId, p_block: blockId });
    return linhas[0] === true;
  } catch {
    return false;
  }
}

// Cliente que liga ou aparece no balcão. Se já existe pelo telefone, reaproveita — senão
// cria a identidade (a tabela customers exige user_id, não dá para ter cliente sem login).
// O e-mail é derivado do telefone num domínio nosso; o cliente não precisa dele para nada.
export type ClienteBalcao = { customerId: string; criado: boolean };

export async function clienteDeBalcao(o: {
  tenantId: string;
  nome: string;
  telefone: string;
  email?: string;
}): Promise<ClienteBalcao | null> {
  const digitos = o.telefone.replace(/\D/g, "");
  if (digitos.length < 10) return null;

  const existente = await rpcServer<{ customer_id: string }>("find_customer", {
    p_tenant: o.tenantId,
    p_phone: digitos,
  }).catch(() => []);
  if (existente[0]?.customer_id) return { customerId: existente[0].customer_id, criado: false };

  const email = (o.email ?? "").includes("@") ? String(o.email).trim() : `wa.${digitos}@clientes.workloop.com.br`;

  // Reaproveita a identidade se ela já existe (marcação anterior que falhou, ou cliente
  // de outra barbearia): criar de novo estouraria por e-mail duplicado e o telefone
  // ficaria travado para sempre.
  const jaExiste = await rpcServer<{ id: string }>("find_auth_user", { p_email: email }).catch(() => []);
  let userId: string | null = jaExiste[0]?.id ?? null;
  if (!userId) {
    const bruto = (await createUser(email, `bc-${inviteCode()}`, o.nome, digitos).catch(() => null)) as
      | { id?: string; user?: { id?: string } }
      | null;
    userId = bruto?.id ?? bruto?.user?.id ?? null;
  }
  if (!userId) return null;

  const criado = await rpcServer<string>("ensure_customer", {
    p_tenant: o.tenantId,
    p_user: userId,
    p_name: o.nome,
    p_phone: digitos,
    p_email: email,
  }).catch(() => []);
  return criado[0] ? { customerId: criado[0], criado: true } : null;
}

// Marcação falhou depois de criar a identidade: some com o cliente se ele não tem nada.
export async function abandonarCliente(tenantId: string, customerId: string): Promise<boolean> {
  try {
    const linhas = await rpcServer<boolean>("drop_customer_if_unused", { p_tenant: tenantId, p_customer: customerId });
    return linhas[0] === true;
  } catch {
    return false;
  }
}


// --- BBT saindo -----------------------------------------------------------------

export async function debitCashback(
  actorId: string,
  tenantId: string,
  appointmentId: string,
  amountCents: number,
  motivo = "",
): Promise<boolean> {
  try {
    const linhas = await rpcServer<number>("debit_cashback", {
      p_actor: actorId,
      p_tenant: tenantId,
      p_customer: null,
      p_amount_cents: Math.round(amountCents),
      p_appointment: appointmentId,
      p_reason: motivo,
    });
    return Number(linhas[0]) > 0;
  } catch {
    return false;
  }
}

export type LancamentoBbt = { kind: string; amount_cents: number; memo: string | null; created_at: string };

export async function cashbackExtrato(tenantId: string, userId: string): Promise<LancamentoBbt[]> {
  return rpcServer<LancamentoBbt>("customer_cashback_extrato", { p_tenant: tenantId, p_user: userId }).catch(() => []);
}


// --- despesas e comissões -------------------------------------------------------

export type Despesa = {
  expense_id: string;
  description: string;
  category: string;
  amount_cents: number;
  method: string;
  spent_on: string;
};

export type ResultadoMes = {
  recebido_cents: number;
  despesas_cents: number;
  comissoes_cents: number;
  bbt_concedido_cents: number;
  sobrou_cents: number;
};

export type Comissao = {
  staff_id: string;
  staff_name: string;
  commission_bps: number;
  atendimentos: number;
  base_cents: number;
  comissao_cents: number;
};

export async function panelExpenses(tenantId: string, from: string, to: string): Promise<Despesa[]> {
  return rpcServer<Despesa>("panel_expenses", { p_tenant: tenantId, p_from: from, p_to: to }).catch(() => []);
}

export async function addExpense(o: {
  actorId: string;
  tenantId: string;
  descricao: string;
  categoria: string;
  valorCents: number;
  data: string;
  meio: string;
}): Promise<boolean> {
  try {
    await rpcServer("add_expense", {
      p_actor: o.actorId,
      p_tenant: o.tenantId,
      p_description: o.descricao,
      p_category: o.categoria,
      p_amount_cents: Math.round(o.valorCents),
      p_spent_on: o.data,
      p_method: o.meio,
    });
    return true;
  } catch {
    return false;
  }
}

export async function cancelExpense(actorId: string, tenantId: string, expenseId: string): Promise<boolean> {
  try {
    const linhas = await rpcServer<boolean>("cancel_expense", { p_actor: actorId, p_tenant: tenantId, p_expense: expenseId });
    return linhas[0] === true;
  } catch {
    return false;
  }
}

export async function panelCommissions(tenantId: string, from: string, to: string): Promise<Comissao[]> {
  return rpcServer<Comissao>("panel_commissions", { p_tenant: tenantId, p_from: from, p_to: to }).catch(() => []);
}

export async function setCommission(actorId: string, tenantId: string, staffId: string, bps: number): Promise<boolean> {
  try {
    const linhas = await rpcServer<number>("set_commission", {
      p_actor: actorId,
      p_tenant: tenantId,
      p_staff: staffId,
      p_bps: Math.round(bps),
    });
    return Number(linhas[0]) === Math.round(bps);
  } catch {
    return false;
  }
}

const RESULTADO_ZERO: ResultadoMes = {
  recebido_cents: 0,
  despesas_cents: 0,
  comissoes_cents: 0,
  bbt_concedido_cents: 0,
  sobrou_cents: 0,
};

export async function panelResultado(tenantId: string, from: string, to: string): Promise<ResultadoMes> {
  const linhas = await rpcServer<Resultado>("panel_resultado", { p_tenant: tenantId, p_from: from, p_to: to }).catch(() => []);
  return { ...RESULTADO_ZERO, ...(linhas[0] ?? {}) };
}


// --- profissionais (quem atende) ------------------------------------------------

export type Profissional = {
  staff_id: string;
  display_name: string;
  active: boolean;
  commission_bps: number;
  access_user_id: string | null;
  access_email: string | null;
  access_role: string | null;
  service_ids: string[] | null;
};

// Resolve o id do usuário pelo e-mail (a Admin API não consulta por e-mail).
export async function usuarioPorEmail(email: string): Promise<string | null> {
  const linhas = await rpcServer<{ id: string }>("find_auth_user", { p_email: String(email ?? "").trim().toLowerCase() }).catch(() => []);
  return linhas[0]?.id ?? null;
}

export async function panelStaff(tenantId: string, actorId: string): Promise<Profissional[]> {
  return rpcServer<Profissional>("panel_staff", { p_tenant: tenantId, p_actor: actorId }).catch(() => []);
}

export async function linkStaffUser(tenantId: string, actorId: string, staffId: string, userId: string): Promise<boolean> {
  try {
    const linhas = await rpcServer<boolean>("link_staff_user", {
      p_tenant: tenantId,
      p_actor: actorId,
      p_staff: staffId,
      p_user: userId,
    });
    return linhas[0] === true;
  } catch {
    return false;
  }
}

export async function setStaffActive(tenantId: string, actorId: string, staffId: string, ativo: boolean): Promise<boolean> {
  try {
    const linhas = await rpcServer<boolean>("set_staff_active", {
      p_tenant: tenantId,
      p_actor: actorId,
      p_staff: staffId,
      p_active: ativo,
    });
    return linhas[0] === ativo;
  } catch {
    return false;
  }
}

export async function addStaff(tenantId: string, actorId: string, nome: string, bps: number, servicos?: string[]): Promise<boolean> {
  try {
    const linhas = await rpcServer<string>("add_staff", {
      p_tenant: tenantId,
      p_actor: actorId,
      p_name: nome,
      p_commission_bps: Math.round(bps),
      p_services: servicos ?? null,
    });
    return Boolean(linhas[0]);
  } catch {
    return false;
  }
}

export async function setStaffServices(tenantId: string, actorId: string, staffId: string, servicos: string[]): Promise<boolean> {
  try {
    const linhas = await rpcServer<number>("set_staff_services", {
      p_tenant: tenantId,
      p_actor: actorId,
      p_staff: staffId,
      p_services: servicos,
    });
    return Number(linhas[0]) === servicos.length;
  } catch {
    return false;
  }
}


// --- produtos -------------------------------------------------------------------

export type ProdutoPainel = {
  product_id: string;
  name: string;
  description: string | null;
  category: string;
  price_cents: number;
  compare_price_cents: number | null;
  active: boolean;
  image_url: string | null;
  slug: string;
  details: string | null;
  brand: string | null;
  size_label: string | null;
};

export async function panelProducts(tenantId: string, actorId: string): Promise<ProdutoPainel[]> {
  return rpcServer<ProdutoPainel>("panel_products", { p_tenant: tenantId, p_actor: actorId }).catch(() => []);
}

export async function upsertProduct(o: {
  tenantId: string;
  actorId: string;
  productId?: string | null;
  nome: string;
  descricao: string;
  categoria: string;
  precoCents: number;
  precoDeCents: number | null;
  detalhes?: string;
  marca?: string;
  tamanho?: string;
}): Promise<boolean> {
  try {
    const linhas = await rpcServer<string>("upsert_product", {
      p_tenant: o.tenantId,
      p_actor: o.actorId,
      p_product: o.productId ?? null,
      p_name: o.nome,
      p_description: o.descricao,
      p_category: o.categoria,
      p_price_cents: Math.round(o.precoCents),
      p_compare_price_cents: o.precoDeCents === null ? null : Math.round(o.precoDeCents),
      p_details: o.detalhes ?? null,
      p_brand: o.marca ?? null,
      p_size_label: o.tamanho ?? null,
    });
    return Boolean(linhas[0]);
  } catch {
    return false;
  }
}

export async function setProductActive(tenantId: string, actorId: string, productId: string, ativo: boolean): Promise<boolean> {
  try {
    const linhas = await rpcServer<boolean>("set_product_active", {
      p_tenant: tenantId,
      p_actor: actorId,
      p_product: productId,
      p_active: ativo,
    });
    return linhas[0] === ativo;
  } catch {
    return false;
  }
}


// --- foto do produto (storage) ---------------------------------------------------

const EXTENSAO: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Sobe a foto com a chave secreta, no servidor. O navegador nunca vê a chave, e o bucket
// aceita escrita só por este caminho.
export async function subirFotoProduto(
  tenantId: string,
  productId: string,
  arquivo: { bytes: ArrayBuffer; tipo: string },
): Promise<string | null> {
  const url = projectUrl();
  const key = secretKey();
  if (!url || !key) return null;

  const extensao = EXTENSAO[arquivo.tipo];
  if (!extensao) return null;
  if (arquivo.bytes.byteLength === 0 || arquivo.bytes.byteLength > 5 * 1024 * 1024) return null;

  const caminho = `${tenantId}/${productId}.${extensao}`;
  const resposta = await fetch(`${url}/storage/v1/object/barberclub-produtos/${caminho}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": arquivo.tipo,
      "x-upsert": "true",
      "cache-control": "max-age=31536000",
    },
    body: arquivo.bytes,
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  if (!resposta?.ok) return null;

  // ?v= força o navegador a buscar a versão nova quando a foto é trocada.
  return `${url}/storage/v1/object/public/barberclub-produtos/${caminho}?v=${Date.now()}`;
}

export async function setProductImage(tenantId: string, actorId: string, productId: string, url: string | null): Promise<boolean> {
  try {
    await rpcServer("set_product_image", {
      p_tenant: tenantId,
      p_actor: actorId,
      p_product: productId,
      p_url: url,
    });
    return true;
  } catch {
    return false;
  }
}


// Logo: mesmo bucket das fotos, prefixo proprio. Nome fixo por barbearia — trocar o logo
// nao acumula arquivo velho, e o ?v= resolve o cache do navegador.
export async function subirLogo(
  tenantId: string,
  arquivo: { bytes: ArrayBuffer; tipo: string },
): Promise<string | null> {
  const url = projectUrl();
  const key = secretKey();
  if (!url || !key) return null;

  const extensao = EXTENSAO[arquivo.tipo];
  if (!extensao) return null;
  // Folga de 10 MB: o redutor do navegador entrega ~150 KB, este limite só vale para
  // quando o redutor não rodar (navegador antigo).
  if (arquivo.bytes.byteLength === 0 || arquivo.bytes.byteLength > 10 * 1024 * 1024) return null;

  const caminho = `logos/${tenantId}.${extensao}`;

  // Logo antigo em outra extensão (png -> jpg, por exemplo) viraria lixo permanente:
  // o nome fixo só protege quando a extensão não muda.
  const outras = Object.values(EXTENSAO)
    .filter((ext) => ext !== extensao)
    .map((ext) => `logos/${tenantId}.${ext}`);
  if (outras.length > 0) {
    await fetch(`${url}/storage/v1/object/barberclub-produtos`, {
      method: "DELETE",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ prefixes: outras }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
  }

  const resposta = await fetch(`${url}/storage/v1/object/barberclub-produtos/${caminho}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": arquivo.tipo,
      "x-upsert": "true",
      "cache-control": "max-age=3600",
    },
    body: arquivo.bytes,
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  if (!resposta?.ok) return null;

  return `${url}/storage/v1/object/public/barberclub-produtos/${caminho}?v=${Date.now()}`;
}

export async function setTenantLogo(tenantId: string, actorId: string, url: string | null): Promise<boolean> {
  try {
    await rpcServer("set_tenant_logo", { p_tenant: tenantId, p_actor: actorId, p_url: url });
    return true;
  } catch {
    return false;
  }
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
