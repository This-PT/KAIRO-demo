import type { PrismaClient } from "@prisma/client";

/** Test helper: removes a project and everything hanging off it. */
export async function wipeProject(db: PrismaClient, key: string) {
  const p = await db.project.findUnique({ where: { key } });
  if (!p) return;
  const t = { ticket: { projectId: p.id } };
  await db.auditLog.deleteMany({ where: t });
  await db.summary.deleteMany({ where: t });
  await db.redactionEvent.deleteMany({ where: t });
  await db.ticketLink.deleteMany({ where: { from: { projectId: p.id } } });
  await db.ticketContent.deleteMany({ where: t });
  await db.ticket.deleteMany({ where: { projectId: p.id } });
  await db.ingestRun.deleteMany({ where: { projectId: p.id } });
  await db.policyRule.deleteMany({ where: { projectId: p.id } });
  await db.project.delete({ where: { id: p.id } });
  await db.connection.deleteMany({ where: { id: p.connectionId, projects: { none: {} } } });
}
