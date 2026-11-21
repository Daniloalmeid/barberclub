"use server";

import { LOCAL_SIGNOUT_SCOPE, resolveLogin, safeNextPath } from "@barberclub/core";
import { redirect } from "next/navigation";

export async function loginAction(formData: FormData): Promise<void> {
  const next = safeNextPath(formData.get("next"));
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    redirect("/login?erro=1");
  }
  const resolution = resolveLogin([], []);
  if (resolution.kind === "none") {
    redirect(`/login?erro=1&next=${encodeURIComponent(next ?? "")}`);
  }
  redirect("/login");
}

export async function signOutLocal(): Promise<void> {
  if (LOCAL_SIGNOUT_SCOPE !== "local") {
    throw new Error("logout global fora da M4");
  }
  redirect("/login");
}
