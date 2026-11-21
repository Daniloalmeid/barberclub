import { CONTACT_EMAIL, LINKS } from "@barberclub/config/links";
import { canonicalUrl, loadConfig } from "@barberclub/core";
import type { Metadata } from "next";

export function generateMetadata(): Metadata {
  const cfg = loadConfig();
  return {
    title: "BarberClub — a página e a agenda da sua barbearia",
    description:
      "A página e a agenda da sua barbearia no endereço dela. O cliente vê os serviços, escolhe o horário e marca sozinho.",
    alternates: { canonical: canonicalUrl({ kind: "landing" }, "/", cfg) },
  };
}

const blocos = [
  {
    titulo: "Página no endereço da barbearia",
    texto:
      "Um endereço próprio, com nome, serviços e horários. Quem recebe o link cai na sua barbearia, não num perfil no meio de outros.",
    exemplo: "sua-barbearia.barber.workloop.com.br",
  },
  {
    titulo: "Agenda que o cliente usa sozinho",
    texto:
      "Horário livre aparece, horário ocupado não. O cliente marca sem esperar resposta e sem trocar mensagem.",
    exemplo: null,
  },
  {
    titulo: "Painel simples para o dono",
    texto:
      "Serviços, equipe e horários num lugar só. Sem planilha, sem caderno e sem precisar de alguém para atualizar.",
    exemplo: null,
  },
];

const passos = [
  { titulo: "Você chama no WhatsApp", texto: "Conta o nome da barbearia e o que ela oferece." },
  { titulo: "A gente monta a página", texto: "Com os serviços e horários que você passar." },
  { titulo: "Você recebe o acesso", texto: "E passa a marcar os horários direto no painel." },
];

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 sm:px-8">
      <header className="flex items-center justify-between border-b border-neutral-200 py-6">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="block h-6 w-1.5 rounded-full bg-neutral-900" />
          <span className="text-lg font-semibold tracking-tight">BarberClub</span>
        </span>
        <a
          href="/login"
          className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
        >
          Entrar
        </a>
      </header>

      <section className="pt-14 pb-4 sm:pt-20">
        <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">
          Para barbearias
        </p>
        <h1 className="mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
          A página e a agenda da sua barbearia, no endereço dela.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-neutral-600 sm:text-lg">
          Seu cliente abre o link, vê os serviços e escolhe o horário sozinho. Sem esperar
          resposta e sem depender de rede social para encontrar a barbearia.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a
            href={LINKS.queroTestar}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl bg-neutral-900 px-6 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-neutral-700"
          >
            Quero testar
          </a>
          <a
            href={LINKS.suporte}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border border-neutral-300 px-6 py-3 text-center text-sm font-medium text-neutral-800 transition-colors hover:border-neutral-900"
          >
            Falar com o suporte
          </a>
        </div>
        <p className="mt-4 text-sm text-neutral-500">
          Atendimento direto no WhatsApp, com quem monta a página.
        </p>
      </section>

      <section className="mt-14 grid gap-4 sm:mt-20 sm:grid-cols-3" aria-label="O que a página faz">
        {blocos.map((bloco) => (
          <article key={bloco.titulo} className="rounded-2xl border border-neutral-200 p-6">
            <h2 className="text-sm font-semibold tracking-tight text-neutral-900">
              {bloco.titulo}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">{bloco.texto}</p>
            {bloco.exemplo ? (
              <p className="mt-4 break-all font-mono text-[11px] leading-relaxed text-neutral-500">
                {bloco.exemplo}
              </p>
            ) : null}
          </article>
        ))}
      </section>

      <section className="mt-6 rounded-2xl bg-neutral-50 p-6 sm:mt-8 sm:p-10">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-neutral-500">
          Como começar
        </h2>
        <ol className="mt-6 grid gap-6 sm:grid-cols-3">
          {passos.map((passo, indice) => (
            <li key={passo.titulo}>
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white">
                {indice + 1}
              </span>
              <h3 className="mt-3 text-sm font-semibold text-neutral-900">{passo.titulo}</h3>
              <p className="mt-1 text-sm leading-relaxed text-neutral-600">{passo.texto}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="mt-auto flex flex-col gap-3 border-t border-neutral-200 py-8 text-sm text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Rodapé">
          <a href="/termos" className="hover:text-neutral-900">
            Termos
          </a>
          <a href="/privacidade" className="hover:text-neutral-900">
            Privacidade
          </a>
          <a href={`mailto:${CONTACT_EMAIL}`} className="break-all hover:text-neutral-900">
            {CONTACT_EMAIL}
          </a>
        </nav>
        <p className="text-neutral-400">BarberClub</p>
      </footer>
    </main>
  );
}
