export interface LlmRequest {
  system: string;
  user: string;
  /** JSON Schema the response must follow */
  schema: Record<string, unknown>;
  /** Passed through for offline providers; network providers ignore them. */
  ticketKey: string;
  ticketText: string;
  /** Set for chat requests: the question and the exact source text sent. Offline providers use it; network providers ignore it. */
  chat?: { question: string; sources: { key: string; text: string }[] };
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  /** Resolves with parsed (not yet validated) JSON. Throws InvalidJsonError for unparseable output. */
  generate(req: LlmRequest): Promise<{ json: unknown }>;
}

export class InvalidJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidJsonError";
  }
}

export class ProviderRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderRefusalError";
  }
}

/** Parses model output as JSON, tolerating a surrounding ```json fence from OpenAI-compatible servers. */
export function parseJsonOutput(text: string): unknown {
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(body);
  } catch {
    throw new InvalidJsonError("model output was not valid JSON");
  }
}
