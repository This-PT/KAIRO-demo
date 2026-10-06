import { describe, expect, it } from "vitest";
import { apiEnv, loaderEnv, parseFlags } from "./demo-start";

describe("parseFlags", () => {
  it("defaults to a full (not read-only) demo using the configured model", () => {
    expect(parseFlags([])).toEqual({ readonly: false, mock: false });
  });
  it("understands --readonly and --mock", () => {
    expect(parseFlags(["--readonly"])).toEqual({ readonly: true, mock: false });
    expect(parseFlags(["--mock", "--readonly"])).toEqual({ readonly: true, mock: true });
  });
  it("rejects unknown flags instead of ignoring a typo like --readonyl", () => {
    expect(() => parseFlags(["--readonyl"])).toThrow(/--readonyl/);
    expect(() => parseFlags(["--readonyl"])).toThrow(/--readonly/);
  });
});

describe("apiEnv", () => {
  it("serves the showcase data in demo mode", () => {
    expect(apiEnv({ readonly: false, mock: false })).toMatchObject({ DEMO_MODE: "true", DEMO_DATASET: "showcase" });
  });
  it("turns read-only on only when asked", () => {
    expect(apiEnv({ readonly: false, mock: false }).DEMO_READONLY).toBeUndefined();
    expect(apiEnv({ readonly: true, mock: false }).DEMO_READONLY).toBe("true");
  });
});

describe("loaderEnv", () => {
  it("uses the offline summarizer (no cost) only with --mock", () => {
    expect(loaderEnv({ readonly: false, mock: true })).toEqual({ LLM_PROVIDER: "mock" });
    expect(loaderEnv({ readonly: false, mock: false })).toEqual({});
  });
});
