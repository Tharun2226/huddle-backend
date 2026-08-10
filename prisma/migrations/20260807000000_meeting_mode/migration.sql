-- AlterEnum
CREATE TYPE "MeetingMode" AS ENUM ('BOTH', 'ONLINE_ONLY', 'IN_PERSON_ONLY');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "meetingMode" "MeetingMode" NOT NULL DEFAULT 'BOTH';
