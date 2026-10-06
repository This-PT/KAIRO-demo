import { createHash } from "node:crypto";
import type { PrismaClient } from "@kairo/db";
import { redact } from "@kairo/policy";
import { buildChatPrompt, type ChatTurn } from "./chat-prompt";
import { chatJsonSchema, validateChatAnswer, verifyCitations, type Citation } from "./chat-verify";
import { InvalidJsonError, type LlmProvider } from "./provider";
import { isOverviewQuestion, overviewTickets, searchTickets, type SearchHit } from "./search";

export interface ChatAudit {
  /** Called BEFORE the payload is sent to the provider. */
  record(e: { provider: string; model: string; payload: string; attempt: number; ticketKeys: string[] }): Promise<string>;
  finish(id: string, outcome: string): Promise<void>;
}

export interface ChatResult {
  status: "answered" | "not_found" | "no_sources" | "rejected";
  answer: string;
  citations: (Citation & { title: string; url: string })[];
  confidence: "high" | "medium" | "low" | null;
  /** Tickets that were provided to the model, whether or not they were cited */
  sources: { key: string; title: string; url: string }[];
  attempts: number;
  /** "overview" = a broad question answered from a sample of the project, not from search results */
  scope: "search" | "overview";
}

const NO_SOURCES = 'I couldn\'t find anything about that in the ticket history. Try naming a topic, a person or a ticket key (for example "payments" or "who worked on login"), or check that the relevant project has been ingested and summarized.';
const REJECTED = "I couldn't produce an answer I could back with quotes from the tickets, so I'm not showing one. These tickets look related; please read them directly.";
const MAX_ATTEMPTS = 2;
const HISTORY_TURNS = 6;
const RANK = { answered: 2, not_found: 2, downgraded: 1, rejected: 0 } as const;
const LOWER = { high: "medium", medium: "low", low: "low" } as const;

type Attempt = { kind: keyof typeof RANK; answer: string; citations: Citation[]; confidence: ChatResult["confidence"]; feedback: string[] };

/** Answers a question from already-retrieved sources. Every cited quote is verified against the text that was sent. */
export async function answerFromSources(i: {
  provider: LlmProvider;
  question: string;
  history: ChatTurn[];
  hits: SearchHit[];
  audit?: ChatAudit;
  scope?: "search" | "overview";
}): Promise<ChatResult> {
  const scope = i.scope ?? "search";
  const sources = i.hits.map((h) => ({ key: h.key, title: h.title, url: h.url }));
  if (i.hits.length === 0) return { status: "no_sources", answer: NO_SOURCES, citations: [], confidence: null, sources, attempts: 0, scope };

  // Anything typed into the question or earlier turns is redacted before it can reach the model, the audit log or storage.
  const question = redact(i.question).text;
  const history = i.history.slice(-HISTORY_TURNS).map((t) => ({ role: t.role, content: redact(t.content).text }));
  const keys = new Set(i.hits.map((h) => h.key));
  const meta = new Map(i.hits.map((h) => [h.key, h]));

  let best: Attempt | null = null;
  let feedback: string[] = [];
  let attempts = 0;

  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    attempts = n;
    const prompt = buildChatPrompt({ question, hits: i.hits, history, feedback, scope });
    const auditId = await i.audit?.record({ provider: i.provider.name, model: i.provider.model, payload: `${prompt.system}\n\n${prompt.user}`, attempt: n, ticketKeys: [...keys] });

    let attempt: Attempt;
    try {
      const { json } = await i.provider.generate({
        system: prompt.system,
        user: prompt.user,
        schema: chatJsonSchema,
        ticketKey: "",
        ticketText: "",
        chat: { question, sources: i.hits.map((h) => ({ key: h.key, text: prompt.sentText.get(h.key)! })) },
      });
      const v = validateChatAnswer(json, keys);
      if (!v.ok) {
        attempt = { kind: "rejected", answer: "", citations: [], confidence: null, feedback: v.errors };
      } else if (v.answer.not_found) {
        attempt = { kind: "not_found", answer: v.answer.answer, citations: [], confidence: v.answer.confidence, feedback: [] };
      } else {
        const { good, bad } = verifyCitations(v.answer.citations, prompt.sentText);
        const problems = bad.map((b) => `citation to ${b.citation.ticket} (${b.reason}): "${b.citation.quote}"`);
        if (bad.length === 0) attempt = { kind: "answered", answer: v.answer.answer, citations: good, confidence: v.answer.confidence, feedback: [] };
        else if (good.length === 0) attempt = { kind: "rejected", answer: "", citations: [], confidence: null, feedback: problems };
        else attempt = { kind: "downgraded", answer: v.answer.answer, citations: good, confidence: LOWER[v.answer.confidence], feedback: problems };
      }
    } catch (e) {
      if (e instanceof InvalidJsonError) {
        attempt = { kind: "rejected", answer: "", citations: [], confidence: null, feedback: ["the output was not valid JSON"] };
      } else {
        if (auditId) await i.audit?.finish(auditId, "error");
        throw e;
      }
    }
    if (auditId) await i.audit?.finish(auditId, attempt.kind);

    if (!best || RANK[attempt.kind] > RANK[best.kind]) best = attempt;
    if (attempt.kind === "answered" || attempt.kind === "not_found") break;
    feedback = attempt.feedback;
  }

  const b = best!;
  if (b.kind === "rejected") return { status: "rejected", answer: REJECTED, citations: [], confidence: null, sources, attempts, scope };
  return {
    status: b.kind === "not_found" ? "not_found" : "answered",
    answer: b.answer,
    citations: b.citations.map((c) => ({ ...c, title: meta.get(c.ticket)!.title, url: meta.get(c.ticket)!.url })),
    confidence: b.confidence,
    sources,
    attempts,
    scope,
  };
}

/** Full chat turn: retrieve readable tickets, answer with verified citations, audit what was sent. */
export async function answerQuestion(i: { db: PrismaClient; provider: LlmProvider; question: string; history: ChatTurn[] }): Promise<ChatResult> {
  const question = redact(i.question).text;
  // A short follow-up ("and why?") borrows the previous user question to find its sources.
  const lastUser = [...i.history].reverse().find((t) => t.role === "user")?.content ?? "";
  const combined = `${redact(lastUser).text} ${question}`;
  // Broad questions ("what did we do?") name no topic, so searching for words finds nothing; use an overview sample instead.
  const scope = isOverviewQuestion(combined) ? ("overview" as const) : ("search" as const);
  const hits = scope === "overview" ? await overviewTickets(i.db, { limit: 10 }) : await searchTickets(i.db, combined);

  const audit: ChatAudit = {
    async record(e) {
      const row = await i.db.auditLog.create({
        data: {
          kind: "chat",
          ticketId: null,
          ticketKeys: e.ticketKeys,
          provider: e.provider,
          model: e.model,
          payloadHash: createHash("sha256").update(e.payload).digest("hex"),
          payloadSnapshot: e.payload,
          bytes: Buffer.byteLength(e.payload),
          outcome: "pending",
        },
      });
      return row.id;
    },
    async finish(id, outcome) {
      await i.db.auditLog.update({ where: { id }, data: { outcome } });
    },
  };
  return answerFromSources({ provider: i.provider, question, history: i.history, hits, audit, scope });
}
