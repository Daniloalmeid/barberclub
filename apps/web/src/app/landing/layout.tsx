import { headers } from "next/headers";
import { notFound } from "next/navigation";

export default async function LandingLayout({ children }: { children: React.ReactNode }) {
  const header = (await headers()).get("x-bc-route");
  if (header !== "landing") notFound();
  return children;
}
