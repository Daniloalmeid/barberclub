export const LINKS = {
  queroTestar: "https://wa.me/5511974980310?text=Quero%20testar%20o%20BarberClub",
  suporte: "https://wa.me/5511974980310?text=Preciso%20de%20ajuda%20com%20o%20BarberClub",
  regularizar: "https://wa.me/5511974980310?text=Quero%20regularizar%20minha%20assinatura",
} as const;

export const CONTACT_EMAIL = "danilotecteatro@yahoo.com.br";
export const EXTERNAL_LINK_ALLOWLIST = ["https://wa.me/"] as const;

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export function assertExternal(url: string): void {
  if (url.includes("⟦") || url.includes("⟧")) {
    throw new Error("link externo com placeholder");
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
    throw new Error("link externo invalido");
  }
  if (parsed.hostname !== "wa.me") {
    throw new Error("link externo fora de wa.me");
  }
  if (!EXTERNAL_LINK_ALLOWLIST.some((prefix) => url.startsWith(prefix))) {
    throw new Error("link externo fora da allowlist");
  }
}

export function assertContactEmail(value: string): void {
  if (!EMAIL_RE.test(value) || value.includes("⟦")) {
    throw new Error("e-mail de contato invalido");
  }
}

for (const url of Object.values(LINKS)) {
  assertExternal(url);
}
assertContactEmail(CONTACT_EMAIL);
