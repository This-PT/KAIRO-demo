import { SummarySchema, type Summary } from "@kairo/core";
import type { PrismaClient } from "@kairo/db";
import { redact } from "@kairo/policy";

const KEY_RE = /\b[A-Za-z][A-Za-z0-9]+-\d+\b/g;
const MAX_TERMS = 12;
const STOP = new Set(
  "a an the and or of to in on for with is are was were be been it its this that these those what why how when where who which do does did we you i me my our your us about from at by as can could should would there their they them then than so if not no please any some has have had will just also".split(" "),
);

// Words that make a question broad rather than about a topic ("what did the team do so far?").
const GENERIC = new Set(
  ("summarize summarise summary overview everything project team work worked working done doing history happened happen happening recent latest far up catch tell show give list all whole general " +
    "conclude concluding conclusion recap wrap sum highlights highlight accomplished accomplish achieved achieve shipped delivered completed finished " +
    "current currently status progress update updates going state explain describe now today lately thanks thank built made").split(" "),
);

const tokensOf = (question: string) => [...new Set((question.replace(KEY_RE, " ").toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).filter((t) => !STOP.has(t)))];

/** True when the question names no topic, person or ticket: searching for words cannot help, so an overview is the better answer. */
export function isOverviewQuestion(question: string): boolean {
  if (extractKeys(question).length > 0 || !/[a-z]/i.test(question)) return false;
  return tokensOf(question).filter((t) => !GENERIC.has(t)).length === 0;
}

export function extractKeys(question: string): string[] {
  return [...new Set((question.match(KEY_RE) ?? []).map((k) => k.toUpperCase()))];
}

/**
 * Turns a natural-language question into a Postgres tsquery of OR-ed prefix terms.
 * Only [a-z0-9] survive, so user input can never add tsquery operators or SQL.
 */
export function buildTsQuery(question: string): string | null {
  const terms = tokensOf(question).slice(0, MAX_TERMS);
  return terms.length ? terms.map((t) => `${t}:*`).join(" | ") : null;
}

/** The text the full-text index searches: key, title, labels and every summary field. */
export function summaryToSearchText(t: { key: string; title: string; labels: string[] }, s: Summary): string {
  return [
    t.key,
    t.title,
    t.labels.join(" "),
    s.problem,
    s.root_cause,
    s.actions.map((a) => a.what).join(". "),
    s.rationale,
    s.rejected_options.map((o) => `${o.option}: ${o.why_rejected}`).join(". "),
    s.gotchas.join(". "),
    s.people.join(", "),
    s.related.join(" "),
  ]
    .filter((x) => x.trim())
    .join("\n");
}

export interface SearchHit {
  key: string;
  title: string;
  url: string;
  summary: Summary;
  confidence: string;
  /** Redacted original ticket text */
  sourceText: string;
}

/**
 * Finds tickets relevant to a question. This is the privacy gate for chat:
 * only readable tickets with a verified (ok) summary can ever be returned.
 */
export async function searchTickets(db: PrismaClient, question: string, opts: { limit?: number } = {}): Promise<SearchHit[]> {
  const limit = opts.limit ?? 6;
  const eligible = { visibility: "readable" as const, summaries: { some: { status: "ok" as const } } };

  const named = extractKeys(question).length
    ? (await db.ticket.findMany({ where: { key: { in: extractKeys(question) }, ...eligible }, select: { key: true } })).map((t) => t.key)
    : [];
  const wanted = extractKeys(question).filter((k) => named.includes(k));

  const tsq = buildTsQuery(question);
  const ranked = tsq
    ? await db.$queryRaw<{ key: string }[]>`
        SELECT t."key" AS key
        FROM "Summary" s
        JOIN "Ticket" t ON t."id" = s."ticketId"
        CROSS JOIN (SELECT to_tsquery('english', ${tsq}) AS q) query
        WHERE s."status" = 'ok' AND t."visibility" = 'readable'
          AND to_tsvector('english', s."searchText") @@ query.q
        ORDER BY ts_rank_cd(to_tsvector('english', s."searchText"), query.q) DESC, t."key"
        LIMIT ${limit}`
    : [];

  const keys = [...new Set([...wanted, ...ranked.map((r) => r.key)])].slice(0, limit);
  if (keys.length === 0) return [];

  const rows = await db.ticket.findMany({
    where: { key: { in: keys }, ...eligible },
    include: { summaries: { where: { status: "ok" }, orderBy: { createdAt: "desc" }, take: 1 }, content: { select: { redactedText: true } } },
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));

  const hits: SearchHit[] = [];
  for (const k of keys) {
    const hit = toHit(byKey.get(k));
    if (hit) hits.push(hit);
  }
  return hits;
}

type Row = {
  key: string;
  title: string;
  url: string;
  issueType: string;
  parentKey: string | null;
  summaries: { json: unknown; confidence: string }[];
  content: { redactedText: string | null } | null;
};

function toHit(r: Row | undefined): SearchHit | null {
  const parsed = r?.summaries[0] ? SummarySchema.safeParse(r.summaries[0].json) : null;
  if (!r || !parsed?.success || !r.content?.redactedText) return null;
  return {
    key: r.key,
    title: r.title,
    url: r.url,
    summary: parsed.data,
    confidence: r.summaries[0]!.confidence,
    // Redaction is idempotent; this only changes text if something slipped through.
    sourceText: redact(r.content.redactedText).text,
  };
}

/**
 * A sample for broad questions: the project's epics first, then the most recently updated tickets.
 * Same privacy gate as the search: readable tickets with a verified summary only.
 */
export async function overviewTickets(db: PrismaClient, opts: { limit?: number } = {}): Promise<SearchHit[]> {
  const rows = await db.ticket.findMany({
    where: { visibility: "readable", summaries: { some: { status: "ok" } } },
    orderBy: [{ sourceUpdatedAt: "desc" }, { key: "asc" }],
    take: 80,
    include: { summaries: { where: { status: "ok" }, orderBy: { createdAt: "desc" }, take: 1 }, content: { select: { redactedText: true } } },
  });
  const limit = opts.limit ?? 10;

  // Every epic, then one child per epic in turn (most recent first) so each theme has real substance,
  // then the most recent remaining tickets.
  const epics = rows.filter((r) => r.issueType === "Epic").slice(0, limit);
  const picked = [...epics];
  const used = new Set(picked.map((r) => r.key));
  const childrenOf = new Map(epics.map((e) => [e.key, rows.filter((r) => r.parentKey === e.key)]));
  for (let depth = 0; picked.length < limit; depth++) {
    let added = false;
    for (const e of epics) {
      const child = childrenOf.get(e.key)![depth];
      if (child && !used.has(child.key) && picked.length < limit) {
        picked.push(child);
        used.add(child.key);
        added = true;
      }
    }
    if (!added) break;
  }
  for (const r of rows) {
    if (picked.length >= limit) break;
    if (!used.has(r.key)) {
      picked.push(r);
      used.add(r.key);
    }
  }
  return picked.map(toHit).filter((h): h is SearchHit => h !== null);
}
