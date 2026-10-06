/** Tests run against a separate database so they can never delete real or demo data. */

export function testDatabaseUrl(url: string): string {
  const u = new URL(url);
  const name = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!name) throw new Error("DATABASE_URL has no database name");
  if (!name.endsWith("_test")) u.pathname = `/${encodeURIComponent(name + "_test")}`;
  return u.toString();
}

/** Called before every test file. Throws unless the database is clearly a test database. */
export function assertTestDatabase(url: string | undefined): void {
  if (!url) throw new Error("DATABASE_URL is not set. Run the tests with `pnpm test` so .env is loaded.");
  let name = "";
  try {
    name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }
  if (!name.endsWith("_test")) {
    // Only the database name is reported; never the credentials.
    throw new Error(`Refusing to run tests against database "${name}": its name must end with _test.`);
  }
}
