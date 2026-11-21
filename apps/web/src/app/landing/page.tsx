import { CONTACT_EMAIL, LINKS } from "@barberclub/config/links";
import { canonicalUrl, loadConfig } from "@barberclub/core";
import type { Metadata } from "next";

export function generateMetadata(): Metadata {
  const cfg = loadConfig();
  return { title: "BarberClub", alternates: { canonical: canonicalUrl({ kind: "landing" }, "/", cfg) } };
}

export default function LandingPage() {
  return (
    <main>
      <h1>BarberClub</h1>
      <p>Agenda e página da barbearia, no domínio dela.</p>
      <p>
        <a href="/login">Entrar</a>
      </p>
      <p>
        <a href={LINKS.queroTestar} target="_blank" rel="noopener noreferrer">
          Quero testar
        </a>
      </p>
      <footer>
        <a href="/termos">Termos</a>
        <a href="/privacidade">Privacidade</a>
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        <a href={LINKS.suporte} target="_blank" rel="noopener noreferrer">
          Falar com o suporte
        </a>
      </footer>
    </main>
  );
}
