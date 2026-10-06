import type { NormalizedTicket } from "@kairo/core";

export interface ProjectInfo {
  key: string;
  name: string;
}

export interface TicketPage {
  tickets: NormalizedTicket[];
  /** null when there are no more pages */
  nextCursor: string | null;
}

/** Source-agnostic interface. Jira today; GitHub can implement this later. */
export interface Connector {
  listProjects(): Promise<ProjectInfo[]>;
  fetchIssues(projectKey: string, cursor?: string | null, pageSize?: number): Promise<TicketPage>;
}
