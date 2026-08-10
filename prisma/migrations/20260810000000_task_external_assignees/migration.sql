-- AlterTable
ALTER TABLE "Task" ADD COLUMN "externalAssignees" JSONB NOT NULL DEFAULT '[]';
