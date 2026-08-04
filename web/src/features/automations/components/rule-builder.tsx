import {
  ACTION_LABEL,
  AUTOMATION_ACTIONS,
  AUTOMATION_NODE_COLOR,
  AUTOMATION_TRIGGERS,
  FilterOperator,
  PLANNED_ACTIONS,
  TRIGGER_LABEL,
} from '@coretask/contracts';
import type { ProjectFieldMetadata } from '@coretask/types';
import { ArrowLeft, Plus, Trash2, Upload, Zap } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SemanticBadge } from '@/features/colors/components/semantic-badge';
import { cn } from '@/lib/utils';

/** A node as the builder holds it, before it is sent. */
export interface DraftNode {
  nodeType: 'TRIGGER' | 'CONDITION' | 'ACTION';
  subtype: string;
  configuration: Record<string, unknown>;
}

export interface RuleDraft {
  name: string;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  nodes: DraftNode[];
}

/** Task fields a condition can test, with the values each accepts. */
const CONDITION_FIELDS = [
  { field: 'status', label: 'Status' },
  { field: 'priority', label: 'Priority' },
  { field: 'sectionId', label: 'Section' },
  { field: 'assigneeId', label: 'Assignee' },
  { field: 'title', label: 'Title' },
] as const;

const CONDITION_OPERATORS = [
  FilterOperator.EQUALS,
  FilterOperator.NOT_EQUALS,
  FilterOperator.CONTAINS,
  FilterOperator.IS_EMPTY,
  FilterOperator.IS_NOT_EMPTY,
];

/**
 * Builds one automation rule.
 *
 * A structured stack of cards rather than a free canvas. A rule is a sequence —
 * when this happens, if these hold, do that — and a stack says so without
 * needing anyone to arrange boxes. It is also keyboard-reachable throughout,
 * which a drag surface is not.
 */
