import { describe, expect, it } from "vitest";
import { redact } from "./redact";

const types = (r: ReturnType<typeof redact>) => Object.fromEntries(r.events.map((e) => [e.type, e.count]));

describe("redact", () => {
  it("leaves clean text untouched", () => {
    const r = redact("Fixed the N+1 query in OrderRepository.");
    expect(r.text).toBe("Fixed the N+1 query in OrderRepository.");
    expect(r.events).toEqual([]);
  });

  it("redacts emails", () => {
    const r = redact("Contact lee.chen@example.com or bob+x@corp.co.uk");
    expect(r.text).not.toContain("@example.com");
    expect(r.text).not.toContain("corp.co.uk");
    expect(r.text).toContain("[REDACTED:email]");
    expect(types(r)).toEqual({ email: 2 });
  });

  it.each([
    ["stripe", "key sk_live_FAKEDEMO0001 here", "sk_live_FAKEDEMO0001"],
    ["openai", "OPENAI sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"],
    ["aws", "id AKIAIOSFODNN7EXAMPLE end", "AKIAIOSFODNN7EXAMPLE"],
    ["github", "ghp_abcdefghijklmnopqrstuvwxyz0123", "ghp_abcdefghijklmnopqrstuvwxyz0123"],
    ["slack", "xoxb-1234567890-abcdefghijkl", "xoxb-1234567890-abcdefghijkl"],
  ])("redacts %s api keys", (_n, input, secret) => {
    const r = redact(input);
    expect(r.text).not.toContain(secret);
    expect(r.text).toContain("[REDACTED:api_key]");
    expect(types(r).api_key).toBe(1);
  });

  it("redacts passwords but keeps the key name", () => {
    const r = redact("password=Sup3rS3cret! and pwd: hunter2 and \"passwd\": \"abc123\"");
    expect(r.text).not.toContain("Sup3rS3cret");
    expect(r.text).not.toContain("hunter2");
    expect(r.text).not.toContain("abc123");
    expect(r.text).toContain("password=[REDACTED:password]");
    expect(types(r).password).toBe(3);
  });

  it("redacts bearer tokens, token= values and JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const r = redact(`Authorization: Bearer abc.def-123_xyz token=zzz999 jwt ${jwt}`);
    expect(r.text).not.toContain("abc.def-123_xyz");
    expect(r.text).not.toContain("zzz999");
    expect(r.text).not.toContain(jwt);
    expect(types(r).token).toBe(3);
  });

  it("redacts private key blocks", () => {
    const begin = ["-----BEGIN RSA", "PRIVATE KEY-----"].join(" "); // built at runtime so this file holds no key-shaped text
    const end = ["-----END RSA", "PRIVATE KEY-----"].join(" ");
    const r = redact(`${begin}
MIIabc
${end}`);
    expect(r.text).not.toContain("MIIabc");
    expect(types(r).api_key).toBe(1);
  });

  it("is idempotent", () => {
    const once = redact("password=abc and a@b.com");
    const twice = redact(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.events).toEqual([]);
  });

  it("never records secret values in events", () => {
    const r = redact("password=Sup3rS3cret!");
    expect(JSON.stringify(r.events)).not.toContain("Sup3rS3cret");
  });
});
