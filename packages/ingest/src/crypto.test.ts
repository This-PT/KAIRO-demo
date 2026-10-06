import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./crypto";

const key = randomBytes(32).toString("base64");

describe("crypto", () => {
  it("round-trips", () => expect(decrypt(encrypt("secret text", key), key)).toBe("secret text"));
  it("does not contain the plaintext and uses a fresh IV each time", () => {
    const a = encrypt("secret text", key);
    const b = encrypt("secret text", key);
    expect(a.toString("utf8")).not.toContain("secret");
    expect(a.equals(b)).toBe(false);
  });
  it("fails with the wrong key", () => expect(() => decrypt(encrypt("x", key), randomBytes(32).toString("base64"))).toThrow());
  it("fails if ciphertext is tampered with", () => {
    const c = encrypt("hello", key);
    c[c.length - 1] = c[c.length - 1]! ^ 1;
    expect(() => decrypt(c, key)).toThrow();
  });
  it("rejects keys that are not 32 bytes", () => expect(() => encrypt("x", Buffer.from("short").toString("base64"))).toThrow(/32 bytes/));
});
