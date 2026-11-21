import { canonicalUrl, loadConfig } from "@barberclub/core";
import type { Metadata } from "next";

export function generateMetadata(): Metadata {
  const cfg = loadConfig();
  return {
    title: "Privacidade",
    alternates: { canonical: canonicalUrl({ kind: "landing" }, "/privacidade", cfg) },
  };
}

export default function PrivacidadePage() {
  return (
    <main>
      <h1>Privacidade</h1>
      <p>Texto provisório. O rascunho definitivo fica com o Hermes e não bloqueia esta etapa.</p>
    </main>
  );
}
