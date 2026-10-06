import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NormalizedTicket } from "@handover/core";
import type { Connector, ProjectInfo, TicketPage } from "./types";

/** Serves fake tickets from a folder so everything runs without credentials. */
export class FixtureConnector implements Connector {
  constructor(
    private readonly dir = fileURLToPath(new URL("../../../fixtures/jira", import.meta.url)),
    private readonly project: ProjectInfo = { key: "HND", name: "Handover Demo" },
  ) {}

  /** The larger "Shopfront" demo team (see fixtures/showcase). */
  static showcase(): FixtureConnector {
    return new FixtureConnector(fileURLToPath(new URL("../../../fixtures/showcase", import.meta.url)), { key: "SHOP", name: "Shopfront" });
  }

  async listProjects(): Promise<ProjectInfo[]> {
    return [this.project];
  }

  async fetchIssues(projectKey: string, cursor?: string | null, pageSize = 100): Promise<TicketPage> {
    const all = readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((f) => NormalizedTicket.parse(JSON.parse(readFileSync(join(this.dir, f), "utf8"))))
      .filter((t) => t.project === projectKey);
    const start = Number(cursor ?? 0);
    const end = start + pageSize;
    return { tickets: all.slice(start, end), nextCursor: end < all.length ? String(end) : null };
  }
}
