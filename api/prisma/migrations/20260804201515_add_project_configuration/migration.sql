-- CreateEnum
CREATE TYPE "StatusCategory" AS ENUM ('NOT_STARTED', 'ACTIVE', 'BLOCKED', 'COMPLETED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'CHECKBOX', 'SINGLE_SELECT', 'MULTI_SELECT', 'PEOPLE', 'URL', 'EMAIL');

-- CreateEnum
CREATE TYPE "ProjectViewType" AS ENUM ('LIST', 'BOARD', 'CALENDAR', 'TIMELINE', 'DASHBOARD');

-- CreateEnum
CREATE TYPE "ProjectViewScope" AS ENUM ('PROJECT', 'PERSONAL');

-- AlterTable
ALTER TABLE "sections" ADD COLUMN     "defaultStatusId" UUID;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "priorityDefinitionId" UUID,
ADD COLUMN     "statusDefinitionId" UUID;

-- CreateTable
CREATE TABLE "status_definitions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID,
    "name" VARCHAR(60) NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "category" "StatusCategory" NOT NULL,
    "colorToken" VARCHAR(20) NOT NULL DEFAULT 'gray',
    "customColor" VARCHAR(9),
    "icon" VARCHAR(40),
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "status_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "priority_definitions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "level" INTEGER NOT NULL,
    "colorToken" VARCHAR(20) NOT NULL DEFAULT 'gray',
    "customColor" VARCHAR(9),
    "icon" VARCHAR(40),
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "priority_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_fields" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" TEXT,
    "type" "CustomFieldType" NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_options" (
    "id" UUID NOT NULL,
    "customFieldId" UUID NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "colorToken" VARCHAR(20) NOT NULL DEFAULT 'gray',
    "customColor" VARCHAR(9),
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_custom_field_values" (
    "taskId" UUID NOT NULL,
    "customFieldId" UUID NOT NULL,
    "textValue" TEXT,
    "numberValue" DECIMAL(20,6),
    "dateValue" TIMESTAMP(3),
    "booleanValue" BOOLEAN,
    "optionIds" UUID[],
    "userIds" UUID[],
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_custom_field_values_pkey" PRIMARY KEY ("taskId","customFieldId")
);

-- CreateTable
CREATE TABLE "project_views" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "type" "ProjectViewType" NOT NULL,
    "scope" "ProjectViewScope" NOT NULL DEFAULT 'PROJECT',
    "ownerUserId" UUID,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "status_definitions_projectId_position_idx" ON "status_definitions"("projectId", "position");

-- CreateIndex
CREATE INDEX "status_definitions_workspaceId_category_idx" ON "status_definitions"("workspaceId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "status_definitions_workspaceId_projectId_slug_key" ON "status_definitions"("workspaceId", "projectId", "slug");

-- CreateIndex
CREATE INDEX "priority_definitions_workspaceId_position_idx" ON "priority_definitions"("workspaceId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "priority_definitions_workspaceId_slug_key" ON "priority_definitions"("workspaceId", "slug");

-- CreateIndex
CREATE INDEX "custom_fields_projectId_position_idx" ON "custom_fields"("projectId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "custom_fields_projectId_name_key" ON "custom_fields"("projectId", "name");

-- CreateIndex
CREATE INDEX "custom_field_options_customFieldId_position_idx" ON "custom_field_options"("customFieldId", "position");

-- CreateIndex
CREATE INDEX "task_custom_field_values_customFieldId_idx" ON "task_custom_field_values"("customFieldId");

-- CreateIndex
CREATE INDEX "task_custom_field_values_customFieldId_textValue_idx" ON "task_custom_field_values"("customFieldId", "textValue");

-- CreateIndex
CREATE INDEX "task_custom_field_values_customFieldId_numberValue_idx" ON "task_custom_field_values"("customFieldId", "numberValue");

-- CreateIndex
CREATE INDEX "task_custom_field_values_customFieldId_dateValue_idx" ON "task_custom_field_values"("customFieldId", "dateValue");

-- CreateIndex
CREATE INDEX "project_views_projectId_type_idx" ON "project_views"("projectId", "type");

-- CreateIndex
CREATE INDEX "project_views_projectId_ownerUserId_idx" ON "project_views"("projectId", "ownerUserId");

-- CreateIndex
CREATE INDEX "tasks_statusDefinitionId_idx" ON "tasks"("statusDefinitionId");

-- CreateIndex
CREATE INDEX "tasks_priorityDefinitionId_idx" ON "tasks"("priorityDefinitionId");

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_defaultStatusId_fkey" FOREIGN KEY ("defaultStatusId") REFERENCES "status_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_statusDefinitionId_fkey" FOREIGN KEY ("statusDefinitionId") REFERENCES "status_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_priorityDefinitionId_fkey" FOREIGN KEY ("priorityDefinitionId") REFERENCES "priority_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_definitions" ADD CONSTRAINT "status_definitions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_definitions" ADD CONSTRAINT "status_definitions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "priority_definitions" ADD CONSTRAINT "priority_definitions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_options" ADD CONSTRAINT "custom_field_options_customFieldId_fkey" FOREIGN KEY ("customFieldId") REFERENCES "custom_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_custom_field_values" ADD CONSTRAINT "task_custom_field_values_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_custom_field_values" ADD CONSTRAINT "task_custom_field_values_customFieldId_fkey" FOREIGN KEY ("customFieldId") REFERENCES "custom_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_custom_field_values" ADD CONSTRAINT "task_custom_field_values_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_views" ADD CONSTRAINT "project_views_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_views" ADD CONSTRAINT "project_views_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_views" ADD CONSTRAINT "project_views_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_views" ADD CONSTRAINT "project_views_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
