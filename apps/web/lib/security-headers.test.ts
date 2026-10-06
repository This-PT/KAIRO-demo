import { describe, expect, it } from "vitest";
import config from "../next.config";

describe("security headers", async () => {
  const rules = await config.headers!();
  const all = Object.fromEntries((rules.find((r) => r.source === "/(.*)")?.headers ?? []).map((h) => [h.key, h.value]));

  it("never uses Referrer-Policy: no-referrer, which makes browsers send Origin: null on form posts and breaks sign-in", () => {
    expect(all["Referrer-Policy"]).toBeDefined();
    expect(all["Referrer-Policy"]).not.toBe("no-referrer");
  });
  it("still keeps the page's address from leaking to other sites", () => {
    expect(["same-origin", "strict-origin", "strict-origin-when-cross-origin"]).toContain(all["Referrer-Policy"]);
  });
  it("keeps the other protections", () => {
    expect(all["X-Frame-Options"]).toBe("DENY");
    expect(all["X-Content-Type-Options"]).toBe("nosniff");
  });
});
