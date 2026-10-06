import { safeNext } from "@/lib/access";

export const dynamic = "force-dynamic";

type Params = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function LoginPage({ searchParams }: { searchParams: Params }) {
  const sp = await searchParams;
  const next = safeNext(one(sp.next));
  const failed = one(sp.error) === "1";
  const configured = (process.env.APP_PASSWORD ?? "").length > 0;

  return (
    <div className="mx-auto max-w-sm space-y-4 pt-8">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      {!configured ? (
        <p className="rounded border border-amber-300 p-3 text-sm text-amber-800 dark:border-amber-800 dark:text-amber-300">
          No password is configured. Set <code>APP_PASSWORD</code> in the server&apos;s environment to protect this app. In local development it is open without one.
        </p>
      ) : (
        <form method="post" action="/api/login" className="space-y-3">
          <input type="hidden" name="next" value={next} />
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-500">Password</span>
            <input name="password" type="password" autoComplete="current-password" autoFocus required maxLength={200} className="w-full rounded border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700" />
          </label>
          {failed && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              That password was not correct.
            </p>
          )}
          <button type="submit" className="w-full rounded bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
            Sign in
          </button>
        </form>
      )}
    </div>
  );
}
