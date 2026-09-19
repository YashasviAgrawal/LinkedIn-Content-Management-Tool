import { Nav } from "@/components/nav";
import { env } from "@/lib/env";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav timezone={env.timezone} />
      <main className="mx-auto max-w-[1400px] px-4 py-6">{children}</main>
    </>
  );
}
