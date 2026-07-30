-- AlterTable
ALTER TABLE "OrgTaskStatus" ADD COLUMN "icon" TEXT NOT NULL DEFAULT 'circle_outlined';

-- AlterTable
ALTER TABLE "OrgTaskPriority" ADD COLUMN "icon" TEXT NOT NULL DEFAULT 'remove';

-- Seed sensible icons for existing rows by slug
UPDATE "OrgTaskStatus" SET "icon" = 'circle_outlined' WHERE "slug" = 'todo';
UPDATE "OrgTaskStatus" SET "icon" = 'timelapse' WHERE "slug" = 'in_progress';
UPDATE "OrgTaskStatus" SET "icon" = 'visibility' WHERE "slug" = 'in_review';
UPDATE "OrgTaskStatus" SET "icon" = 'check_circle' WHERE "slug" = 'done';

UPDATE "OrgTaskPriority" SET "icon" = 'bolt' WHERE "slug" = 'urgent';
UPDATE "OrgTaskPriority" SET "icon" = 'arrow_upward' WHERE "slug" = 'high';
UPDATE "OrgTaskPriority" SET "icon" = 'remove' WHERE "slug" = 'normal';
UPDATE "OrgTaskPriority" SET "icon" = 'arrow_downward' WHERE "slug" = 'low';
