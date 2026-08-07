-- Reconcile the action configuration key names.
--
-- The builder wrote `statusDefinitionId`, `priorityDefinitionId` and
-- `customFieldId`; the runner read `status`, `priority` and `fieldId`. Nothing
-- crossed the gap, so a "change the status" action built in the UI ran and set
-- the status to an empty string — a failure with no error attached to it.
--
-- The runner's spelling is canonical, because the value is a status *id* and an
-- id here is legitimately either a definition's uuid or a legacy enum name.
--
-- Renames only where the canonical key is absent, so a configuration that
-- already carries both is left as it is rather than having the newer value
-- overwritten by the older one.

UPDATE "automation_nodes"
SET "configuration" =
      ("configuration" - 'statusDefinitionId')
      || jsonb_build_object('status', "configuration" -> 'statusDefinitionId')
WHERE "nodeType" = 'ACTION'
  AND "subtype" = 'UPDATE_STATUS'
  AND "configuration" ? 'statusDefinitionId'
  AND NOT ("configuration" ? 'status');

UPDATE "automation_nodes"
SET "configuration" =
      ("configuration" - 'priorityDefinitionId')
      || jsonb_build_object('priority', "configuration" -> 'priorityDefinitionId')
WHERE "nodeType" = 'ACTION'
  AND "subtype" = 'UPDATE_PRIORITY'
  AND "configuration" ? 'priorityDefinitionId'
  AND NOT ("configuration" ? 'priority');

UPDATE "automation_nodes"
SET "configuration" =
      ("configuration" - 'customFieldId')
      || jsonb_build_object('fieldId', "configuration" -> 'customFieldId')
WHERE "nodeType" = 'ACTION'
  AND "subtype" = 'SET_CUSTOM_FIELD'
  AND "configuration" ? 'customFieldId'
  AND NOT ("configuration" ? 'fieldId');

-- Drop a key left behind where both spellings were present: it has served its
-- purpose and leaving it invites the next reader to wonder which one wins.
UPDATE "automation_nodes"
SET "configuration" = "configuration" - 'statusDefinitionId'
WHERE "nodeType" = 'ACTION' AND "subtype" = 'UPDATE_STATUS'
  AND "configuration" ? 'statusDefinitionId' AND "configuration" ? 'status';

UPDATE "automation_nodes"
SET "configuration" = "configuration" - 'priorityDefinitionId'
WHERE "nodeType" = 'ACTION' AND "subtype" = 'UPDATE_PRIORITY'
  AND "configuration" ? 'priorityDefinitionId' AND "configuration" ? 'priority';

UPDATE "automation_nodes"
SET "configuration" = "configuration" - 'customFieldId'
WHERE "nodeType" = 'ACTION' AND "subtype" = 'SET_CUSTOM_FIELD'
  AND "configuration" ? 'customFieldId' AND "configuration" ? 'fieldId';
