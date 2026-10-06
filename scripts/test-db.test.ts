import { describe, expect, it } from "vitest";
import { assertTestDatabase, testDatabaseUrl } from "./test-db";

describe("testDatabaseUrl", () => {
  it("appends _test to the database name and keeps credentials, host, port and query", () => {
    expect(testDatabaseUrl("postgresql://u:p@127.0.0.1:5432/handover?schema=public")).toBe("postgresql://u:p@127.0.0.1:5432/handover_test?schema=public");
  });
  it("is idempotent", () => {
    const once = testDatabaseUrl("postgresql://u:p@localhost:5432/handover");
    expect(testDatabaseUrl(once)).toBe(once);
  });
  it("rejects URLs without a database name or that are not URLs", () => {
    expect(() => testDatabaseUrl("postgresql://u:p@localhost:5432/")).toThrow(/database name/i);
    expect(() => testDatabaseUrl("not a url")).toThrow();
  });
});

describe("assertTestDatabase", () => {
  it("accepts a database whose name ends in _test", () => expect(() => assertTestDatabase("postgresql://u:p@h:5432/handover_test")).not.toThrow());
  it("refuses the normal development database", () => {
    expect(() => assertTestDatabase("postgresql://u:p@h:5432/handover")).toThrow(/refusing/i);
  });
  it("refuses when DATABASE_URL is missing and says how to run the tests", () => {
    expect(() => assertTestDatabase(undefined)).toThrow(/pnpm test/);
  });
  it("never puts the password in the error message", () => {
    try {
      assertTestDatabase("postgresql://user:SuperSecretPw@h:5432/handover");
    } catch (e) {
      expect(String(e)).not.toContain("SuperSecretPw");
    }
  });
});
