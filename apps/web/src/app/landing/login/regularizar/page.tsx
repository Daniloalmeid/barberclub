import { LINKS } from "@barberclub/config/links";
import { parseRegularizationRow } from "@barberclub/core";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signOutLocal } from "../actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Regularizar",
  robots: { index: false, follow: false },
};

const LABELS: Record<string, string> = {
  past_due: "Pagamento em atraso",
  suspended: "Assinatura suspensa",
};

async function rows(): Promise<ReturnType<typeof parseRegularizationRow>[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return [];
  const response = await fetch(
    `${url.replace(/\/$/, "")}/rest/v1/rpc/my_regularization_tenants?select=slug,display_name,status,reason_code,action_code`,
    {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "content-profile": "public_api",
        "accept-profile": "public_api",
      },
      body: "{}",
      cache: "no-store",
    },
  );
  if (!response.ok) redirect("/login");
  const body: unknown = await response.json();
  if (!Array.isArray(body)) redirect("/login");
  return body.map((row) => parseRegularizationRow(row));
}

export default async function RegularizarPage() {
  const list = await rows();
  if (list.length === 0) redirect("/login");
  return (
    <main>
      <h1>Regularizar</h1>
      <ul>
        {list.map((item) => (
          <li key={item.slug}>
            <p>{item.display_name}</p>
            <p>{LABELS[item.status] ?? item.status}</p>
            <a href={LINKS.regularizar} target="_blank" rel="noopener noreferrer">
              Regularizar
            </a>
          </li>
        ))}
      </ul>
      <p>
        <a href={LINKS.suporte} target="_blank" rel="noopener noreferrer">
          Falar com o suporte
        </a>
      </p>
      <form action={signOutLocal}>
        <button type="submit">Sair</button>
      </form>
    </main>
  );
}
