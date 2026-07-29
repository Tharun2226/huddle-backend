-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "recurrence" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "taskId" TEXT;

-- CreateIndex
CREATE INDEX "Meeting_taskId_idx" ON "Meeting"("taskId");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
