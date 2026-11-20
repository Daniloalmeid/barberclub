import { Client } from "pg";

const url = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const rounds = Number(process.env.CONCURRENCY_ROUNDS ?? "20");

type Ids = {
  tenant: string;
  service: string;
  owner: string;
  customers: string[];
  users: string[];
  staff: string[];
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connect() {
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("set statement_timeout = '20s'");
  return client;
}

function pgCode(error: unknown): string {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "";
}

async function waitUntil(label: string, probe: () => Promise<boolean>) {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    if (await probe()) return;
    await sleep(40);
  }
  throw new Error(`timeout: ${label}`);
}

async function blockedSessions(watch: Client, pids: number[]) {
  const result = await watch.query<{ n: string }>(
    `select count(distinct a.pid)::text as n
       from pg_stat_activity a
      where a.pid = any($1::int[])
        and a.wait_event_type = 'Lock'`,
    [pids],
  );
  return Number(result.rows[0]?.n ?? "0");
}

async function sessionPid(client: Client) {
  const result = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
  const pid = result.rows[0]?.pid;
  if (!pid) throw new Error("sem pid");
  return pid;
}

async function asUser(client: Client, userId: string) {
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  await client.query(
    "select set_config('request.jwt.claims', json_build_object('sub', $1::uuid, 'role', 'authenticated')::text, true)",
    [userId],
  );
  await client.query("set local role authenticated");
}

async function book(client: Client, ids: Ids, userIndex: number, staffIndex: number, starts: string, key: string) {
  await client.query("begin");
  await asUser(client, ids.users[userIndex] ?? "");
  return client.query<{ book_appointment: string }>(
    "select public_api.book_appointment($1,$2,$3,$4::timestamptz,$5)",
    [ids.tenant, ids.staff[staffIndex], ids.service, starts, key],
  );
}

async function setup(): Promise<Ids> {
  const admin = await connect();
  const tag = Math.random().toString(16).slice(2, 8);
  const created = await admin.query<Ids>(`
    with users as (
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change
      )
      select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
             'c' || g || '.${tag}@example.test', extensions.crypt('password', extensions.gen_salt('bf')), now(),
             '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
        from generate_series(1, 8) g
      returning id, email
    ),
    prof as (
      insert into public.profiles (id, full_name)
      select id, email from users
      returning id
    ),
    tenant as (
      insert into public.tenants (slug, display_name, status, timezone)
      values ('concorrencia-' || substr(gen_random_uuid()::text, 1, 8), 'Concorrencia', 'active', 'America/Sao_Paulo')
      returning id
    ),
    branding as (
      insert into public.tenant_branding (tenant_id) select id from tenant
    ),
    settings as (
      insert into public.tenant_settings (tenant_id) select id from tenant
    ),
    plan as (
      insert into public.plans (code, name, price_cents)
      values ('c-' || substr(gen_random_uuid()::text, 1, 8), 'C', 0)
      returning id
    ),
    sub as (
      insert into public.subscriptions (tenant_id, plan_id, status)
      select tenant.id, plan.id, 'active' from tenant, plan
    ),
    owner as (
      insert into public.memberships (tenant_id, user_id, role)
      select tenant.id, users.id, 'owner'
        from tenant, users
       where users.email = 'c1.${tag}@example.test'
    ),
    cust as (
      insert into public.customers (tenant_id, user_id, full_name, email)
      select tenant.id, users.id, users.email, users.email
        from tenant
        join users on users.email in ('c2.${tag}@example.test', 'c3.${tag}@example.test')
      returning id, user_id
    ),
    staff as (
      insert into public.staff (tenant_id, user_id, display_name)
      select tenant.id, users.id, users.email
        from tenant
        join users on users.email in ('c4.${tag}@example.test','c5.${tag}@example.test','c6.${tag}@example.test','c7.${tag}@example.test','c8.${tag}@example.test')
      returning id, display_name
    ),
    mem as (
      insert into public.memberships (tenant_id, user_id, role)
      select tenant.id, users.id, 'staff'
        from tenant
        join users on users.email in ('c4.${tag}@example.test','c5.${tag}@example.test','c6.${tag}@example.test','c7.${tag}@example.test','c8.${tag}@example.test')
    ),
    svc as (
      insert into public.services (tenant_id, name, duration_min, price_cents, active)
      select id, 'Corte', 30, 5000, true from tenant
      returning id, tenant_id
    ),
    link as (
      insert into public.staff_services (tenant_id, staff_id, service_id, active)
      select svc.tenant_id, staff.id, svc.id, true from svc, staff
    ),
    sched as (
      insert into public.work_schedules (tenant_id, staff_id, weekday, start_time, end_time)
      select svc.tenant_id, staff.id, d, time '08:00', time '18:00'
        from svc, staff, generate_series(0, 6) d
    ),
    accts as (
      insert into ledger.accounts (tenant_id, code, name, type)
      select tenant.id, v.code, v.name, v.type
        from tenant
        cross join (values
          ('1.1.01','Recebiveis','asset'),
          ('1.1.02','Saldo','asset'),
          ('1.1.03','Caixa','asset'),
          ('2.1.01','Comissoes','liability'),
          ('2.1.02','Reembolsos','liability'),
          ('4.1.01','Receita','revenue'),
          ('4.9.01','Devolucoes','contra_revenue'),
          ('5.1.01','Taxas','expense'),
          ('5.1.02','Comissao','expense')
        ) as v(code, name, type)
    )
    select
      (select id from tenant) as tenant,
      (select id from svc) as service,
      (select id from users where email = 'c1.${tag}@example.test') as owner,
      (select array_agg(id order by user_id) from cust) as customers,
      (select array_agg(user_id order by user_id) from cust) as users,
      (select array_agg(id order by display_name) from staff) as staff
  `);
  await admin.end();
  const ids = created.rows[0];
  if (!ids?.tenant || !ids.service || !ids.owner || ids.users.length < 2 || ids.staff.length < 5) {
    throw new Error("fixture de concorrência incompleta");
  }
  return ids;
}

