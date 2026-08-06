-- The structured rule model: a trigger and an ordered list of branches, each
-- with a condition group and an ordered list of actions.
--
-- Entirely additive. `automation_nodes` is untouched and every rule keeps
-- running against it until the backfill has been verified — see
-- docs/architecture/asana-parity-rule-builder.md for the phasing.

CREATE TYPE "AutomationRuleNameMode" AS ENUM ('AUTO', 'MANUAL');
CREATE TYPE "AutomationBranchType" AS ENUM ('PRIMARY', 'OTHERWISE_IF', 'OTHERWISE');
CREATE TYPE "ConditionGroupOperator" AS ENUM ('ALL', 'ANY');

-- One editable or published state of a rule. The draft and the published
-- version are different rows on purpose: editing a live rule must not change
-- what it does until somebody publishes.
CREATE TABLE "automation_rule_versions" (
  "id"            UUID NOT NULL,
  "ruleId"        UUID NOT NULL,
  "version"       INTEGER NOT NULL,
  "triggerType"   VARCHAR(60) NOT NULL,
  "triggerConfig" JSONB NOT NULL DEFAULT '{}',
  "createdById"   UUID,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "automation_rule_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automation_rule_versions_ruleId_version_key"
  ON "automation_rule_versions" ("ruleId", "version");
CREATE INDEX "automation_rule_versions_ruleId_idx"
  ON "automation_rule_versions" ("ruleId");

-- One of a rule's ordered alternatives. Ordered by an integer rather than by
-- parentage, so moving a branch is one write rather than rewriting a chain.
CREATE TABLE "automation_branches" (
  "id"            UUID NOT NULL,
  "ruleVersionId" UUID NOT NULL,
  "type"          "AutomationBranchType" NOT NULL,
  "position"      INTEGER NOT NULL,

  CONSTRAINT "automation_branches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automation_branches_ruleVersionId_position_key"
  ON "automation_branches" ("ruleVersionId", "position");
CREATE INDEX "automation_branches_ruleVersionId_idx"
  ON "automation_branches" ("ruleVersionId");

-- The conditions a branch is chosen by, and how they combine.
CREATE TABLE "automation_condition_groups" (
  "id"       UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "operator" "ConditionGroupOperator" NOT NULL DEFAULT 'ALL',

  CONSTRAINT "automation_condition_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automation_condition_groups_branchId_key"
  ON "automation_condition_groups" ("branchId");

CREATE TABLE "automation_conditions" (
  "id"               UUID NOT NULL,
  "conditionGroupId" UUID NOT NULL,
  "fieldKey"         VARCHAR(120) NOT NULL,
  "operator"         VARCHAR(40) NOT NULL,
  "value"            JSONB NOT NULL DEFAULT 'null',
  "position"         INTEGER NOT NULL,

  CONSTRAINT "automation_conditions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automation_conditions_conditionGroupId_position_key"
  ON "automation_conditions" ("conditionGroupId", "position");
CREATE INDEX "automation_conditions_conditionGroupId_idx"
  ON "automation_conditions" ("conditionGroupId");

CREATE TABLE "automation_actions" (
  "id"            UUID NOT NULL,
  "branchId"      UUID NOT NULL,
  "actionType"    VARCHAR(60) NOT NULL,
  "configuration" JSONB NOT NULL DEFAULT '{}',
  "position"      INTEGER NOT NULL,

  CONSTRAINT "automation_actions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automation_actions_branchId_position_key"
  ON "automation_actions" ("branchId", "position");
CREATE INDEX "automation_actions_branchId_idx"
  ON "automation_actions" ("branchId");

-- MANUAL for every rule that already exists: each of their names was typed by
-- somebody, and re-deriving one from its trigger would rename their rule.
ALTER TABLE "automation_rules"
  ADD COLUMN "nameMode" "AutomationRuleNameMode" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "draftVersionId" UUID,
  ADD COLUMN "publishedVersionId" UUID;

CREATE UNIQUE INDEX "automation_rules_draftVersionId_key"
  ON "automation_rules" ("draftVersionId");
CREATE UNIQUE INDEX "automation_rules_publishedVersionId_key"
  ON "automation_rules" ("publishedVersionId");

ALTER TABLE "automation_rule_versions"
  ADD CONSTRAINT "automation_rule_versions_ruleId_fkey"
  FOREIGN KEY ("ruleId") REFERENCES "automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automation_rule_versions"
  ADD CONSTRAINT "automation_rule_versions_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "automation_branches"
  ADD CONSTRAINT "automation_branches_ruleVersionId_fkey"
  FOREIGN KEY ("ruleVersionId") REFERENCES "automation_rule_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automation_condition_groups"
  ADD CONSTRAINT "automation_condition_groups_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "automation_branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automation_conditions"
  ADD CONSTRAINT "automation_conditions_conditionGroupId_fkey"
  FOREIGN KEY ("conditionGroupId") REFERENCES "automation_condition_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automation_actions"
  ADD CONSTRAINT "automation_actions_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "automation_branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not CASCADE: losing a version must not delete the rule that points
-- at it. A rule with no draft is recoverable; a rule that vanished is not.
ALTER TABLE "automation_rules"
  ADD CONSTRAINT "automation_rules_draftVersionId_fkey"
  FOREIGN KEY ("draftVersionId") REFERENCES "automation_rule_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "automation_rules"
  ADD CONSTRAINT "automation_rules_publishedVersionId_fkey"
  FOREIGN KEY ("publishedVersionId") REFERENCES "automation_rule_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
