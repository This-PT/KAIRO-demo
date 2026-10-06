/** Browser-side call to the API through the server-side proxy (which holds the admin token). */
export async function callApi<T = unknown>(method: "GET" | "POST" | "PUT" | "PATCH", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/proxy/${path}`, {
    method,
    // Only declare JSON when a body is sent: the API rejects an empty body that claims to be JSON.
    headers: body === undefined ? { "x-requested-with": "kairo" } : { "content-type": "application/json", "x-requested-with": "kairo" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}
