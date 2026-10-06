export interface JiraClientOptions {
  baseUrl: string;
  email: string;
  apiToken: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const RETRYABLE = new Set([429, 502, 503, 504]);

export class JiraClient {
  readonly baseUrl: string;
  private readonly auth: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;

  constructor(o: JiraClientOptions) {
    this.baseUrl = o.baseUrl.replace(/\/+$/, "");
    this.auth = "Basic " + Buffer.from(`${o.email}:${o.apiToken}`).toString("base64");
    this.fetchFn = o.fetch ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = o.maxRetries ?? 5;
  }

  /** GET with retry on 429/5xx. Honours Retry-After (seconds), otherwise exponential backoff from 1s. */
  async get<T = unknown>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
    const url = this.baseUrl + path + (qs.size ? `?${qs}` : "");

    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchFn(url, { headers: { Authorization: this.auth, Accept: "application/json" } });
      if (res.ok) return (await res.json()) as T;
      if (RETRYABLE.has(res.status) && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await this.sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      throw new Error(`Jira GET ${path} failed: ${res.status}`);
    }
  }
}
