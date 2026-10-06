import { assertTestDatabase } from "./scripts/test-db";

assertTestDatabase(process.env.DATABASE_URL);
