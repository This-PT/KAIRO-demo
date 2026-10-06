import { describe, expect, it } from "vitest";
import { SESSION_TTL_MS, createSessionToken, deriveSecret, verifySessionToken } from "./session";

const SECRET = "a-secret-derived-from-server-values";
const NOW = 1_800_000_000_000;

describe("session tokens", () => {
  it("round-trips while valid", async () => {
    const t = await createSessionToken(SECRET, NOW);
    expect(await verifySessionToken(t, SECRET, NOW + 1000)).toBe(true);
  });

  it("expires after the TTL", async () => {
    const t = await createSessionToken(SECRET, NOW);
    expect(await verifySessionToken(t, SECRET, NOW + SESSION_TTL_MS - 1)).toBe(true);
    expect(await verifySessionToken(t, SECRET, NOW + SESSION_TTL_MS + 1)).toBe(false);
  });

  it("rejects a token signed with another secret", async () => {
    const t = await createSessionToken("other-secret", NOW);
    expect(await verifySessionToken(t, SECRET, NOW)).toBe(false);
  });

  it("rejects tampering with the expiry (cannot extend a session) or the signature", async () => {
    const [exp, mac] = (await createSessionToken(SECRET, NOW)).split(".");
    const longer = `${Number(exp) + 10 * SESSION_TTL_MS}.${mac}`;
    expect(await verifySessionToken(longer, SECRET, NOW)).toBe(false);
    const flipped = `${exp}.${mac!.slice(0, -1)}${mac!.endsWith("0") ? "1" : "0"}`;
    expect(await verifySessionToken(flipped, SECRET, NOW)).toBe(false);
  });

  it.each([undefined, "", "garbage", "123", "abc.def", "1.2.3", ".", "9999999999999."])("rejects malformed token %j", async (t) => {
    expect(await verifySessionToken(t, SECRET, NOW)).toBe(false);
  });

  it("never verifies when the secret is empty", async () => {
    const t = await createSessionToken("", NOW).catch(() => "x.y");
    expect(await verifySessionToken(t, "", NOW)).toBe(false);
  });
});

describe("deriveSecret", () => {
  it("is deterministic and changes when the password or admin token changes", async () => {
    const a = await deriveSecret("token-1234567890", "pw-one");
    expect(await deriveSecret("token-1234567890", "pw-one")).toBe(a);
    expect(await deriveSecret("token-1234567890", "pw-two")).not.toBe(a);
    expect(await deriveSecret("other-token-12345", "pw-one")).not.toBe(a);
  });
  it("does not contain the inputs", async () => {
    const s = await deriveSecret("token-1234567890", "pw-one");
    expect(s).not.toContain("pw-one");
    expect(s).not.toContain("token-1234567890");
  });
  it("changing the password invalidates existing sessions", async () => {
    const t = await createSessionToken(await deriveSecret("tok", "old-password"), NOW);
    expect(await verifySessionToken(t, await deriveSecret("tok", "new-password"), NOW)).toBe(false);
  });
});
