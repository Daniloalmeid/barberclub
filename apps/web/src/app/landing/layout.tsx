import { notFound } from "next/navigation";
import { requestHost } from "@/server/request-host";

export default async function LandingLayout({ children }: { children: React.ReactNode }) {
  const { host } = await requestHost();
  if (host.kind !== "base") notFound();
  return children;
}
