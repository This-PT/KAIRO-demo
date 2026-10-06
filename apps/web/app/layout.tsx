import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { apiGet } from "@/lib/api";
import { SESSION_COOKIE, isSignedIn } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = { title: "Handover", description: "Keep team knowledge when developers leave." };

const NAV = [
  { href: "/history", label: "Task History" },
  { href: "/tree", label: "Work Tree" },
  { href: "/ask", label: "Ask AI" },
  { href: "/settings", label: "Connect & Policy" },
  { href: "/audit", label: "AI Audit Log" },
];

/** The banner must never break a page, so any failure just means "not read-only". */
async function isReadOnly(): Promise<boolean> {
  try {
    return (await apiGet<{ readOnly?: boolean }>("/api/connection")).readOnly === true;
  } catch {
    return false;
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Visitors who are not signed in see no menu and no data (the middleware already blocks the pages themselves).
  const signedIn = await isSignedIn((await cookies()).get(SESSION_COOKIE)?.value, { APP_PASSWORD: process.env.APP_PASSWORD, ADMIN_TOKEN: process.env.ADMIN_TOKEN });
  const readOnly = signedIn && (await isReadOnly());
  const gated = (process.env.APP_PASSWORD ?? "").length > 0;
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        {readOnly && <div className="bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">Read-only demo with fake data. You can browse and ask questions; changes are disabled.</div>}
        <header className="border-b border-zinc-200 dark:border-zinc-800">
          <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
            <span className="font-semibold">Handover</span>
            {signedIn &&
              NAV.map((n) => (
                <a key={n.href} href={n.href} className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
                  {n.label}
                </a>
              ))}
            {signedIn && gated && (
              <form method="post" action="/api/logout" className="ml-auto">
                <button type="submit" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                  Log out
                </button>
              </form>
            )}
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
