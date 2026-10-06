import { InvalidJsonError, ProviderRefusalError, parseJsonOutput, type LlmProvider, type LlmRequest } from "../provider";

export interface OpenAiOptions {
  apiKey: string;
  model: string;
  /** Override for OpenAI-compatible servers (Gemini, Groq, Ollama, ...) */
  baseUrl?: string;
  fetch?: typeof fetch;
}

interface ChatResponse {
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
}

export class OpenAiProvider implements LlmProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(o: OpenAiOptions) {
    if (!o.apiKey) throw new Error("OPENAI_API_KEY is required for the openai provider");
    if (!o.model) throw new Error("OPENAI_MODEL is required for the openai provider");
    this.apiKey = o.apiKey;
    this.model = o.model;
    this.baseUrl = (o.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.fetchFn = o.fetch ?? fetch;
  }

  async generate(req: LlmRequest): Promise<{ json: unknown }> {
    const res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        response_format: { type: "json_schema", json_schema: { name: "ticket_summary", strict: true, schema: req.schema } },
      }),
    });
    // Status only: provider error bodies can echo fragments of the API key.
    if (!res.ok) throw new Error(`OpenAI request failed: ${res.status}`);

    const data = (await res.json()) as ChatResponse;
    const choice = data.choices?.[0];
    if (choice?.message?.refusal) throw new ProviderRefusalError("model refused the request");
    if (choice?.finish_reason === "length") throw new InvalidJsonError("output was truncated");
    const content = choice?.message?.content;
    if (!content) throw new InvalidJsonError("empty model output");
    return { json: parseJsonOutput(content) };
  }
}
