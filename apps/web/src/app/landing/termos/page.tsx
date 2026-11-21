import { canonicalUrl, loadConfig } from "@barberclub/core";
import type { Metadata } from "next";

export function generateMetadata(): Metadata {
  const cfg = loadConfig();
  return {
    title: "Termos",
    alternates: { canonical: canonicalUrl({ kind: "landing" }, "/termos", cfg) },
  };
}

export default function TermosPage() {
  return (
    <main>
      <h1>Termos</h1>
      <p>Texto provisório. O rascunho definitivo fica com o Hermes e não bloqueia esta etapa.</p>
    </main>
  );
}
