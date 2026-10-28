import { useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import type { AutomationRule } from '../api/automations.api';
import { useAutomationMetadata } from '../builder/hooks/use-automation-graph';
import { AutomationRunHistoryDialog } from '../components/automation-run-history-dialog';
import { SaveToLibraryDialog, type LibraryTarget } from '../components/save-to-library-dialog';
import { collectRuleReferences } from '../lib/template-references';

import {
  useDuplicateRule,
  useEnableRule,
  usePauseRule,
  usePublishRule,
  useRemoveRule,
} from './use-automations';

/** What a list of rules can do to one of them, and the dialogs those open. */
export interface RuleActions {
  edit: (rule: AutomationRule) => void;
  showHistory: (rule: AutomationRule) => void;
  publish: (rule: AutomationRule) => void;
  pause: (rule: AutomationRule) => void;
  resume: (rule: AutomationRule) => void;
  duplicate: (rule: AutomationRule) => void;
  saveToLibrary: (rule: AutomationRule) => void;
  /** Asks first: archive or delete depends on whether the rule has run. */
  remove: (rule: AutomationRule) => void;
  /** Mount once beside the list. */
  dialogs: ReactNode;
}

/**
 * The rule actions the Automations tab and the Customize drawer share.
 *
 * One per list rather than one per row, so forty rules mount one set of
 * dialogs, not forty.
 */
export function useRuleActions(workspaceId: string | undefined, projectId: string): RuleActions {
  const navigate = useNavigate();
  const publish = usePublishRule(workspaceId, projectId);
  const pause = usePauseRule(workspaceId, projectId);
  const enable = useEnableRule(workspaceId, projectId);
  const duplicate = useDuplicateRule(workspaceId, projectId);
  const remove = useRemoveRule(workspaceId, projectId);
  /* The project's names for what a rule points at, so the save dialog can say
     "this rule names Incoming Request and To do" rather than listing ids. */
  const { data: metadata } = useAutomationMetadata(workspaceId, projectId);

  const [pendingRemove, setPendingRemove] = useState<AutomationRule | null>(null);
  const [historyRule, setHistoryRule] = useState<AutomationRule | null>(null);
  const [libraryTarget, setLibraryTarget] = useState<LibraryTarget | null>(null);

  const archives = pendingRemove !== null && pendingRemove.runCount > 0;

  return {
    edit: (rule) =>
      void navigate({
        to: '/projects/$projectId/automations/$ruleId',
        params: { projectId, ruleId: rule.id },
        search: {},
      }),
    showHistory: setHistoryRule,
    publish: (rule) => publish.mutate(rule.id),
    pause: (rule) => pause.mutate(rule.id),
    resume: (rule) => enable.mutate(rule.id),
    duplicate: (rule) => duplicate.mutate(rule.id),
    saveToLibrary: (rule) =>
      setLibraryTarget({
        kind: 'rule',
        projectId,
        ruleId: rule.id,
        name: rule.name,
        description: rule.description,
        references: collectRuleReferences(
          rule.nodes.map((node) => ({ type: node.nodeType, configuration: node.configuration })),
          rule.triggerConfig,
          metadata,
        ),
      }),
    remove: setPendingRemove,
    dialogs: (
      <>
        <AlertDialog
          open={pendingRemove !== null}
          onOpenChange={(open) => !open && setPendingRemove(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {archives ? 'Archive' : 'Delete'} “{pendingRemove?.name}”?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {archives
                  ? 'It stops running, and its history stays so you can still see what it changed.'
                  : 'This draft has never run, so nothing is lost.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (pendingRemove) remove.mutate(pendingRemove.id);
                  setPendingRemove(null);
                }}
              >
                {archives ? 'Archive' : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AutomationRunHistoryDialog
          workspaceId={workspaceId}
          projectId={projectId}
          rule={historyRule}
          onOpenChange={(open) => !open && setHistoryRule(null)}
        />

        <SaveToLibraryDialog
          workspaceId={workspaceId}
          target={libraryTarget}
          onOpenChange={(open) => !open && setLibraryTarget(null)}
        />
      </>
    ),
  };
}
