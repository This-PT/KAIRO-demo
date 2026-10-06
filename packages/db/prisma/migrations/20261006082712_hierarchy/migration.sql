-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "assignee" TEXT,
ADD COLUMN     "issueType" TEXT NOT NULL DEFAULT 'Task',
ADD COLUMN     "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "parentKey" TEXT;

-- CreateIndex
CREATE INDEX "Ticket_parentKey_idx" ON "Ticket"("parentKey");
