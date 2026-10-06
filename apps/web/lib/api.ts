import "server-only";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Server-side API read. Runs only on the Next.js server, so the admin token never reaches the browser. */
export async function apiGet<T>(path: string, visitorId?: string): Promise<T> {
  const token = process.env.ADMIN_TOKEN;
  if (!token) throw new ApiError(500, "ADMIN_TOKEN is not set for the web app");
  const base = process.env.API_URL ?? "http://127.0.0.1:4000";
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}`, ...(visitorId ? { "x-visitor-id": visitorId } : {}) }, cache: "no-store" });
  } catch {
    throw new ApiError(502, "Cannot reach the API. Is it running?");
  }
  if (!res.ok) throw new ApiError(res.status, `API returned ${res.status}`);
  return (await res.json()) as T;
}

export interface Project {
  key: string;
  name: string;
  enabled: boolean;
  ticketCount: number;
}
export interface TicketListItem {
  key: string;
  project: string;
  title: string;
  status: string;
  visibility: "readable" | "restricted";
  url: string;
  updated: string;
  summary: { status: string; confidence: string } | null;
}
export interface TicketDetail {
  key: string;
  project: string;
  title: string;
  status: string;
  visibility: "readable" | "restricted";
  url: string;
  updated: string;
  sourceText: string | null;
  summary: { status: string; confidence: string; model: string; promptVersion: string; attempts: number; evidenceVerified: boolean; createdAt: string; json: unknown } | null;
}
export interface AuditItem {
  id: string;
  kind: "summary" | "chat";
  /** Set for summaries; null for chat questions, which list ticketKeys instead */
  ticketKey: string | null;
  ticketKeys: string[];
  sentAt: string;
  provider: string;
  model: string;
  payloadHash: string;
  payloadSnapshot: string;
  bytes: number;
  outcome: string;
}

export interface GraphNode {
  key: string;
  project: string;
  title: string;
  issueType: string;
  status: string;
  visibility: "readable" | "restricted";
  parent: string | null;
  assignee: string | null;
  labels: string[];
  url: string;
  summary: { status: string; confidence: string } | null;
}
export interface GraphEdge {
  from: string;
  to: string;
  type: string;
}
export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  facets: { projects: string[]; labels: string[]; people: string[] };
  truncated: boolean;
}
