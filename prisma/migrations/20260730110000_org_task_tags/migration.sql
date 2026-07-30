-- CreateTable
CREATE TABLE "OrgTaskTag" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6B7280',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgTaskTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgTaskTag_organizationId_idx" ON "OrgTaskTag"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgTaskTag_organizationId_slug_key" ON "OrgTaskTag"("organizationId", "slug");

-- AddForeignKey
ALTER TABLE "OrgTaskTag" ADD CONSTRAINT "OrgTaskTag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed default tags for existing orgs (skip platform if desired — apply to all)
INSERT INTO "OrgTaskTag" ("id", "organizationId", "name", "slug", "color", "sortOrder", "isDefault", "isActive")
SELECT
  'tag_' || o.id || '_' || t.slug,
  o.id,
  t.name,
  t.slug,
  t.color,
  t.sort_order,
  t.is_default,
  true
FROM "Organization" o
CROSS JOIN (
  VALUES
    ('Frontend', 'frontend', '#3B82F6', 0, true),
    ('Backend', 'backend', '#8B5CF6', 1, false),
    ('Design', 'design', '#EC4899', 2, false),
    ('Mobile', 'mobile', '#14B8A6', 3, false),
    ('QA', 'qa', '#F59E0B', 4, false),
    ('DevOps', 'devops', '#64748B', 5, false)
) AS t(name, slug, color, sort_order, is_default)
ON CONFLICT ("organizationId", "slug") DO NOTHING;
