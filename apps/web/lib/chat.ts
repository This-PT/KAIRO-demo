const MARKER = /\[([A-Z][A-Z0-9]+-\d+)\]/g;

export type AnswerPart = { type: "text" | "key"; value: string };

/**
 * Splits an answer into text and ticket-key parts. Only [KEY] markers for tickets that were actually
 * provided to the model become links, so a made-up key can never point anywhere.
 */
export function splitAnswer(text: string, knownKeys: Set<string>): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let buf = "";
  let last = 0;
  for (const m of text.matchAll(MARKER)) {
    buf += text.slice(last, m.index);
    last = m.index + m[0].length;
    if (knownKeys.has(m[1]!)) {
      if (buf) parts.push({ type: "text", value: buf });
      buf = "";
      parts.push({ type: "key", value: m[1]! });
    } else {
      buf += m[0];
    }
  }
  buf += text.slice(last);
  if (buf) parts.push({ type: "text", value: buf });
  return parts;
}

export interface ChatCitation {
  ticket: string;
  title: string;
  url: string;
  quote: string;
}
export interface ChatSource {
  key: string;
  title: string;
  url: string;
}
export type ChatMsg =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string; status: string; citations: ChatCitation[]; sources: ChatSource[]; confidence: string | null; scope?: "search" | "overview" };

const SHOWCASE_SUGGESTIONS = [
  "Why did we choose Elasticsearch instead of Algolia?",
  "How did we stop customers being charged twice?",
  "What should I know before changing the login flow?",
  "What went wrong during Black Friday and how was it fixed?",
  "Which gotchas should I know about feature flags?",
];

/** Questions that fit whichever demo project is loaded. */
export function suggestionsFor(projectKeys: string[]): string[] {
  return projectKeys.includes("SHOP") ? SHOWCASE_SUGGESTIONS : SUGGESTIONS;
}

export const SUGGESTIONS = [
  "What problems have we had with checkout, and how were they fixed?",
  "Why did we reject the Redis cache?",
  "What should I watch out for with authentication and sessions?",
  "Who worked on the mobile login issues?",
];
