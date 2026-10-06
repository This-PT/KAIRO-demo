import { describe, expect, it } from "vitest";
import { VISITOR_COOKIE, VISITOR_HEADER, isVisitorId, newVisitorId, prepareVisitorHeaders, visitorCookie } from "./visitor";

const A = "a".repeat(32);
const B = "b".repeat(32);

describe("visitor ids", () => {
  it("are 32 lowercase hex characters, random and unique", () => {
    const ids = new Set(Array.from({ length: 50 }, newVisitorId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(isVisitorId(id)).toBe(true);
  });
  it.each(["", "short", "A".repeat(32), "g".repeat(32), "a".repeat(33), "../etc/passwd", undefined, null, 42])("rejects %j", (v) => expect(isVisitorId(v)).toBe(false));
});

describe("prepareVisitorHeaders", () => {
  it("reuses a valid visitor cookie and does not mint a new id", () => {
    const r = prepareVisitorHeaders(new Headers(), A);
    expect(r.headers.get(VISITOR_HEADER)).toBe(A);
    expect(r.newId).toBeNull();
  });
  it("mints and reports a new id when the cookie is missing or malformed", () => {
    for (const cookie of [undefined, "", "not-an-id", "A".repeat(32)]) {
      const r = prepareVisitorHeaders(new Headers(), cookie);
      expect(isVisitorId(r.newId)).toBe(true);
      expect(r.headers.get(VISITOR_HEADER)).toBe(r.newId);
    }
  });
  it("overwrites a visitor header supplied by the client: nobody can claim someone else's id", () => {
    const incoming = new Headers({ [VISITOR_HEADER]: A });
    const r = prepareVisitorHeaders(incoming, B);
    expect(r.headers.get(VISITOR_HEADER)).toBe(B);
    const r2 = prepareVisitorHeaders(new Headers({ [VISITOR_HEADER]: A }), undefined);
    expect(r2.headers.get(VISITOR_HEADER)).not.toBe(A);
  });
  it("keeps the other headers and does not modify the input", () => {
    const incoming = new Headers({ "x-other": "1", [VISITOR_HEADER]: A });
    const r = prepareVisitorHeaders(incoming, B);
    expect(r.headers.get("x-other")).toBe("1");
    expect(incoming.get(VISITOR_HEADER)).toBe(A);
  });
});

describe("visitorCookie", () => {
  it("is HttpOnly, SameSite=Strict and long-lived", () => {
    const c = visitorCookie(A, false);
    expect(c.startsWith(`${VISITOR_COOKIE}=${A};`)).toBe(true);
    for (const f of ["Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=31536000"]) expect(c).toContain(f);
    expect(c).not.toContain("Secure");
  });
  it("adds Secure over https", () => expect(visitorCookie(A, true)).toContain("Secure"));
});
