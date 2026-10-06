import { createHash } from "node:crypto";
import { renderTicketText } from "@kairo/core";
import type { Connector } from "@kairo/connectors";
import { Prisma, type PrismaClient } from "@kairo/db";
import { applyPolicy, type Rule } from "@kairo/policy";
import { encrypt } from "./crypto";

export interface IngestOptions {
  connector: Connector;
  db: PrismaClient;
  projectKey: string;
  rules: Rule[];
  encryptionKey: string;
  pageSize?: number;
  /** Called only for readable tickets that are new or changed. */
  enqueueSummarize: (ticketKey: string) => Promise<void>;
}

export interface IngestResult {
  fetched: number;
  readable: number;
  restricted: number;
  skipped: number;
}

export async function ingestProject(o: IngestOptions): Promise<IngestResult> {
  const project = await o.db.project.findUniqueOrThrow({ where: { key: o.projectKey } });
  const run = await o.db.ingestRun.create({ data: { projectId: project.id } });
  const result: IngestResult = { fetched: 0, readable: 0, restricted: 0, skipped: 0 };

  try {
    let cursor: string | null = null;
    do {
      const page = await o.connector.fetchIssues(o.projectKey, cursor, o.pageSize);
      for (const t of page.tickets) {
        result.fetched++;
        const policy = applyPolicy(t, o.rules);
        const restricted = policy.visibility === "restricted";
        // The hash covers only what the summary depends on. Hierarchy and assignee changes must not trigger a new (paid) summary.
        const { key, project: proj, url, title, status, labels, description, comments, changelog, links, updated } = t;
        const contentHash = createHash("sha256")
          .update(JSON.stringify({ key, proj, url, title, status, labels, description, comments, changelog, links, updated }))
          .update(policy.visibility)
          .digest("hex");
        // Structure is kept for restricted tickets so the tree keeps its shape; labels and assignee can reveal sensitive context, so they are not.
        const meta = {
          issueType: t.issueType,
          parentKey: t.parent,
          assignee: restricted ? null : t.assignee,
          labels: restricted ? [] : t.labels,
        };
        const existing = await o.db.ticket.findUnique({ where: { key: t.key } });
        if (existing?.contentHash === contentHash) {
          const same = existing.issueType === meta.issueType && existing.parentKey === meta.parentKey && existing.assignee === meta.assignee && existing.labels.join("\u0000") === meta.labels.join("\u0000");
          if (!same) await o.db.ticket.update({ where: { id: existing.id }, data: meta });
          result.skipped++;
          continue;
        }

        const base = {
          projectId: project.id,
          url: t.url,
          // A restricted title can itself be sensitive, so it is never stored in plaintext.
          title: restricted ? "[Restricted]" : t.title,
          status: restricted ? "restricted" : t.status,
          visibility: policy.visibility,
          sourceUpdatedAt: new Date(t.updated),
          contentHash,
          ...meta,
        };
        const ticket = await o.db.ticket.upsert({ where: { key: t.key }, create: { key: t.key, ...base }, update: base });

        const content = restricted
          ? { redactedText: null, structured: Prisma.DbNull, rawEncrypted: new Uint8Array(encrypt(JSON.stringify(t), o.encryptionKey)) }
          : { redactedText: renderTicketText(policy.ticket), structured: policy.ticket as unknown as Prisma.InputJsonValue, rawEncrypted: null };
        await o.db.ticketContent.upsert({
          where: { ticketId: ticket.id },
          create: { ticketId: ticket.id, ...(content as Prisma.TicketContentUncheckedCreateWithoutTicketInput) },
          update: content as Prisma.TicketContentUncheckedUpdateWithoutTicketInput,
        });

        await o.db.redactionEvent.deleteMany({ where: { ticketId: ticket.id } });
        await o.db.ticketLink.deleteMany({ where: { fromId: ticket.id } });

        if (restricted) {
          // Anything derived from this ticket's content must not outlive a restriction.
          await o.db.summary.deleteMany({ where: { ticketId: ticket.id } });
          result.restricted++;
        } else {
          await o.db.redactionEvent.createMany({ data: policy.redactions.map((r) => ({ ticketId: ticket.id, ...r })) });
          await o.db.ticketLink.createMany({ data: policy.ticket.links.map((l) => ({ fromId: ticket.id, toKey: l.key, type: l.type })) });
          result.readable++;
          await o.enqueueSummarize(t.key);
        }
      }
      cursor = page.nextCursor;
      await o.db.ingestRun.update({ where: { id: run.id }, data: { cursor, fetched: result.fetched, restricted: result.restricted } });
    } while (cursor);

    await o.db.ingestRun.update({ where: { id: run.id }, data: { status: "done" } });
    return result;
  } catch (e) {
    await o.db.ingestRun.update({ where: { id: run.id }, data: { status: "failed", error: e instanceof Error ? e.message : String(e) } });
    throw e;
  }
}
