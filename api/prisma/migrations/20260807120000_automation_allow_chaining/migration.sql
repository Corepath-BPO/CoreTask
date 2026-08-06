-- Whether a rule may run on an event another rule caused.
--
-- Additive and defaulted to true, so every rule that exists keeps behaving
-- exactly as it does today: this records an intent that was previously
-- unexpressible, it does not change what any current rule means.
ALTER TABLE "automation_rules"
  ADD COLUMN "allowChaining" BOOLEAN NOT NULL DEFAULT true;
