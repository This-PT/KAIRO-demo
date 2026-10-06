import type { NormalizedTicket } from "@handover/core";
import type { Connector, ProjectInfo, TicketPage } from "../types";
import { adfToText } from "./adf";
import type { JiraClient } from "./client";

interface JiraComment { author?: { displayName?: string } | null; created: string; body?: unknown }
interface JiraHistory {
  author?: { displayName?: string } | null;
  created: string;
  items: { field: string; fromString?: string | null; toString?: string | null }[];
}
interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    status?: { name: string };
    labels?: string[];
    description?: unknown;
    updated: string;
    issuetype?: { name: string };
    parent?: { key: string };
    assignee?: { displayName?: string } | null;
    comment?: { total: number; comments: JiraComment[] };
    issuelinks?: { type: { inward: string; outward: string }; inwardIssue?: { key: string }; outwardIssue?: { key: string } }[];
  };
  changelog?: { total?: number; histories: JiraHistory[] };
}

const FIELDS = "summary,status,labels,description,comment,issuelinks,updated,parent,issuetype,assignee";
const name = (a?: { displayName?: string } | null) => a?.displayName ?? "Unknown";

export class JiraConnector implements Connector {
  constructor(private readonly client: JiraClient) {}

  async listProjects(): Promise<ProjectInfo[]> {
    const out: ProjectInfo[] = [];
    for (;;) {
      const page = await this.client.get<{ values: ProjectInfo[]; isLast?: boolean }>("/rest/api/3/project/search", {
        startAt: out.length,
        maxResults: 50,
      });
      out.push(...page.values.map((p) => ({ key: p.key, name: p.name })));
      if (page.isLast !== false || page.values.length === 0) return out;
    }
  }

  async fetchIssues(projectKey: string, cursor?: string | null, pageSize = 100): Promise<TicketPage> {
    const res = await this.client.get<{ issues: JiraIssue[]; nextPageToken?: string }>("/rest/api/3/search/jql", {
      jql: `project = "${projectKey}" ORDER BY updated ASC`,
      fields: FIELDS,
      expand: "changelog",
      maxResults: pageSize,
      nextPageToken: cursor ?? undefined,
    });
    const tickets: NormalizedTicket[] = [];
    for (const issue of res.issues) tickets.push(await this.normalize(issue, projectKey));
    return { tickets, nextCursor: res.nextPageToken ?? null };
  }

  private async normalize(issue: JiraIssue, project: string): Promise<NormalizedTicket> {
    const f = issue.fields;
    let comments = f.comment?.comments ?? [];
    if ((f.comment?.total ?? 0) > comments.length) comments = await this.allComments(issue.key);
    let histories = issue.changelog?.histories ?? [];
    if ((issue.changelog?.total ?? 0) > histories.length) histories = await this.allChangelog(issue.key);

    return {
      key: issue.key,
      project,
      url: `${this.client.baseUrl}/browse/${issue.key}`,
      title: f.summary,
      status: f.status?.name ?? "Unknown",
      labels: f.labels ?? [],
      description: adfToText(f.description),
      comments: comments.map((c) => ({ author: name(c.author), created: c.created, body: adfToText(c.body) })),
      changelog: histories.flatMap((h) =>
        h.items.map((i) => ({ author: name(h.author), created: h.created, field: i.field, from: i.fromString ?? null, to: i.toString ?? null })),
      ),
      links: (f.issuelinks ?? []).flatMap((l) =>
        l.outwardIssue ? [{ type: l.type.outward, key: l.outwardIssue.key }] : l.inwardIssue ? [{ type: l.type.inward, key: l.inwardIssue.key }] : [],
      ),
      updated: f.updated,
      issueType: f.issuetype?.name ?? "Task",
      parent: f.parent?.key ?? null,
      assignee: f.assignee?.displayName ?? null,
    };
  }

  private async allComments(key: string): Promise<JiraComment[]> {
    const out: JiraComment[] = [];
    for (;;) {
      const page = await this.client.get<{ total: number; comments: JiraComment[] }>(`/rest/api/3/issue/${key}/comment`, { startAt: out.length, maxResults: 100 });
      out.push(...page.comments);
      if (out.length >= page.total || page.comments.length === 0) return out;
    }
  }

  private async allChangelog(key: string): Promise<JiraHistory[]> {
    const out: JiraHistory[] = [];
    for (;;) {
      const page = await this.client.get<{ values: JiraHistory[]; isLast?: boolean }>(`/rest/api/3/issue/${key}/changelog`, { startAt: out.length, maxResults: 100 });
      out.push(...page.values);
      if (page.isLast !== false || page.values.length === 0) return out;
    }
  }
}
