import type { LlmProvider } from "../provider";
import { AnthropicProvider } from "./anthropic";
import { HeuristicProvider } from "./heuristic";
import { OpenAiProvider } from "./openai";

export * from "./anthropic";
export * from "./heuristic";
export * from "./openai";

type Env = Record<string, string | undefined>;

/** LLM_PROVIDER = openai | anthropic | mock (alias: heuristic). Defaults to the offline provider. */
export function createProvider(env: Env = process.env): LlmProvider {
  const kind = (env.LLM_PROVIDER ?? "mock").toLowerCase();
  switch (kind) {
    case "mock":
    case "heuristic":
      return new HeuristicProvider();
    case "openai":
      return new OpenAiProvider({ apiKey: env.OPENAI_API_KEY ?? "", model: env.OPENAI_MODEL ?? "", baseUrl: env.OPENAI_BASE_URL || undefined });
    case "anthropic":
      if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required for the anthropic provider");
      return new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL ?? "" });
    default:
      throw new Error(`Unknown LLM_PROVIDER "${kind}" (expected openai, anthropic or mock)`);
  }
}
