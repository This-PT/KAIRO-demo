import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NormalizedTicket, renderTicketText } from "@handover/core";
import { InvalidJsonError, type LlmProvider, type LlmRequest } from "./provider";
import { summarizeTicket, type AuditSink } from "./summarize";
import { hnd1Summary } from "./testdata";

const text = renderTicketText(NormalizedTicket.parse(JSON.parse(readFileSync(join(__dirname, "../../../fixtures/jira/HND-1.json"), "utf8"))));

function scripted(responses: (unknown | Error)[]) {
  const calls: LlmRequest[] = [];
  const provider: LlmProvider = {
    name: "test",
    model: "test-model",
    async generate(req) {
      calls.push(req);
      const r = responses[Math.min(calls.length - 1, responses.length - 1)];
      if (r instanceof Error) throw r;
      return { json: r };
    },
  };
  return { provider, calls };
}

const withBadQuote = (field: "root_cause" | "problem") => {
  const s = hnd1Summary();
  s.evidence = s.evidence.map((e) => (e.field === field ? { ...e, quote: "this sentence was invented by the model" } : e));
  return s;
};

describe("summarizeTicket", () => {
  it("returns ok on the first attempt when everything verifies", async () => {
    const { provider, calls } = scripted([hnd1Summary()]);
    const r = await summarizeTicket({ provider, ticketKey: "HND-1", ticketText: text });
    expect(r).toMatchObject({ status: "ok", attempts: 1 });
    expect(r.summary).toEqual(hnd1Summary());
    expect(calls).toHaveLength(1);
  });

  it("retries once with feedback after a bad quote, then succeeds", async () => {
    const { provider, calls } = scripted([withBadQuote("root_cause"), hnd1Summary()]);
    const r = await summarizeTicket({ provider, ticketKey: "HND-1", ticketText: text });
    expect(r).toMatchObject({ status: "ok", attempts: 2 });
    expect(calls[1]!.user).toMatch(/previous answer/i);
    expect(calls[1]!.user).toContain("root_cause");
  });

  it("rejects after two failed attempts and never retries a third time", async () => {
    const { provider, calls } = scripted([withBadQuote("root_cause")]);
    const r = await summarizeTicket({ provider, ticketKey: "HND-1", ticketText: text });
    expect(r).toMatchObject({ status: "rejected", summary: null, attempts: 2 });
    expect(r.reasons.join()).toMatch(/root_cause/);
    expect(calls).toHaveLength(2);
  });

  it("retries on schema-invalid output and passes the errors as feedback", async () => {
    const { provider, calls } = scripted([{ ...hnd1Summary(), confidence: "certain" }, hnd1Summary()]);
    const r = await summarizeTicket({ provider, ticketKey: "HND-1", ticketText: text });
    expect(r.status).toBe("ok");
    expect(calls[1]!.user).toContain("confidence");
  });

  it("retries on invalid JSON", async () => {
    const { provider } = scripted([new InvalidJsonError("not json"), hnd1Summary()]);
    expect((await summarizeTicket({ provider, ticketKey: "HND-1", ticketText: text })).status).toBe("ok");
  });

  it("keeps a downgraded first attempt if the retry is worse", async () => {
    const downgraded = hnd1Summary();
    downgraded.people.push("Ghost Writer");
    const { provider } = scripted([downgraded, withBadQuote("problem")]);
    const r = await summarizeTicket({ provider, ticketKey: "HND-1", ticketText: text });
    expect(r.status).toBe("downgraded");
    expect(r.summary!.confidence).toBe("medium");
    expect(r.summary!.people).not.toContain("Ghost Writer");
  });

  it("rejects a summary written for a different ticket", async () => {
    const { provider } = scripted([{ ...hnd1Summary(), ticket: "HND-2" }]);
    expect((await summarizeTicket({ provider, ticketKey: "HND-1", ticketText: text })).status).toBe("rejected");
  });

  it("propagates provider errors (network/auth) instead of swallowing them", async () => {
    const { provider } = scripted([new Error("boom")]);
    await expect(summarizeTicket({ provider, ticketKey: "HND-1", ticketText: text })).rejects.toThrow("boom");
  });

  it("sends the schema, ticket key and text with every request", async () => {
    const { provider, calls } = scripted([hnd1Summary()]);
    await summarizeTicket({ provider, ticketKey: "HND-1", ticketText: text });
    expect(calls[0]).toMatchObject({ ticketKey: "HND-1", ticketText: text });
    expect((calls[0]!.schema as { type: string }).type).toBe("object");
  });

  describe("audit", () => {
    const sink = () => {
      const events: string[] = [];
      const payloads: string[] = [];
      const audit: AuditSink = {
        async record(e) {
          events.push("record");
          payloads.push(e.payload);
          return `id${events.length}`;
        },
        async finish(id, outcome) {
          events.push(`finish:${id}:${outcome}`);
        },
      };
      return { audit, events, payloads };
    };

    it("records before each provider call and finishes after, with the exact payload sent", async () => {
      const { audit, events, payloads } = sink();
      const order: string[] = [];
      const provider: LlmProvider = {
        name: "t",
        model: "m",
        async generate(req) {
          order.push("generate:" + events.join(","));
          expect(payloads[payloads.length - 1]).toContain(req.user);
          expect(payloads[payloads.length - 1]).toContain(req.system);
          return { json: hnd1Summary() };
        },
      };
      await summarizeTicket({ provider, ticketKey: "HND-1", ticketText: text, audit });
      expect(order).toEqual(["generate:record"]);
      expect(events).toEqual(["record", "finish:id1:ok"]);
    });

    it("writes one audit entry per attempt, including failed ones", async () => {
      const { audit, events } = sink();
      const { provider } = scripted([withBadQuote("root_cause"), hnd1Summary()]);
      await summarizeTicket({ provider, ticketKey: "HND-1", ticketText: text, audit });
      expect(events).toEqual(["record", "finish:id1:rejected", "record", "finish:id3:ok"]);
    });

    it("marks the audit entry as error when the provider throws", async () => {
      const { audit, events } = sink();
      const { provider } = scripted([new Error("down")]);
      await summarizeTicket({ provider, ticketKey: "HND-1", ticketText: text, audit }).catch(() => {});
      expect(events).toEqual(["record", "finish:id1:error"]);
    });
  });
});
