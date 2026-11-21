import { LOGIN_FAILURE_MESSAGE, safeNextPath } from "@barberclub/core";
import type { Metadata } from "next";
import { loginAction, signOutLocal } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Entrar",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; next?: string }>;
}) {
  const query = await searchParams;
  const next = safeNextPath(query.next) ?? "";
  return (
    <main>
      <h1>Entrar</h1>
      {query.erro ? <p>{LOGIN_FAILURE_MESSAGE}</p> : null}
      <form action={loginAction}>
        <input type="hidden" name="next" defaultValue={next} />
        <label>
          E-mail
          <input name="email" type="email" autoComplete="username" />
        </label>
        <label>
          Senha
          <input name="password" type="password" autoComplete="current-password" />
        </label>
        <button type="submit">Entrar</button>
      </form>
      <form action={signOutLocal}>
        <button type="submit">Sair</button>
      </form>
    </main>
  );
}
