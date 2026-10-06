-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN     "ownerId" TEXT;

-- CreateIndex
CREATE INDEX "ChatSession_ownerId_createdAt_idx" ON "ChatSession"("ownerId", "createdAt");
