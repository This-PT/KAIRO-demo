import Anthropic from "@anthropic-ai/sdk";
import { InvalidJsonError, ProviderRefusalError, parseJsonOutput, type LlmProvider, type LlmRequest } from "../provider";

/** The slice of the SDK this provider uses, so tests can inject a fake. */
export interface AnthropicLike {
  messages: {
    create(params: Record<string, unknown>): Promise<{
      content: { type: string; text?: string }[];
      stop_reason?: string | null;
      stop_details?: { category?: string | null } | null;
    }>;
  };
}

export interface AnthropicOptions {
  model: string;
  apiKey?: string;
  client?: AnthropicLike;
}

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly client: AnthropicLike;

  constructor(o: AnthropicOptions) {
    if (!o.model) throw new Error("ANTHROPIC_MODEL is required for the anthropic provider");
    this.model = o.model;
    this.client = o.client ?? (new Anthropic({ apiKey: o.apiKey }) as unknown as AnthropicLike);
  }

  async generate(req: LlmRequest): Promise<{ json: unknown }> {
    // Structured output via output_config.format. No forced tool_choice (rejected on newer models),
    // no sampling params, no thinking override.
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
      output_config: { format: { type: "json_schema", schema: req.schema } },
    });

    if (res.stop_reason === "refusal") {
      throw new ProviderRefusalError(`model refused the request (${res.stop_details?.category ?? "unspecified"})`);
    }
    if (res.stop_reason === "max_tokens") throw new InvalidJsonError("output was truncated");
    const text = res.content.find((b) => b.type === "text")?.text;
    if (!text) throw new InvalidJsonError("empty model output");
    return { json: parseJsonOutput(text) };
  }
}