function slot(dayOffset: number, hour: number, minute = 0) {
  const date = new Date(Date.UTC(2027, 5, 1 + dayOffset));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}:00-03`;
}

async function c01(ids: Ids, round: number) {
  const a = await connect();
  const b = await connect();
  const watch = await connect();
  try {
    const pidB = await sessionPid(b);
    await book(a, ids, 0, 0, slot(1000 + round, 10), `c01-a-${round}`);
    const pending = book(b, ids, 1, 0, slot(1000 + round, 10), `c01-b-${round}`);
    await waitUntil("C01 B bloqueada", async () => (await blockedSessions(watch, [pidB])) === 1);
    await a.query("commit");
    let failed = false;
    try {
      await pending;
    } catch (error) {
      failed = pgCode(error) === "23P01";
      if (!failed) throw error;
      await b.query("rollback");
    }
    if (!failed) throw new Error("C01 a segunda reserva não recebeu 23P01");
    const left = await watch.query(
      "select count(*)::int as n from public.staff_busy b join public.appointments a on a.id = b.appointment_id where a.tenant_id = $2 and a.idempotency_key = $1 and b.active",
      [`c01-a-${round}`, ids.tenant],
    );
    if (left.rows[0]?.n !== 1) throw new Error("C01 ocupação ativa diferente de 1");
  } finally {
    await Promise.all([a.end(), b.end(), watch.end()]);
  }
}

async function c02(ids: Ids, round: number, timeOffFirst: boolean) {
  const holder = await connect();
  const waiter = await connect();
  const watch = await connect();
  const starts = slot(2000 + round, timeOffFirst ? 11 : 12);
  const ends = slot(2000 + round, timeOffFirst ? 12 : 13);
  const key = `c02-${round}-${timeOffFirst}`;
  const timeOff = async (client: Client) => {
    await client.query("begin");
    await asUser(client, ids.owner);
    return client.query("select public_api.create_time_off($1,$2,$3::timestamptz,$4::timestamptz,$5)", [
      ids.tenant,
      ids.staff[1],
      starts,
      ends,
      "bloqueio",
    ]);
  };
  try {
    if (timeOffFirst) await timeOff(holder);
    else await book(holder, ids, 0, 1, starts, key);
    const pid = await sessionPid(waiter);
    const pending = timeOffFirst ? book(waiter, ids, 0, 1, starts, key) : timeOff(waiter);
    await waitUntil("C02 segundo bloqueado", async () => (await blockedSessions(watch, [pid])) === 1);
    await holder.query("commit");
    let failed = false;
    try {
      await pending;
      await waiter.query("commit");
    } catch (error) {
      failed = pgCode(error) === "23P01";
      if (!failed) throw error;
      await waiter.query("rollback");
    }
    if (!failed) throw new Error("C02 o segundo não recebeu 23P01");
  } finally {
    await Promise.all([holder.end(), waiter.end(), watch.end()]);
  }
}

async function c03(ids: Ids, round: number) {
  const a = await connect();
  const b = await connect();
  const watch = await connect();
  const starts = slot(3000 + round, 10);
  const key = `c03-${round}`;
  try {
    const one = book(a, ids, 0, 2, starts, key).then(async (result) => {
      await a.query("commit");
      return result;
    });
    const two = book(b, ids, 0, 2, starts, key).then(async (result) => {
      await b.query("commit");
      return result;
    });
    const [left, right] = await Promise.all([one, two]);
    const idA = left.rows[0]?.book_appointment;
    const idB = right.rows[0]?.book_appointment;
    if (!idA || idA !== idB) throw new Error(`C03 ids diferentes ${idA} ${idB}`);
    const count = await watch.query(
      "select count(*)::int as n from public.appointments where tenant_id = $2 and idempotency_key = $1",
      [key, ids.tenant],
    );
    if (count.rows[0]?.n !== 1) throw new Error("C03 não ficou em uma linha");
  } finally {
    await Promise.all([a.end(), b.end(), watch.end()]);
  }
}

async function preparePayment(ids: Ids, starts: string, key: string, status: string, hold: string) {
  const admin = await connect();
  const inserted = await admin.query<{ appointment: string; payment: string }>(
    `with appt as (
       insert into public.appointments (
         tenant_id, staff_id, customer_id, service_id, starts_at, ends_at, status,
         hold_expires_at, idempotency_key, request_hash, price_cents
       ) values (
         $1, $2, $3, $4, $5::timestamptz, $5::timestamptz + interval '30 minutes', $6,
         $7::timestamptz, $8, private.request_hash($2, $4, $5::timestamptz), 5000
       ) returning id, tenant_id, staff_id, starts_at, ends_at
     ), busy as (
       insert into public.staff_busy (tenant_id, staff_id, period, appointment_id, active)
       select tenant_id, staff_id, tstzrange(starts_at, ends_at, '[)'), id, $6 in ('hold','pending_payment','confirmed')
         from appt
     ), pay as (
       insert into public.payments (tenant_id, appointment_id, amount_cents, fee_cents, status, provider)
       select tenant_id, id, 5000, 0, 'pending', 'asaas' from appt
       returning id, appointment_id
     )
     select appointment_id as appointment, id as payment from pay`,
    [ids.tenant, ids.staff[3], ids.customers[0], ids.service, starts, status, hold, key],
  );
  await admin.end();
  const row = inserted.rows[0];
  if (!row) throw new Error("pagamento de teste não criado");
  return row;
}

async function c04(ids: Ids, round: number) {
  const starts = slot(4000 + round, 10);
  const row = await preparePayment(ids, starts, `c04-${round}`, "pending_payment", "now() + interval '30 minutes'".includes("now") ? starts : starts);
  const admin = await connect();
  await admin.query("update public.appointments set hold_expires_at = now() + interval '30 minutes' where id = $1", [row.appointment]);
  await admin.end();
  const a = await connect();
  const b = await connect();
  const watch = await connect();
  try {
    const eventId = `c04-${round}-${Math.random().toString(16).slice(2)}`;
    const call = (client: Client) =>
      client
        .query("select server_api.process_payment_event('asaas', $1, $2, 'paid', 5000)", [eventId, row.payment])
        .then(async (result) => {
          await client.query("commit");
          return result.rows[0];
        });
    await a.query("begin");
    await a.query("set local role service_role");
    await b.query("begin");
    await b.query("set local role service_role");
    const [left, right] = await Promise.allSettled([call(a), call(b)]);
    const values = [left, right].map((item) => (item.status === "fulfilled" ? Object.values(item.value ?? {})[0] : pgCode(item.reason)));
    const ok = values.filter((value) => value === "confirmed").length === 1 && values.filter((value) => value === "duplicate_event").length === 1;
    if (!ok) {
      const detail = [left, right]
        .map((item) => (item.status === "rejected" ? String(item.reason) : "ok"))
        .join(" | ");
      throw new Error(`C04 resultado inesperado ${values.join(",")} :: ${detail}`);
    }
    const entries = await watch.query(
      "select count(*)::int as n from ledger.journal_entries where source_id = $1 and kind = 'payment'",
      [row.payment],
    );
    if (entries.rows[0]?.n !== 1) throw new Error("C04 mais de um lançamento");
  } finally {
    await Promise.all([a.end(), b.end(), watch.end()]);
  }
}

async function c05(ids: Ids, round: number) {
  const starts = slot(5000 + round, 11);
  const late = await preparePayment(ids, starts, `c05-late-${round}`, "expired", starts);
  const admin = await connect();
  await admin.query(
    "update public.appointments set hold_expires_at = now() - interval '5 minutes', status = 'expired' where id = $1",
    [late.appointment],
  );
  await admin.query("update public.staff_busy set active = false where appointment_id = $1", [late.appointment]);
  await admin.end();
  const booking = await connect();
  const payment = await connect();
  const barrier = await connect();
  const watch = await connect();
  try {
    const bookingPid = await sessionPid(booking);
    const paymentPid = await sessionPid(payment);
    await barrier.query("begin");
    await barrier.query("select pg_advisory_xact_lock(hashtextextended('staff:' || $1 || ':' || $2, 0))", [ids.tenant, ids.staff[3]]);
    const bookCall = book(booking, ids, 1, 3, starts, `c05-book-${round}`);
    await payment.query("begin");
    await payment.query("set local role service_role");
    const payCall = payment.query("select server_api.process_payment_event('asaas', $1, $2, 'paid', 5000)", [
      `c05-${round}-${Math.random().toString(16).slice(2)}`,
      late.payment,
    ]);
    await waitUntil("C05 os dois bloqueados", async () => (await blockedSessions(watch, [bookingPid, paymentPid])) >= 1);
    await sleep(80);
    await barrier.query("commit");
    const results = await Promise.allSettled([bookCall, payCall]);
    for (const client of [booking, payment]) {
      try {
        await client.query("commit");
      } catch {
        await client.query("rollback");
      }
    }
    const codes = results.map((item) => (item.status === "rejected" ? pgCode(item.reason) : "ok"));
    const state = await watch.query<{ appt: string; pay: string; busy: number }>(
      `select a.status as appt, p.status as pay,
              (select count(*)::int from public.staff_busy b where b.staff_id = $2 and b.active and b.period && tstzrange($3::timestamptz, $3::timestamptz + interval '30 minutes')) as busy
         from public.appointments a
         join public.payments p on p.appointment_id = a.id
        where a.id = $1`,
      [late.appointment, ids.staff[3], starts],
    );
    const row = state.rows[0];
    if (!row || row.busy !== 1) throw new Error(`C05 horário ficou com ${row?.busy} ocupações (${codes.join(",")})`);
    const coherent =
      (row.appt === "payment_conflict" && row.pay === "paid_unallocated") ||
      (row.appt === "confirmed" && row.pay === "paid") ||
      row.appt === "expired";
    if (!coherent && !codes.includes("23P01")) {
      throw new Error(`C05 estado ${row.appt}/${row.pay} códigos ${codes.join(",")}`);
    }
  } finally {
    await Promise.all([booking.end(), payment.end(), barrier.end(), watch.end()]);
  }
}

async function c06(ids: Ids, round: number) {
  const calls = Array.from({ length: 50 }, async (_, index) => {
    const client = await connect();
    const staff = index % ids.staff.length;
    const starts = slot(6000 + round, 8 + (index % 8), (index * 7) % 30);
    try {
      await client.query("begin");
      await asUser(client, ids.users[index % ids.users.length] ?? "");
      await client.query("select public_api.book_appointment($1,$2,$3,$4::timestamptz,$5)", [
        ids.tenant,
        ids.staff[staff],
        ids.service,
        starts,
        `c06-${round}-${index}`,
      ]);
      await client.query("commit");
      return "ok";
    } catch (error) {
      const code = pgCode(error);
      await client.query("rollback").catch(() => undefined);
      if (code === "23P01" || code === "22023") return code;
      throw error;
    } finally {
      await client.end();
    }
  });
  await Promise.all(calls);
  const watch = await connect();
  const overlap = await watch.query(
    `select count(*)::int as n
       from public.staff_busy a
       join public.staff_busy b
         on a.staff_id = b.staff_id
        and a.id < b.id
        and a.active and b.active
        and a.period && b.period
      where a.tenant_id = $1`,
    [ids.tenant],
  );
  const counts = await watch.query(
    `select
       (select count(*)::int from public.appointments where tenant_id = $1 and status in ('hold','pending_payment','confirmed')) as appts,
       (select count(*)::int from public.staff_busy where tenant_id = $1 and active and appointment_id is not null) as busy`,
    [ids.tenant],
  );
  await watch.end();
  if (overlap.rows[0]?.n !== 0) throw new Error("C06 há sobreposição");
  if (counts.rows[0]?.appts !== counts.rows[0]?.busy) throw new Error("C06 contagens não batem");
}

async function c07(ids: Ids, round: number) {
  const starts = slot(7000 + round, 11);
  const insertPair = async (client: Client, key: string) => {
    await client.query("begin");
    const created = await client.query<{ id: string }>(
      `insert into public.appointments (
         tenant_id, staff_id, customer_id, service_id, starts_at, ends_at, status, hold_expires_at, idempotency_key, request_hash
       ) values (
         $1, $2, $3, $4, $5::timestamptz, $5::timestamptz + interval '30 minutes', 'hold', now() + interval '1 hour', $6,
         private.request_hash($2, $4, $5::timestamptz)
       ) returning id`,
      [ids.tenant, ids.staff[4], ids.customers[1], ids.service, starts, key],
    );
    await client.query(
      "insert into public.staff_busy (tenant_id, staff_id, period, appointment_id) select tenant_id, staff_id, tstzrange(starts_at, ends_at, '[)'), id from public.appointments where id = $1",
      [created.rows[0]?.id],
    );
  };
  const a = await connect();
  const b = await connect();
  const watch = await connect();
  try {
    await insertPair(a, `c07-a-${round}`);
    const second = insertPair(b, `c07-b-${round}`).then(
      async () => {
        await b.query("commit");
        return "committed" as const;
      },
      async (error: unknown) => {
        await b.query("rollback").catch(() => undefined);
        if (pgCode(error) === "23P01") return "blocked" as const;
        throw error;
      },
    );
    await a.query("commit");
    if ((await second) !== "blocked") throw new Error("C07 o EXCLUDE não barrou o segundo");
  } finally {
    await Promise.all([a.end(), b.end(), watch.end()]);
  }
}

async function c08(ids: Ids, round: number) {
  const starts = slot(8000 + round, 12);
  const row = await preparePayment(ids, starts, `c08-${round}`, "pending_payment", starts);
  const admin = await connect();
  await admin.query("update public.appointments set hold_expires_at = now() + interval '1 hour', status = 'pending_payment' where id = $1", [
    row.appointment,
  ]);
  await admin.end();
  const cancel = await connect();
  const payment = await connect();
  const barrier = await connect();
  const watch = await connect();
  const cancelFirst = round % 2 === 0;
  try {
    const cancelPid = await sessionPid(cancel);
    const paymentPid = await sessionPid(payment);
    await barrier.query("begin");
    await barrier.query("select pg_advisory_xact_lock(hashtextextended('staff:' || $1 || ':' || $2, 0))", [ids.tenant, ids.staff[3]]);
    const startCancel = async () => {
      await cancel.query("begin");
      await asUser(cancel, ids.users[0] ?? "");
      return cancel.query("select public_api.cancel_appointment($1, 'teste')", [row.appointment]);
    };
    const startPay = async () => {
      await payment.query("begin");
      await payment.query("set local role service_role");
      return payment.query("select server_api.process_payment_event('asaas', $1, $2, 'paid', 5000)", [
        `c08-${round}-${Math.random().toString(16).slice(2)}`,
        row.payment,
      ]);
    };
    const first = cancelFirst ? startCancel() : startPay();
    await waitUntil("C08 primeiro", async () => (await blockedSessions(watch, [cancelFirst ? cancelPid : paymentPid])) === 1);
    const second = cancelFirst ? startPay() : startCancel();
    await waitUntil("C08 segundo", async () => (await blockedSessions(watch, [cancelPid, paymentPid])) === 2);
    await barrier.query("commit");
    const winner = cancelFirst ? cancel : payment;
    const loser = cancelFirst ? payment : cancel;
    try {
      await first;
      await winner.query("commit");
    } catch (error) {
      if (pgCode(error) === "40P01") throw new Error("C08 deadlock");
      throw error;
    }
    try {
      await second;
      await loser.query("commit");
    } catch (error) {
      if (pgCode(error) === "40P01") throw new Error("C08 deadlock");
      await loser.query("rollback");
      throw error;
    }
    const state = await watch.query<{ appt: string; pay: string; refunds: number }>(
      `select a.status as appt, p.status as pay,
              (select count(*)::int from public.refund_requests r where r.payment_id = p.id) as refunds
         from public.appointments a
         join public.payments p on p.id = $2
        where a.id = $1`,
      [row.appointment, row.payment],
    );
    const found = state.rows[0];
    const cancelWon = found?.appt === "canceled" && found.pay === "paid_unallocated" && found.refunds === 1;
    const payWon = found?.appt === "canceled" && found.pay === "refund_pending" && found.refunds === 1;
    if (cancelFirst && !cancelWon) {
      throw new Error(`C08 cancel primeiro ficou ${found?.appt}/${found?.pay}/${found?.refunds}`);
    }
    if (!cancelFirst && !payWon) {
      throw new Error(`C08 pagamento primeiro ficou ${found?.appt}/${found?.pay}/${found?.refunds}`);
    }
    const balanced = await watch.query(
      "select coalesce(sum(debit_cents),0) = coalesce(sum(credit_cents),0) as ok from ledger.journal_lines where tenant_id = $1",
      [ids.tenant],
    );
    if (!balanced.rows[0]?.ok) throw new Error("C08 ledger não soma zero");
  } finally {
    await Promise.all([cancel.end(), payment.end(), barrier.end(), watch.end()]);
  }
}

async function deadlocks() {
  const client = await connect();
  const result = await client.query<{ deadlocks: string }>(
    "select deadlocks::text from pg_stat_database where datname = current_database()",
  );
  await client.end();
  return Number(result.rows[0]?.deadlocks ?? "0");
}

async function main() {
  const before = await deadlocks();
  const ids = await setup();
  for (let round = 0; round < rounds; round += 1) {
    await c01(ids, round);
    await c02(ids, round, true);
    await c02(ids, round, false);
    await c03(ids, round);
    await c04(ids, round);
    await c05(ids, round);
    await c06(ids, round);
    await c07(ids, round);
    await c08(ids, round);
    console.log(`rodada ${round + 1}/${rounds} ok`);
  }
  const after = await deadlocks();
  if (after > before) throw new Error(`deadlocks subiram de ${before} para ${after}`);
  console.log(`C01–C08 x ${rounds} ok; deadlocks ${before} -> ${after}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
