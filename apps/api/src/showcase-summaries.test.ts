import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateSummary, verifyEvidence } from "@handover/ai";
import { FixtureConnector } from "@handover/connectors";
import { renderTicketText } from "@handover/core";
import { applyPolicy } from "@handover/policy";
import type { SummaryExport } from "./seed";

const file = fileURLToPath(new URL("../../../fixtures/showcase-summaries.json", import.meta.url));
const data = JSON.parse(readFileSync(file, "utf8")) as SummaryExport;
const rules = [
  { label: null, visibility: "readable" as const },
  { label: "hr-confidential", visibility: "restricted" as const },
];

describe("fixtures/showcase-summaries.json (what the deployed demo shows)", async () => {
  const { tickets } = await FixtureConnector.showcase().fetchIssues("SHOP");
  const policies = tickets.map((t) => ({ t, p: applyPolicy(t, rules) }));
  const readable = policies.flatMap(({ t, p }) => (p.visibility === "readable" ? [{ t, text: renderTicketText(p.ticket) }] : []));

  it("has a verified summary for every readable ticket, and none for restricted ones", () => {
    expect(data.version).toBe(1);
    expect(data.project).toBe("SHOP");
    expect(data.summaries.map((s) => s.key).sort()).toEqual(readable.map((r) => r.t.key).sort());
    expect(data.summaries.map((s) => s.key)).not.toEqual(expect.arrayContaining(["SHOP-21"]));
  });

  it.each(readable.map((r) => [r.t.key, r] as const))("%s: schema-valid and every quote is in the ticket text", (key, r) => {
    const entry = data.summaries.find((s) => s.key === key)!;
    const v = validateSummary(entry.json, key);
    expect(v.ok, JSON.stringify(v)).toBe(true);
    if (v.ok) expect(verifyEvidence(v.summary, r.text).ok).toBe(true);
  });

  it("was written by a real model, not the offline placeholder", () => {
    expect(new Set(data.summaries.map((s) => s.model))).not.toContain("heuristic-v1");
  });

  it("contains no secrets, no restricted content and no personal addresses", () => {
    const text = JSON.stringify(data);
    expect(text).not.toMatch(/sk_live_|Winter2025Temp|tom\.becker@|95 per hour|injectable|hr-confidential/);
  });
});
