import { createCipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import net from "node:net";

const port = Number(process.argv[2] ?? 3461);
const B = "barber.workloop.com.br";
const api = process.env.SUPABASE_URL ?? "";
const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
const service = process.env.SUPABASE_SECRET_KEY ?? "";
const handoffKey = Buffer.from(process.env.HANDOFF_KEY ?? "", "hex");
if (!api || !anon || !service || handoffKey.length !== 32) {
  throw new Error("ambiente do Supabase local incompleto");
}

let passed = 0;
function check(condition, label, detail = "") {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ""}`);
  passed += 1;
  console.log(`ok ${label}`);
}

function psql(sql) {
  const listed = spawnSync("docker", ["ps", "-qf", "name=supabase_db_"], { encoding: "utf8" });
  const cid = listed.stdout.trim().split("\n")[0];
  const result = spawnSync(
    "docker",
    ["exec", "-i", "-u", "postgres", cid, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
    { input: sql, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr || "psql");
  return result.stdout;
}

function sqlValue(sql) {
  const listed = spawnSync("docker", ["ps", "-qf", "name=supabase_db_"], { encoding: "utf8" });
  const cid = listed.stdout.trim().split("\n")[0];
  const result = spawnSync(
    "docker",
    ["exec", "-i", "-u", "postgres", cid, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr || "psql");
  return result.stdout.trim();
}

function raw(method, path, host, { headers = "", body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1", () => {
      const payload = Buffer.from(body);
      const length = body ? `Content-Length: ${payload.length}\r\n` : "";
      sock.write(`${method} ${path} HTTP/1.1\r\nHost: ${host}\r\n${headers}${length}Connection: close\r\n\r\n`);
      if (payload.length) sock.write(payload);
    });
    const chunks = [];
    sock.setTimeout(15000, () => {
      sock.destroy();
      reject(new Error(`timeout ${method} ${path}`));
    });
    sock.on("data", (chunk) => chunks.push(chunk));
    sock.on("error", reject);
    sock.on("end", () => {
      const buffer = Buffer.concat(chunks);
      const splitAt = buffer.indexOf("\r\n\r\n");
      const head = buffer.slice(0, splitAt).toString("utf8");
      let rest = buffer.slice(splitAt + 4);
      if (/transfer-encoding:\s*chunked/i.test(head)) {
        const out = [];
        let offset = 0;
        while (offset < rest.length) {
          const lineEnd = rest.indexOf("\r\n", offset);
          if (lineEnd === -1) break;
          const size = Number.parseInt(rest.slice(offset, lineEnd).toString("utf8").split(";")[0], 16);
          if (!Number.isFinite(size) || size === 0) break;
          out.push(rest.slice(lineEnd + 2, lineEnd + 2 + size));
          offset = lineEnd + 2 + size + 2;
        }
        rest = Buffer.concat(out);
      }
      const setCookie = head
        .split("\r\n")
        .filter((line) => line.toLowerCase().startsWith("set-cookie:"))
        .map((line) => line.slice(11).trim());
      resolve({
        status: Number(head.split(" ")[1]),
        location: head.match(/^location:\s*(.*)$/im)?.[1]?.trim() ?? "",
        cache: head.match(/^cache-control:\s*(.*)$/im)?.[1]?.trim() ?? "",
        referrer: head.match(/^referrer-policy:\s*(.*)$/im)?.[1]?.trim() ?? "",
        setCookie,
        body: rest.toString("utf8"),
      });
    });
  });
}

function cookieHeader(lines) {
  return lines
    .map((line) => {
      const pair = line.split(";")[0] ?? "";
      const rest = line.slice(pair.length).toLowerCase();
      if (/max-age=0/.test(rest)) return "";
      return pair.trim();
    })
    .filter(Boolean)
    .join("; ");
}

function form(fields) {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

let xffSeq = 20;
async function postLogin(fields, cookie = "", options = {}) {
  const body = form(fields);
  const xff = Object.hasOwn(options, "xff") ? options.xff : `198.51.100.${(xffSeq++ % 200) + 1}`;
  const origin = options.origin !== false;
  const xffLine = xff ? `X-Forwarded-For: ${xff}\r\n` : "X-Forwarded-For:\r\n";
  const originLine = origin ? `Origin: https://${B}\r\n` : "";
  return raw("POST", "/login", B, {
    headers: `${originLine}${xffLine}Content-Type: application/x-www-form-urlencoded\r\n${cookie ? `Cookie: ${cookie}\r\n` : ""}`,
    body,
  });
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(input) {
  let bits = "";
  for (const char of input.toUpperCase().replace(/=+$/g, "")) {
    const value = B32.indexOf(char);
    if (value < 0) throw new Error("base32");
    bits += value.toString(2).padStart(5, "0");
  }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totp(secret, at = Date.now()) {
  const counter = Buffer.alloc(8);
  let time = Math.floor(at / 30000);
  for (let i = 7; i >= 0; i -= 1) {
    counter[i] = time & 0xff;
    time = Math.floor(time / 256);
  }
  const hmac = createHmac("sha1", base32(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(code % 1000000).padStart(6, "0");
}

async function createUser(email, password) {
  const id = crypto.randomUUID();
  const safeEmail = email.replaceAll("'", "''");
  const safePassword = password.replaceAll("'", "''");
  psql(`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', '${id}', 'authenticated', 'authenticated',
      '${safeEmail}', extensions.crypt('${safePassword}', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
      '', '', '', '',
      '', '', '', ''
    );
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      '${id}', '${id}', jsonb_build_object('sub', '${id}', 'email', '${safeEmail}'),
      'email', now(), now(), now()
    );
  `);
  return id;
}

async function enroll(email, password) {
  const signed = await fetch(`${api}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!signed.ok) {
    const detail = await signed.text();
    throw new Error(`token ${signed.status} ${detail.replace(/\s+/g, " ").slice(0, 180)}`);
  }
  const session = await signed.json();
  const factor = await fetch(`${api}/auth/v1/factors`, {
    method: "POST",
    headers: { apikey: anon, authorization: `Bearer ${session.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ factor_type: "totp", friendly_name: "teste" }),
  });
  if (!factor.ok) {
    const detail = await factor.json().catch(() => ({}));
    throw new Error(`fator ${factor.status} ${detail.error_code || detail.msg || detail.message || ""}`);
  }
  const enrolled = await factor.json();
  const secret = enrolled.totp?.secret;
  const challenge = await fetch(`${api}/auth/v1/factors/${enrolled.id}/challenge`, {
    method: "POST",
    headers: { apikey: anon, authorization: `Bearer ${session.access_token}`, "content-type": "application/json" },
    body: "{}",
  });
  if (!challenge.ok) throw new Error(`desafio ${challenge.status}`);
  const challenged = await challenge.json();
  const verified = await fetch(`${api}/auth/v1/factors/${enrolled.id}/verify`, {
    method: "POST",
    headers: { apikey: anon, authorization: `Bearer ${session.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ challenge_id: challenged.id, code: totp(secret) }),
  });
  if (!verified.ok) throw new Error(`verificar fator ${verified.status}`);
  return secret;
}

function seal(session, userId, code) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", handoffKey, iv);
  cipher.setAAD(Buffer.from(`${userId}\n${createHash("sha256").update(code).digest("hex")}`));
  const body = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("hex");
}

function jwtPayload(token) {
  const part = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

function sessionFromSetCookie(lines) {
  const pieces = lines
    .map((line) => {
      const pair = (line.split(";")[0] ?? "").trim();
      const name = pair.slice(0, pair.indexOf("="));
      const value = pair.slice(pair.indexOf("=") + 1);
      const meta = line.slice(pair.length).toLowerCase();
      return { name, value, meta };
    })
    .filter((item) => item.name.startsWith("sb-") && !item.meta.includes("max-age=0"))
    .sort((a, b) => a.name.localeCompare(b.name));
  const raw = pieces.map((item) => item.value).join("");
  const encoded = raw.startsWith("base64-") ? raw.slice("base64-".length) : raw;
  const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  return parsed.access_token ?? parsed[0]?.access_token;
}

const ids = {
  ativo: "77777777-7777-4777-8777-777777777771",
  trial1: "77777777-7777-4777-8777-777777777772",
  suspenso: "77777777-7777-4777-8777-777777777773",
  outro: "77777777-7777-4777-8777-777777777774",
};
const password = randomBytes(18).toString("hex");
const emails = {
  u0: "m4http-u0@example.test",
  u1: "m4http-u1@example.test",
  u3: "m4http-u3@example.test",
  us: "m4http-us@example.test",
  uos: "m4http-uos@example.test",
  umix: "m4http-umix@example.test",
  uo: "m4http-uo@example.test",
  invited: "m4http-invited@example.test",
  revoked: "m4http-revoked@example.test",
};

function cleanup(userIds) {
  const list = userIds.map((id) => `'${id}'`).join(",");
  const tenants = Object.values(ids).map((id) => `'${id}'`).join(",");
  if (!list) return;
  psql(`
    delete from public.memberships where user_id in (${list}) or tenant_id in (${tenants});
    delete from private.login_handoffs where user_id in (${list}) or tenant_id in (${tenants});
    delete from public.tenant_slug_history where tenant_id in (${tenants});
    delete from public.tenants where id in (${tenants});
    delete from public.profiles where id in (${list});
    delete from auth.mfa_challenges where factor_id in (select id from auth.mfa_factors where user_id in (${list}));
    delete from auth.mfa_factors where user_id in (${list});
    delete from auth.refresh_tokens where user_id in (${list.split(",").map((id) => `${id}::text`).join(",")});
    delete from auth.sessions where user_id in (${list});
    delete from auth.identities where user_id in (${list});
    delete from auth.users where id in (${list});
  `);
}

const userIds = [];
try {
  psql(`
    delete from public.memberships where tenant_id in (${Object.values(ids).map((id) => `'${id}'`).join(",")})
       or user_id in (select id from auth.users where email like 'm4http-%@example.test');
    delete from private.login_handoffs where tenant_id in (${Object.values(ids).map((id) => `'${id}'`).join(",")})
       or user_id in (select id from auth.users where email like 'm4http-%@example.test');
    delete from public.tenant_slug_history where tenant_id in (${Object.values(ids).map((id) => `'${id}'`).join(",")});
    delete from public.tenants where id in (${Object.values(ids).map((id) => `'${id}'`).join(",")});
    delete from public.profiles where id in (select id from auth.users where email like 'm4http-%@example.test');
    delete from auth.mfa_challenges where factor_id in (
      select id from auth.mfa_factors where user_id in (select id from auth.users where email like 'm4http-%@example.test')
    );
    delete from auth.mfa_factors where user_id in (select id from auth.users where email like 'm4http-%@example.test');
    delete from auth.refresh_tokens where user_id in (select id::text from auth.users where email like 'm4http-%@example.test');
    delete from auth.sessions where user_id in (select id from auth.users where email like 'm4http-%@example.test');
    delete from auth.identities where user_id in (select id from auth.users where email like 'm4http-%@example.test');
    delete from auth.users where email like 'm4http-%@example.test';
  `);
  for (const email of Object.values(emails)) userIds.push(await createUser(email, password));
  const [u0, u1, u3, us, uos, umix, uo, invited, revoked] = userIds;
  psql(`
    insert into public.profiles (id, full_name) values
      ('${u0}', 'u0'), ('${u1}', 'u1'), ('${u3}', 'u3'), ('${us}', 'us'), ('${uos}', 'uos'),
      ('${umix}', 'umix'), ('${uo}', 'uo'), ('${invited}', 'invited'), ('${revoked}', 'revoked');
    insert into public.tenants (id, slug, display_name, status) values
      ('${ids.ativo}', 'ativo', 'Ativo <img>', 'active'),
      ('${ids.trial1}', 'trial1', 'Trial Um', 'trial'),
      ('${ids.suspenso}', 'suspenso', 'Barbearia Suspensa', 'suspended'),
      ('${ids.outro}', 'outro', 'Outro Tres', 'active');
    insert into public.memberships (tenant_id, user_id, role, status) values
      ('${ids.ativo}', '${u1}', 'staff', 'active'),
      ('${ids.ativo}', '${u3}', 'staff', 'active'),
      ('${ids.trial1}', '${u3}', 'staff', 'active'),
      ('${ids.outro}', '${u3}', 'staff', 'active'),
      ('${ids.suspenso}', '${us}', 'staff', 'active'),
      ('${ids.suspenso}', '${uos}', 'owner', 'active'),
      ('${ids.ativo}', '${umix}', 'owner', 'active'),
      ('${ids.suspenso}', '${umix}', 'owner', 'active'),
      ('${ids.ativo}', '${uo}', 'owner', 'active'),
      ('${ids.ativo}', '${invited}', 'owner', 'invited'),
      ('${ids.suspenso}', '${revoked}', 'owner', 'revoked');
  `);
  const uosSecret = await enroll(emails.uos, password);
  const uoSecret = await enroll(emails.uo, password);

  const anonymous = await raw("GET", "/", `ativo.${B}`);
  check(anonymous.status === 200 && anonymous.body.includes("Ativo &lt;img&gt;") && !anonymous.body.includes("<img"), "display_name escapado");

  const none = await postLogin({ email: emails.u0, password });
  const staffSuspended = await postLogin({ email: emails.us, password });
  check(none.status === 200 && staffSuspended.status === 200, "sem tenant responde 200");
  check(none.body.includes("Não encontramos uma barbearia") && none.body === staffSuspended.body, "mensagem neutra igual para u0 e staff suspenso");
  check(!none.location && !staffSuspended.location, "sem tenant nao redireciona");

  const invitedLogin = await postLogin({ email: emails.invited, password });
  const revokedLogin = await postLogin({ email: emails.revoked, password });
  check(invitedLogin.status === 200 && invitedLogin.body === none.body, "owner invited ve zero");
  check(revokedLogin.status === 200 && revokedLogin.body === none.body, "owner revoked ve zero");

  const wrong = await postLogin({ email: emails.u1, password: "nao-e-a-senha" });
  const missing = await postLogin({ email: "nao-existe@example.test", password });
  check(wrong.status === missing.status && wrong.body === missing.body, "senha errada e email inexistente iguais");

  const evilOrigin = await raw("POST", "/login", B, {
    headers: `Origin: https://ativo.${B}\r\nContent-Type: application/x-www-form-urlencoded\r\n`,
    body: form({ email: emails.u1, password }),
  });
  check(evilOrigin.status === 403, "origin de outro host recusado");

  const badNext = [
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "/%2F%2Fevil.com",
    "javascript:alert(1)",
    "/x%0d%0aSet-Cookie:a=b",
    "/login",
    "/tenant/outro",
  ];
  for (const next of badNext) {
    const started = await postLogin({ email: emails.u1, password, next });
    check(started.status === 303 && started.location.startsWith(`https://ativo.${B}/auth/handoff?c=`), `handoff de next malicioso`, started.location);
    check(started.setCookie.some((line) => /max-age=0/i.test(line) && /^sb-/i.test(line)), "host base apaga o cookie");
    const handoffUrl = new URL(started.location);
    const consumed = await raw("GET", `${handoffUrl.pathname}${handoffUrl.search}`, handoffUrl.host);
    check(consumed.status === 303, "consume do next malicioso");
    const finalUrl = new URL(consumed.location, `https://ativo.${B}`);
    check(finalUrl.pathname === "/" && finalUrl.host === `ativo.${B}`, "destino final e a raiz do tenant", consumed.location);
    check(!consumed.location.includes("evil") && !consumed.location.includes("\\"), "location sem o next malicioso");
    for (const hop of [started.location, consumed.location]) {
      if (!hop) continue;
      const host = new URL(hop, `https://${B}`).host;
      check(host === B || host === `ativo.${B}`, "location so no host base ou no tenant");
    }
  }

  const plantedToken = await fetch(`${api}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "content-type": "application/json" },
    body: JSON.stringify({ email: emails.u1, password }),
  });
  const plantedSession = await plantedToken.json();
  const plantedCode = randomBytes(32).toString("hex");
  psql(`
    insert into private.login_handoffs (code_hash, user_id, tenant_id, next_path, sealed, expires_at)
    values (
      extensions.digest('${plantedCode}', 'sha256'),
      '${u1}',
      '${ids.ativo}',
      $next$/\\evil.com$next$,
      decode('${seal({ access_token: plantedSession.access_token, refresh_token: plantedSession.refresh_token }, u1, plantedCode)}', 'hex'),
      now() + interval '40 seconds'
    );
  `);
  const planted = await raw("GET", `/auth/handoff?c=${plantedCode}`, `ativo.${B}`);
  check(planted.status === 303 && new URL(planted.location, `https://ativo.${B}`).pathname === "/", "consume barra de novo o next_path");
  check(!planted.location.includes("evil") && !planted.location.includes("\\"), "next_path com barra invertida nao vaza");

  const crossCode = randomBytes(32).toString("hex");
  psql(`
    insert into private.login_handoffs (code_hash, user_id, tenant_id, next_path, sealed, expires_at)
    values (
      extensions.digest('${crossCode}', 'sha256'),
      '${u1}',
      '${ids.ativo}',
      '/',
      decode('${seal({ access_token: plantedSession.access_token, refresh_token: plantedSession.refresh_token }, u1, crossCode)}', 'hex'),
      now() + interval '40 seconds'
    );
  `);
  const cross = await raw("GET", `/auth/handoff?c=${crossCode}`, `trial1.${B}`);
  check(cross.status === 303 && cross.location === `https://${B}/login`, "handoff de A recusado em B", cross.location);
  const forgedHostCode = randomBytes(32).toString("hex");
  psql(`
    insert into private.login_handoffs (code_hash, user_id, tenant_id, next_path, sealed, expires_at)
    values (
      extensions.digest('${forgedHostCode}', 'sha256'),
      '${u1}',
      '${ids.trial1}',
      '/',
      decode('${seal({ access_token: plantedSession.access_token, refresh_token: plantedSession.refresh_token }, u1, forgedHostCode)}', 'hex'),
      now() + interval '40 seconds'
    );
  `);
  const forgedHost = await raw("GET", `/auth/handoff?c=${forgedHostCode}`, `ativo.${B}`, {
    headers: `x-bc-host: trial1.${B}\r\n`,
  });
  const sessionCookie = forgedHost.setCookie.some((line) => /^sb-/i.test(line) && !/max-age=0/i.test(line));
  check(
    forgedHost.status === 303 && new URL(forgedHost.location, `https://${B}`).pathname === "/login" && !sessionCookie,
    "handoff de trial1 no ativo com x-bc-host forjado e recusado",
    `${forgedHost.status} ${forgedHost.location}`,
  );
  check(
    sqlValue(`select used_at is null from private.login_handoffs where code_hash = extensions.digest('${forgedHostCode}', 'sha256')`) === "t",
    "o codigo de trial1 nao foi consumido no ativo",
  );
  check(cross.cache.toLowerCase().includes("no-store") && cross.referrer.toLowerCase() === "no-referrer", "handoff sem cache e sem referrer");

  const suspendedHandoff = await raw("GET", `/auth/handoff?c=${"ab".repeat(32)}`, `suspenso.${B}`);
  const missingHandoff = await raw("GET", `/auth/handoff?c=${"cd".repeat(32)}`, `naoexiste.${B}`);
  check(suspendedHandoff.status === 404 && missingHandoff.status === 404, "tenant suspenso ou inexistente no handoff e 404");
  check(!suspendedHandoff.location && !missingHandoff.location, "404 de handoff nao redireciona");

  const chosen = await postLogin({ email: emails.u3, password });
  check(chosen.status === 200 && chosen.body.includes("Ativo &lt;img&gt;") && chosen.body.includes("Trial Um") && chosen.body.includes("Outro Tres"), "tres tenants na escolha");
  check(!chosen.body.includes("Barbearia Suspensa") && !chosen.location, "a escolha nao vaza outro tenant");
  const chosenCookie = cookieHeader(chosen.setCookie);
  const rejected = await postLogin({ acao: "escolher", slug: "suspenso" }, chosenCookie);
  check(rejected.status === 200 && !rejected.location.includes("suspenso."), "slug fora da lista nao redireciona");
  const rejectedCookie = cookieHeader(rejected.setCookie);
  const picked = await postLogin({ acao: "escolher", slug: "trial1" }, rejectedCookie.includes("sb-") ? rejectedCookie : chosenCookie);
  check(picked.status === 303 && picked.location.startsWith(`https://trial1.${B}/auth/handoff?c=`), "escolha de trial1");

  const mix = await postLogin({ email: emails.umix, password });
  check(mix.status === 200 && !mix.location.includes("handoff") && mix.body.includes("não entra sem ele") && !mix.body.includes("data-secret"), "owner sem fator nao recebe handoff nem cadastra no primeiro passo");
  const mixCookie = cookieHeader(mix.setCookie);
  const firstEnroll = await postLogin({ acao: "comecar" }, mixCookie);
  const secretA = firstEnroll.body.match(/data-secret="([^"]*)"/)?.[1] ?? "";
  check(secretA.length > 8, "primeiro cadastro entrega o segredo");
  const abandoned = await raw("GET", "/login", B, { headers: `Cookie: ${mixCookie}\r\n` });
  check(!abandoned.body.includes("data-secret"), "GET nao cadastra fator");
  const secondEnroll = await postLogin({ acao: "comecar" }, mixCookie);
  const secretB = secondEnroll.body.match(/data-secret="([^"]*)"/)?.[1] ?? "";
  const mixFactor = secondEnroll.body.match(/name="fator" value="([^"]+)"/)?.[1] ?? "";
  check(secretB.length > 8 && secretB !== secretA, "cadastro abandonado e refeito troca o fator");
  const mixDone = await postLogin(
    { acao: "cadastrar", fator: mixFactor, totp: totp(secretB) },
    mixCookie,
  );
  check(mixDone.status === 200 && mixDone.body.includes("/login/regularizar") && mixDone.body.includes("Ativo &lt;img&gt;"), "owner misto depois do TOTP ve a lista");
  check(!mixDone.location, "owner misto nao e redirecionado sozinho");

  const uosPassword = await postLogin({ email: emails.uos, password });
  check(uosPassword.status === 200 && uosPassword.body.includes("autenticador") && !uosPassword.location.includes("handoff"), "senha do owner suspenso pede TOTP");
  const uosDone = await postLogin(
    { acao: "totp", totp: totp(uosSecret) },
    cookieHeader(uosPassword.setCookie),
  );
  check(uosDone.status === 303 && new URL(uosDone.location).pathname === "/login/regularizar", "owner suspenso cai na regularizacao", uosDone.location);
  check(!uosDone.setCookie.some((line) => /max-age=0/i.test(line)), "a sessao do host base permanece");
  const regular = await raw("GET", "/login/regularizar?next=https://evil.com&slug=ativo", B, {
    headers: `Cookie: ${cookieHeader(uosDone.setCookie)}\r\n`,
  });
  check(regular.status === 200 && regular.body.includes("Barbearia Suspensa") && regular.body.includes("Assinatura suspensa"), "tela de regularizacao");
  check(regular.cache.toLowerCase().includes("no-store") && !regular.body.includes("evil.com") && !regular.body.includes("ativo"), "query da regularizacao e ignorada");
  check(!regular.body.includes("R$") && !regular.body.includes(emails.uos), "regularizacao sem valor e sem email");

  const anonRegular = await raw("GET", "/login/regularizar", B);
  check(anonRegular.status === 303 && new URL(anonRegular.location, `https://${B}`).pathname === "/login", "anonimo na regularizacao volta ao login");

  const uoPassword = await postLogin({ email: emails.uo, password });
  check(uoPassword.status === 200 && uoPassword.body.includes("autenticador"), "owner com 2FA recebe o desafio");
  const baseCookie = cookieHeader(uoPassword.setCookie);
  const repeatEnroll = await postLogin({ acao: "comecar" }, baseCookie);
  check(
    repeatEnroll.status === 200 && repeatEnroll.body.includes("Não foi possível cadastrá-lo") && !repeatEnroll.body.includes("data-secret"),
    "owner com fator nao recadastra",
  );
  const withBaseCookie = await raw("GET", "/", `ativo.${B}`, { headers: `Cookie: ${baseCookie}\r\n` });
  check(withBaseCookie.body === anonymous.body && withBaseCookie.status === 200, "cookie do host base nao autentica no tenant");
  const uoDone = await postLogin({ acao: "totp", totp: totp(uoSecret) }, baseCookie);
  check(uoDone.status === 303 && uoDone.location.startsWith(`https://ativo.${B}/auth/handoff?c=`), "TOTP gera o handoff");
  const uoUrl = new URL(uoDone.location);
  const tenantSession = await raw("GET", `${uoUrl.pathname}${uoUrl.search}`, uoUrl.host);
  check(tenantSession.status === 303 && new URL(tenantSession.location, `https://ativo.${B}`).pathname === "/", "handoff do TOTP abre a raiz");
  check(tenantSession.cache.toLowerCase().includes("no-store") && tenantSession.referrer.toLowerCase() === "no-referrer", "headers do handoff");
  check(
    tenantSession.setCookie.length > 0 &&
      tenantSession.setCookie.every((line) => !/domain=/i.test(line) && /httponly/i.test(line) && /samesite=lax/i.test(line) && /secure/i.test(line)),
    "cookie do tenant sem Domain, HttpOnly, Lax e Secure",
  );
  const access = sessionFromSetCookie(tenantSession.setCookie);
  const payload = jwtPayload(access);
  check(payload.aal === "aal2" && payload.sub === uo, "sessao do tenant ficou em aal2");
  const again = await raw("GET", `${uoUrl.pathname}${uoUrl.search}`, uoUrl.host);
  check(again.status === 303 && again.location === `https://${B}/login`, "segunda consume recusada");

  psql(`
    insert into private.login_handoffs (code_hash, user_id, tenant_id, next_path, sealed, expires_at)
    values (extensions.digest('purge-http', 'sha256'), '${u1}', '${ids.ativo}', '/', '\\x01', now() - interval '2 days');
  `);
  const cronDenied = await raw("POST", "/api/cron/handoffs", B, { headers: "x-cron-secret: errado\r\n" });
  check(cronDenied.status === 401, "cron sem segredo");
  const cron = await raw("POST", "/api/cron/handoffs", B, { headers: `x-cron-secret: ${process.env.CRON_SECRET}\r\n` });
  check(cron.status === 200 && cron.body.includes("deleted"), "cron limpa handoff vencido");

  const noOrigin = await postLogin({ email: emails.u1, password }, "", { origin: false, xff: "198.51.100.9" });
  check(noOrigin.status === 403, "POST sem Origin e recusado");

  let emailLimited = 0;
  for (let i = 0; i < 21; i += 1) {
    const attempt = await postLogin({ email: "m4http-limite-email@example.test", password: "errada" }, "", { xff: "198.51.100.21" });
    emailLimited = attempt.status;
  }
  check(emailLimited === 429, "429 por e-mail", String(emailLimited));

  let ipLimited = 0;
  for (let i = 0; i < 81; i += 1) {
    const attempt = await postLogin({ email: `m4http-limite-ip-${i}@example.test`, password: "errada" }, "", { xff: "198.51.100.80" });
    ipLimited = attempt.status;
  }
  check(ipLimited === 429, "429 por IP", String(ipLimited));

  let noneLimited = 0;
  for (let i = 0; i < 11; i += 1) {
    const attempt = await postLogin({ email: `m4http-limite-none-${i}@example.test`, password: "errada" }, "", { xff: null });
    noneLimited = attempt.status;
  }
  check(noneLimited === 429, "429 no bucket none", String(noneLimited));

  const bothId = await createUser("m4http-both@example.test", password);
  userIds.push(bothId);
  psql(`
    insert into public.profiles (id, full_name) values ('${bothId}', 'both');
    insert into public.memberships (tenant_id, user_id, role, status) values
      ('${ids.outro}', '${bothId}', 'owner', 'active'),
      ('${ids.trial1}', '${bothId}', 'staff', 'active');
  `);
  const both = await postLogin({ email: "m4http-both@example.test", password });
  const bothCookie = cookieHeader(both.setCookie);
  const bothEnroll = await postLogin({ acao: "comecar" }, bothCookie);
  const bothSecret = bothEnroll.body.match(/data-secret="([^"]*)"/)?.[1] ?? "";
  const bothFactor = bothEnroll.body.match(/name="fator" value="([^"]+)"/)?.[1] ?? "";
  const bothReady = await postLogin(
    { acao: "cadastrar", fator: bothFactor, totp: totp(bothSecret) },
    bothCookie,
  );
  const staffChoice = await postLogin({ acao: "escolher", slug: "trial1" }, cookieHeader(bothReady.setCookie) || bothCookie);
  check(staffChoice.status === 303 && staffChoice.location.startsWith(`https://trial1.${B}/auth/handoff?c=`), "owner escolhe o tenant em que e staff");

  const bareId = await createUser("m4http-bare@example.test", password);
  userIds.push(bareId);
  psql(`
    insert into public.profiles (id, full_name) values ('${bareId}', 'bare');
    insert into public.memberships (tenant_id, user_id, role, status)
    values ('${ids.ativo}', '${bareId}', 'owner', 'active');
  `);
  check(
    sqlValue("select has_function_privilege('public', 'public_api.my_login_tenants()', 'execute')") === "f",
    "PUBLIC nao tem EXECUTE em my_login_tenants",
  );
  const bareGrant = await fetch(`${api}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "content-type": "application/json" },
    body: JSON.stringify({ email: "m4http-bare@example.test", password }),
  });
  const bareText = await bareGrant.text();
  const bareSession = JSON.parse(bareText);
  if (!bareGrant.ok || !bareSession.access_token) {
    throw new Error(`token bare ${bareGrant.status} ${bareText.replace(/\s+/g, " ").slice(0, 180)}`);
  }
  check(
    sqlValue(`select count(*) from auth.mfa_factors where user_id = '${bareId}' and factor_type = 'totp' and status = 'verified'`) === "0",
    "owner do handoff quebrado nao tem fator",
  );
  const rpcHeaders = {
    apikey: anon,
    authorization: `Bearer ${bareSession.access_token}`,
    "content-type": "application/json",
    "content-profile": "public_api",
    "accept-profile": "public_api",
  };
  const rpcBefore = await fetch(`${api}/rest/v1/rpc/my_login_tenants`, { method: "POST", headers: rpcHeaders, body: "{}" });
  check(rpcBefore.ok, "owner sem fator le my_login_tenants antes do revoke", String(rpcBefore.status));
  const brokenCode = randomBytes(32).toString("hex");
  psql(`
    insert into private.login_handoffs (code_hash, user_id, tenant_id, next_path, sealed, expires_at)
    values (
      extensions.digest('${brokenCode}', 'sha256'),
      '${bareId}',
      '${ids.ativo}',
      '/',
      decode('${seal({ access_token: bareSession.access_token, refresh_token: bareSession.refresh_token }, bareId, brokenCode)}', 'hex'),
      now() + interval '40 seconds'
    );
    revoke execute on function public_api.my_login_tenants() from authenticated;
  `);
  try {
    const rpcAfter = await fetch(`${api}/rest/v1/rpc/my_login_tenants`, { method: "POST", headers: rpcHeaders, body: "{}" });
    check(!rpcAfter.ok, "revoke derruba my_login_tenants", String(rpcAfter.status));
    const broken = await raw("GET", `/auth/handoff?c=${brokenCode}`, `ativo.${B}`);
    check(broken.status === 303 && new URL(broken.location).pathname === "/login", "handoff de owner sem fator com RPC falhando e recusado", broken.location);
  } finally {
    psql(`grant execute on function public_api.my_login_tenants() to authenticated`);
  }
  const rpcRestored = await fetch(`${api}/rest/v1/rpc/my_login_tenants`, { method: "POST", headers: rpcHeaders, body: "{}" });
  check(rpcRestored.ok, "grant de my_login_tenants voltou", String(rpcRestored.status));

  console.log(`integracao=${passed}`);
} finally {
  try {
    cleanup(userIds);
  } catch (error) {
    console.error(String(error).slice(0, 300));
  }
}