export function RuleBuilder({
  draft,
  metadata,
  saving,
  publishing,
  onChange,
  onSaveDraft,
  onPublish,
  onClose,
}: {
  draft: RuleDraft;
  metadata: ProjectFieldMetadata | undefined;
  saving: boolean;
  publishing: boolean;
  onChange: (draft: RuleDraft) => void;
  onSaveDraft: () => void;
  onPublish: () => void;
  onClose: () => void;
}) {
  const [dirty, setDirty] = useState(false);

  const patch = (next: Partial<RuleDraft>) => {
    setDirty(true);
    onChange({ ...draft, ...next });
  };

  const conditions = draft.nodes.filter((node) => node.nodeType === 'CONDITION');
  const actions = draft.nodes.filter((node) => node.nodeType === 'ACTION');

  const setNodes = (nodeType: DraftNode['nodeType'], next: DraftNode[]) => {
    patch({ nodes: [...draft.nodes.filter((node) => node.nodeType !== nodeType), ...next] });
  };

  /*
   * The same rules the API enforces on publish, shown before the attempt.
   *
   * Not a substitute for the server check — the API is the boundary and returns
   * its own list — but a disabled button with a reason beats a round trip that
   * comes back saying the obvious.
   */
  const problems: string[] = [];
  if (!draft.name.trim()) problems.push('Give the rule a name.');
  if (!draft.triggerType) problems.push('Choose what starts it.');
  if (actions.length === 0) problems.push('Add at least one action.');

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Back to automations">
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Button>

        <Input
          value={draft.name}
          onChange={(event) => patch({ name: event.target.value })}
          placeholder="Name this rule"
          aria-label="Rule name"
          className="max-w-xs"
        />

        <div className="ml-auto flex items-center gap-2">
          {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
          <Button variant="outline" size="sm" onClick={onSaveDraft} loading={saving}>
            Save draft
          </Button>
          <Button
            size="sm"
            onClick={onPublish}
            loading={publishing}
            disabled={problems.length > 0}
            // Says why it is unavailable instead of leaving someone guessing.
            title={problems.length > 0 ? problems.join(' ') : 'Make this rule live'}
          >
            <Upload className="size-4" aria-hidden="true" />
            Publish
          </Button>
        </div>
      </header>

      {problems.length > 0 && (
        <ul className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
          {problems.map((problem) => (
            <li key={problem} className="text-amber-600 dark:text-amber-400">
              {problem}
            </li>
          ))}
        </ul>
      )}

      {/* ---------------------------------------------------------------- */}
      <NodeCard kind="TRIGGER" title="When">
        <div className="grid gap-2 sm:grid-cols-2">
          <Select value={draft.triggerType} onValueChange={(value) => patch({ triggerType: value })}>
            <SelectTrigger aria-label="Trigger">
              <SelectValue placeholder="Choose a trigger" />
            </SelectTrigger>
            <SelectContent>
              {AUTOMATION_TRIGGERS.map((trigger) => (
                <SelectItem key={trigger} value={trigger}>
                  {TRIGGER_LABEL[trigger]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Only the move trigger is section-scoped, so the picker only shows
              for it rather than sitting inert beside every other choice. */}
          {draft.triggerType === 'TASK_MOVED_TO_SECTION' && (
            <Select
              value={(draft.triggerConfig['sectionId'] as string) ?? ''}
              onValueChange={(value) => patch({ triggerConfig: { sectionId: value } })}
            >
              <SelectTrigger aria-label="Section">
                <SelectValue placeholder="Any section" />
              </SelectTrigger>
              <SelectContent>
                {(metadata?.sections ?? []).map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    {section.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </NodeCard>

      {/* ---------------------------------------------------------------- */}
      <NodeCard
        kind="CONDITION"
        title="Check if"
        hint="All of these must hold. With none, the rule always runs."
        onAdd={() =>
          setNodes('CONDITION', [
            ...conditions,
            {
              nodeType: 'CONDITION',
              subtype: 'status',
              configuration: { field: 'status', operator: FilterOperator.EQUALS, value: '' },
            },
          ])
        }
      >
        {conditions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No conditions — this runs every time.</p>
        ) : (
          <ul className="space-y-2">
            {conditions.map((node, index) => (
              <li key={index} className="flex flex-wrap items-center gap-2">
                <Select
                  value={(node.configuration['field'] as string) ?? 'status'}
                  onValueChange={(value) =>
                    setNodes(
                      'CONDITION',
                      conditions.map((entry, i) =>
                        i === index
                          ? {
                              ...entry,
                              subtype: value,
                              configuration: { ...entry.configuration, field: value, value: '' },
                            }
                          : entry,
                      ),
                    )
                  }
                >
                  <SelectTrigger className="w-36" aria-label={`Condition ${index + 1} field`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDITION_FIELDS.map((entry) => (
                      <SelectItem key={entry.field} value={entry.field}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={(node.configuration['operator'] as string) ?? FilterOperator.EQUALS}
                  onValueChange={(value) =>
                    setNodes(
                      'CONDITION',
                      conditions.map((entry, i) =>
                        i === index
                          ? { ...entry, configuration: { ...entry.configuration, operator: value } }
                          : entry,
                      ),
                    )
                  }
                >
                  <SelectTrigger className="w-40" aria-label={`Condition ${index + 1} operator`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDITION_OPERATORS.map((operator) => (
                      <SelectItem key={operator} value={operator}>
                        {operator.replace(/_/g, ' ').toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <ValueInput
                  field={(node.configuration['field'] as string) ?? 'status'}
                  operator={(node.configuration['operator'] as string) ?? FilterOperator.EQUALS}
                  value={node.configuration['value']}
                  metadata={metadata}
                  label={`Condition ${index + 1} value`}
                  onChange={(value) =>
                    setNodes(
                      'CONDITION',
                      conditions.map((entry, i) =>
                        i === index
                          ? { ...entry, configuration: { ...entry.configuration, value } }
                          : entry,
                      ),
                    )
                  }
                />

                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Remove condition ${index + 1}`}
                  onClick={() =>
                    setNodes(
                      'CONDITION',
                      conditions.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </NodeCard>

      {/* ---------------------------------------------------------------- */}
      <NodeCard
        kind="ACTION"
        title="Do this"
        onAdd={() =>
          setNodes('ACTION', [
            ...actions,
            { nodeType: 'ACTION', subtype: 'ASSIGN_USER', configuration: {} },
          ])
        }
      >
        {actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing happens yet. Add an action to make this rule do something.
          </p>
        ) : (
          <ul className="space-y-2">
            {actions.map((node, index) => (
              <li key={index} className="flex flex-wrap items-center gap-2">
                <Select
                  value={node.subtype}
                  onValueChange={(value) =>
                    setNodes(
                      'ACTION',
                      actions.map((entry, i) =>
                        i === index ? { ...entry, subtype: value, configuration: {} } : entry,
                      ),
                    )
                  }
                >
                  <SelectTrigger className="w-52" aria-label={`Action ${index + 1}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUTOMATION_ACTIONS.map((action) => (
                      <SelectItem key={action} value={action}>
                        {ACTION_LABEL[action]}
                      </SelectItem>
                    ))}
                    {/* Listed but never selectable. Omitting them entirely
                        leaves people hunting for something that is coming;
                        offering them working would be a lie. */}
                    {PLANNED_ACTIONS.map((action) => (
                      <SelectItem key={action} value={action} disabled>
                        {action.replace(/_/g, ' ').toLowerCase()} — not yet available
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <ActionConfig
                  subtype={node.subtype}
                  configuration={node.configuration}
                  metadata={metadata}
                  label={`Action ${index + 1}`}
                  onChange={(configuration) =>
                    setNodes(
                      'ACTION',
                      actions.map((entry, i) => (i === index ? { ...entry, configuration } : entry)),
                    )
                  }
                />

                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Remove action ${index + 1}`}
                  onClick={() =>
                    setNodes(
                      'ACTION',
                      actions.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </NodeCard>
    </div>
  );
}

/** One step of the rule, coloured by what kind of step it is. */
function NodeCard({
  kind,
  title,
  hint,
  onAdd,
  children,
}: {
  kind: keyof typeof AUTOMATION_NODE_COLOR;
  title: string;
  hint?: string;
  onAdd?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center gap-2">
          <SemanticBadge color={{ colorToken: AUTOMATION_NODE_COLOR[kind] }}>
            <Zap className="size-3" aria-hidden="true" />
            {title}
          </SemanticBadge>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
          {onAdd && (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={onAdd}>
              <Plus className="size-4" aria-hidden="true" />
              Add
            </Button>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

/** The right control for whatever the condition is comparing. */
function ValueInput({
  field,
  operator,
  value,
  metadata,
  label,
  onChange,
}: {
  field: string;
  operator: string;
  value: unknown;
  metadata: ProjectFieldMetadata | undefined;
  label: string;
  onChange: (value: unknown) => void;
}) {
  // These operators take no value at all, so offering an input would invite
  // someone to fill in something that is then ignored.
  if (operator === FilterOperator.IS_EMPTY || operator === FilterOperator.IS_NOT_EMPTY) {
    return null;
  }

  const options =
    field === 'sectionId'
      ? (metadata?.sections ?? []).map((entry) => ({ value: entry.id, label: entry.name }))
      : field === 'assigneeId'
        ? (metadata?.members ?? []).map((entry) => ({ value: entry.id, label: entry.name }))
        : field === 'status'
          ? ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE', 'CANCELLED'].map(
              (entry) => ({ value: entry, label: entry.replace(/_/g, ' ').toLowerCase() }),
            )
          : field === 'priority'
            ? ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((entry) => ({
                value: entry,
                label: entry.toLowerCase(),
              }))
            : null;

  if (!options) {
    return (
      <Input
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Value"
        aria-label={label}
        className="w-44"
      />
    );
  }

  return (
    <Select value={String(value ?? '')} onValueChange={onChange}>
      <SelectTrigger className="w-44" aria-label={label}>
        <SelectValue placeholder="Choose" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Whatever the chosen action needs to know. */
function ActionConfig({
  subtype,
  configuration,
  metadata,
  label,
  onChange,
}: {
  subtype: string;
  configuration: Record<string, unknown>;
  metadata: ProjectFieldMetadata | undefined;
  label: string;
  onChange: (configuration: Record<string, unknown>) => void;
}) {
  switch (subtype) {
    case 'ASSIGN_USER':
      return (
        <Select
          value={(configuration['userId'] as string) ?? ''}
          onValueChange={(userId) => onChange({ userId })}
        >
          <SelectTrigger className="w-52" aria-label={`${label} assignee`}>
            <SelectValue placeholder="Choose a person" />
          </SelectTrigger>
          <SelectContent>
            {(metadata?.members ?? []).map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {member.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case 'MOVE_TO_SECTION':
      return (
        <Select
          value={(configuration['sectionId'] as string) ?? ''}
          onValueChange={(sectionId) => onChange({ sectionId })}
        >
          <SelectTrigger className="w-52" aria-label={`${label} section`}>
            <SelectValue placeholder="Choose a section" />
          </SelectTrigger>
          <SelectContent>
            {(metadata?.sections ?? []).map((section) => (
              <SelectItem key={section.id} value={section.id}>
                {section.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case 'UPDATE_STATUS':
      return (
        <Select
          value={(configuration['status'] as string) ?? ''}
          onValueChange={(status) => onChange({ status })}
        >
          <SelectTrigger className="w-44" aria-label={`${label} status`}>
            <SelectValue placeholder="Choose a status" />
          </SelectTrigger>
          <SelectContent>
            {['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE', 'CANCELLED'].map(
              (status) => (
                <SelectItem key={status} value={status}>
                  {status.replace(/_/g, ' ').toLowerCase()}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      );

    case 'UPDATE_PRIORITY':
      return (
        <Select
          value={(configuration['priority'] as string) ?? ''}
          onValueChange={(priority) => onChange({ priority })}
        >
          <SelectTrigger className="w-44" aria-label={`${label} priority`}>
            <SelectValue placeholder="Choose a priority" />
          </SelectTrigger>
          <SelectContent>
            {['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((priority) => (
              <SelectItem key={priority} value={priority}>
                {priority.toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case 'SET_DUE_DATE':
      return (
        <Input
          type="number"
          min={0}
          value={String(configuration['daysFromNow'] ?? '')}
          onChange={(event) => onChange({ daysFromNow: Number(event.target.value) })}
          // Relative, not absolute: "due in three days" stays meaningful where a
          // fixed date written into a rule is stale the week after.
          placeholder="Days from now"
          aria-label={`${label} days from now`}
          className="w-44"
        />
      );

    case 'ADD_COMMENT':
      return (
        <Input
          value={String(configuration['body'] ?? '')}
          onChange={(event) => onChange({ body: event.target.value })}
          placeholder="Comment text"
          aria-label={`${label} comment`}
          className={cn('w-64')}
        />
      );

    default:
      // Actions that need nothing — unassign, clear the due date.
      return null;
  }
}
