import { AutomationRuleStatus } from '@coretask/contracts';
import type { AutomationGraphNode, AutomationRuleGraph } from '@coretask/types';
import { deriveEdges, validateGraphStructure } from '@coretask/validation';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, GitBranch, Loader2, Plus, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';

import { useCreateRule, usePublishRule } from '../../hooks/use-automations';
import {
  useAutomationGraph,
  useAutomationMetadata,
  useSaveGraph,
} from '../hooks/use-automation-graph';

import { NodeConfigurationSheet } from '../configuration/node-configuration-sheet';
import {
  adoptChildren,
  applyEdits,
  hasEdits,
  makeBranch,
  makeNodeUnder,
  makeTrigger,
  NO_EDITS,
  readPlaceholderId,
  withPlaceholder,
  type CanvasNode,
  type GraphEdits,
} from '../lib/graph-edits';
import { StepSelector } from '../selectors/step-selector';

import { AutomationCanvas } from './automation-canvas';
import { AutomationValidationBanner } from './automation-validation-banner';

/**
 * The rule a blank canvas starts from.
 *
 * Shaped as a fetched rule so the page has one kind of thing to render, with an
 * id of `''` that is never sent anywhere — `isNew` decides which request goes
 * out, not this value.
 *
 * A section turns the first step into a real question already answered: coming
 * from that section's menu means "when a task lands here" was the whole point of
 * the click, and asking again would be asking somebody to repeat themselves.
 */
function blankRule(projectId: string, sectionId: string | undefined): AutomationRuleGraph {
  const trigger: CanvasNode = sectionId
    ? makeTrigger('TASK_MOVED_TO_SECTION', { sectionId })
    : makeTrigger();

  return {
    id: '',
    projectId,
    name: '',
    description: null,
    status: AutomationRuleStatus.DRAFT,
    version: 0,
    publishedAt: null,
    // The widening is the safe direction: a `CanvasNode` is a stored node plus
    // one type the database has no row for, and this one is a plain trigger.
    graph: { nodes: [trigger as AutomationGraphNode], edges: [] },
    createdAt: '',
    updatedAt: '',
  };
}

const STATUS_TONE: Record<string, 'muted' | 'success' | 'warning' | 'destructive'> = {
  DRAFT: 'muted',
  ACTIVE: 'success',
  PAUSED: 'warning',
  DISABLED: 'muted',
  ARCHIVED: 'muted',
};

/**
 * The rule builder, on its own full-width page.
 *
 * A canvas needs room. The old builder lived inline on the rule list behind a
 * query parameter, which meant the workflow had the width of a settings form
 * and no address of its own — a rule could not be linked to, and Back went to
 * whatever the list was showing.
 */
export function AutomationBuilderPage({
  projectId,
  ruleId,
  sectionId,
  onDirtyChange,
  onClose,
}: {
  projectId: string;
  /** Null while the rule exists only on screen — see `blank` below. */
  ruleId: string | null;
  /** Set when this was started from a section's lightning menu. */
  sectionId?: string;
  /** Reported outward so the wrapper can ask before discarding unsaved work. */
  onDirtyChange?: (dirty: boolean) => void;
  onClose: () => void;
}) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const navigate = useNavigate();

  const { data: fetched, isLoading } = useAutomationGraph(workspaceId, projectId, ruleId);
  const { data: metadata } = useAutomationMetadata(workspaceId, projectId);
  const saveGraph = useSaveGraph(workspaceId, projectId);
  const createRule = useCreateRule(workspaceId, projectId);
  const publishRule = usePublishRule(workspaceId, projectId);

  /*
   * A rule that does not exist yet, held here rather than written first.
   *
   * Creating a row the moment somebody clicks "New rule" would litter the list
   * with untitled drafts every time they changed their mind, so nothing is sent
   * until the first save. The draft is shaped exactly like a fetched rule so
   * everything downstream — the canvas, the edits, the validator — cannot tell
   * the difference and needs no branch of its own.
   *
   * Built once, in the initialiser: recomputing it would throw away whatever
   * had been drawn on it the moment anything else on the page changed.
   */
  const [blank] = useState<AutomationRuleGraph | null>(() =>
    ruleId === null ? blankRule(projectId, sectionId) : null,
  );

  const rule = fetched ?? blank;
  const isNew = ruleId === null;

  const [name, setName] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /*
   * Everything changed but not saved, in one place.
   *
   * Held apart from the server's copy rather than merged into it: cancelling
   * leaves nothing behind, and one save writes the whole canvas. A drag also
   * has to land immediately — waiting for a round trip makes the node spring
   * back under the cursor — and it is not worth a request on its own.
   */
  const [edits, setEdits] = useState<GraphEdits>(NO_EDITS);
  /** Where a chosen action will land: the end of the rule, or one arm of a split. */
  const [addingAt, setAddingAt] = useState<{ parentId: string; arm: string | null } | null>(null);
  /** Whether the trigger list is open — the first thing a new rule needs. */
  const [choosingTrigger, setChoosingTrigger] = useState(false);

  /** Which step's settings are open. Separate from selection: clicking a node
      on the canvas highlights it; opening it is a deliberate second act. */
  const [editingId, setEditingId] = useState<string | null>(null);

  const currentName = name ?? rule?.name ?? '';

  const graph = useMemo(() => {
    if (!rule) return { nodes: [], edges: [] };

    // The placeholder is derived last and never saved: it is the *absence* of
    // an action, and the API refuses the type for exactly that reason.
    const nodes = withPlaceholder(applyEdits(rule.graph.nodes, edits));

    /*
     * Edges are re-derived here rather than taken from the response.
     *
     * The server's list describes the stored rule, which knows nothing about a
     * step added a moment ago or a placeholder that exists only on screen — so
     * using it left every unsaved node floating, connected to nothing. Deriving
     * from the nodes actually being drawn is the only version that can be
     * right, and it is the same function the API uses.
     */
    return { nodes, edges: deriveEdges(nodes) };
  }, [rule, edits]);

  /** What the canvas can actually save — the placeholders are not among them. */
  const realNodes = useMemo(
    () => graph.nodes.filter((node) => node.type !== 'PLACEHOLDER'),
    [graph.nodes],
  );

  const lastNodeId = useMemo(() => {
    const hasChild = new Set(realNodes.map((node) => node.parentId).filter(Boolean));
    return realNodes.filter((node) => !hasChild.has(node.id)).at(-1)?.id ?? null;
  }, [realNodes]);

  const addAction = (subtype: string) => {
    const target = addingAt ?? { parentId: lastNodeId ?? '', arm: null };

    setEdits((previous) => ({
      ...previous,
      added: [
        ...previous.added,
        makeNodeUnder('ACTION', subtype, target.parentId || null, target.arm, realNodes),
      ],
    }));
  };

  const addBranch = () =>
    setEdits((previous) => ({ ...previous, added: [...previous.added, makeBranch(realNodes)] }));

  /*
   * Adding a step in the middle of a rule rather than at the end.
   *
   * Whatever used to follow `parentId` now follows the new step, so the rule
   * gains a stage instead of growing a second tail. `adoptChildren` works out
   * which nodes that is — only the ones on the same arm, so inserting into one
   * side of a split leaves the other side where it was.
   */
  const insertAfter = (type: 'ACTION' | 'BRANCH', parentId: string) => {
    const parent = realNodes.find((node) => node.id === parentId);
    if (!parent) return;

    const inserted =
      type === 'BRANCH'
        ? { ...makeBranch(realNodes), parentId, branchKey: null }
        : makeNodeUnder('ACTION', '', parentId, null, realNodes);

    setEdits((previous) => ({
      ...previous,
      added: [...previous.added, inserted],
      reparented: { ...previous.reparented, ...adoptChildren(inserted, realNodes) },
    }));

    // A step with no action chosen is not a step yet, so the list opens on it.
    if (type === 'ACTION') setAddingAt({ parentId, arm: null });
  };

  const triggerNode = realNodes.find((node) => node.type === 'TRIGGER') ?? null;

  /**
   * Choosing what starts the rule.
   *
   * The settings go with it: a section id means nothing to "when a task is
   * created", and carrying it across would leave a rule configured for a trigger
   * it no longer has. Whoever picks again picks the details again.
   */
  const setTrigger = (subtype: string) => {
    if (!triggerNode) return;

    setEdits((previous) => ({
      ...previous,
      retyped: { ...previous.retyped, [triggerNode.id]: subtype },
      configured: { ...previous.configured, [triggerNode.id]: {} },
    }));

    setEditingId(triggerNode.id);
  };

  /*
   * Checked locally as you type; the server checks again on save and publish.
   *
   * This half is the structural one — a missing name, no action, a step nothing
   * connects to — and it runs from the same function the API calls, so the
   * builder cannot disagree with the endpoint about what is wrong.
   */
  const issues = useMemo(
    () =>
      validateGraphStructure(
        realNodes.map((node) => ({
          id: node.id,
          type: node.type,
          subtype: node.subtype,
          configuration: node.configuration,
          parentId: node.parentId,
          branchKey: node.branchKey,
        })),
        currentName,
      ),
    [realNodes, currentName],
  );

  const blocking = issues.filter((issue) => issue.level === 'ERROR');
  const dirty = name !== null || hasEdits(edits);
  const saving = saveGraph.isPending || createRule.isPending;

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  /*
   * A rule cannot be created without a name — the endpoint requires one, and
   * "Untitled rule" is a name nobody chose that then has to be found again in a
   * list. So the button says why it is off rather than letting the save fail.
   */
  const unnamed = currentName.trim() === '';

  /**
   * Writes the canvas and answers with the rule's real id.
   *
   * Creating and updating differ only in which request is sent — the payload is
   * the same canvas either way — so the callers below do not have to know which
   * happened. Navigation deliberately is not done here: publishing saves first,
   * and moving off the page mid-way would unmount the component before the
   * second request had been sent.
   */
  const persist = async (): Promise<string | null> => {
    if (!rule) return null;

    const nodes = realNodes.map((node) => ({
      id: node.id,
      nodeType: node.type,
      subtype: node.subtype,
      configuration: node.configuration,
      position: node.position,
      parentId: node.parentId,
      branchKey: node.branchKey,
      order: node.order,
    }));

    const saved = isNew
      ? (
          await createRule.mutateAsync({
            name: currentName.trim(),
            // The row's own trigger columns; the server keeps them in step with
            // the trigger node from here on, but a create has to state them.
            triggerType: triggerNode?.subtype ?? '',
            triggerConfig: triggerNode?.configuration ?? {},
            nodes,
          })
        ).id
      : (await saveGraph.mutateAsync({ ruleId: rule.id, name: currentName, nodes }), rule.id);

    setName(null);
    setEdits(NO_EDITS);

    return saved;
  };

  /*
   * `replace`, not a push: a rule that has just been saved is no longer new, and
   * leaving the blank page in the history sends Back to an empty canvas that
   * would create a second rule.
   */
  const goToSaved = (savedId: string) =>
    navigate({
      to: '/projects/$projectId/automations/$ruleId',
      params: { projectId, ruleId: savedId },
      replace: true,
    });

  const saveDraft = async () => {
    const savedId = await persist();
    if (savedId && isNew) await goToSaved(savedId);
  };

  /**
   * Publishing saves first.
   *
   * The endpoint validates what is *stored*, so publishing without saving would
   * check a rule nobody is looking at — and could make live a version different
   * from the one on screen.
   */
  const publish = async () => {
    const savedId = await persist();
    if (!savedId) return;

    await publishRule.mutateAsync(savedId);
    if (isNew) await goToSaved(savedId);
  };

  if (isLoading || !rule) {
    return <Skeleton className="h-[70vh] w-full" />;
  }

  return (
    // `h-full` and `min-h-0`: the canvas below grows into whatever is left, and
    // without the minimum a flex child refuses to shrink past its content.
    <div className="flex h-full min-h-0 w-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="sm" className="cursor-pointer" onClick={onClose}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back
        </Button>

        {/* Editable in place: a rule's name is the one thing everybody changes
            first, and sending them to a settings panel for it is a detour. */}
        <Input
          value={currentName}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name this rule"
          aria-label="Rule name"
          aria-invalid={currentName.trim() === ''}
          className="h-8 w-72 border-transparent bg-transparent px-2 text-base font-semibold hover:border-border focus-visible:border-border"
        />

        <Badge variant={STATUS_TONE[rule.status] ?? 'muted'}>
          {rule.status.charAt(0) + rule.status.slice(1).toLowerCase()}
        </Badge>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer"
            disabled={!dirty || saving || unnamed}
            title={unnamed ? 'Give the rule a name first' : undefined}
            onClick={() => void saveDraft()}
          >
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Save draft
          </Button>

          {/*
            Publish is disabled while anything blocks it, and the banner below
            says what — a disabled button with no explanation is a dead end.
            Wired to the endpoint in M5, once nodes can be configured.
          */}
          <Button
            size="sm"
            className="cursor-pointer"
            disabled={blocking.length > 0 || publishRule.isPending || saving}
            title={blocking.length > 0 ? 'Fix the problems listed above first' : undefined}
            onClick={() => void publish()}
          >
            {publishRule.isPending && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            Publish rule
          </Button>
        </div>
      </header>

      <div className="flex items-center gap-2 px-4 pt-3">
        {/*
          The trigger is picked, never added — every rule has exactly one, and
          it is on the canvas from the moment the page opens. So this changes
          what the existing card says rather than putting a new one beside it,
          which is why it is worded as a choice and not as a "+".
        */}
        <StepSelector
          entries={metadata?.triggers ?? []}
          open={choosingTrigger}
          onOpenChange={setChoosingTrigger}
          onChoose={setTrigger}
          placeholder="Search triggers"
          trigger={
            <Button
              variant={triggerNode?.subtype ? 'outline' : 'default'}
              size="sm"
              className="cursor-pointer"
              onClick={() => setChoosingTrigger(true)}
            >
              <Zap className="size-4" aria-hidden="true" />
              {triggerNode?.subtype ? 'Change trigger' : 'Choose trigger'}
            </Button>
          }
        />

        <StepSelector
          entries={metadata?.actions ?? []}
          open={addingAt !== null}
          onOpenChange={(open) =>
            setAddingAt(open ? (addingAt ?? { parentId: lastNodeId ?? '', arm: null }) : null)
          }
          onChoose={addAction}
          placeholder="Search actions"
          trigger={
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer"
              onClick={() => setAddingAt({ parentId: lastNodeId ?? '', arm: null })}
            >
              <Plus className="size-4" aria-hidden="true" />
              Add action
            </Button>
          }
        />

        {/* A split is added, then filled: both arms appear as placeholders, so
            the choice is visible before either side has anything in it. */}
        <Button
          variant="outline"
          size="sm"
          className="cursor-pointer"
          disabled={!lastNodeId}
          onClick={addBranch}
        >
          <GitBranch className="size-4" aria-hidden="true" />
          Add branch
        </Button>
      </div>

      {/*
        Not on an untouched new rule.
        
        A canvas that opens by announcing "this rule cannot be published yet —
        give it a name, add an action" is telling somebody off for not having
        finished something they have not started. The list is accurate and it is
        the wrong moment. Once they have done anything at all it becomes what it
        is for: the remaining work, in order. Publish stays disabled and says why
        on hover throughout, so nothing is hidden that would let a broken rule
        go live.
      */}
      {(!isNew || dirty) && (
        <div className="px-4">
          <AutomationValidationBanner
            issues={issues}
            onFocusNode={(nodeId) => setSelectedId(nodeId)}
          />
        </div>
      )}

      {/*
        `flex-1`, now that there is a flex line to grow along.

        React Flow measures its container to place nodes and hides every node
        until it has, so a container of indefinite height shows an empty canvas
        rather than a broken one — no error, just nothing. This used to need an
        explicit `100vh` minus a guess at the chrome above it, because the page
        rendered inside a block-level wrapper on the Automations tab. In a
        dialog that fills the screen the column has a real height to divide, so
        the canvas can simply take the remainder — and it is right at every
        window size rather than at the one the guess was tuned for.
      */}
      <div className="min-h-0 w-full flex-1">
        <AutomationCanvas
          graph={graph}
          metadata={metadata}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onOpenNode={(nodeId) => {
            setSelectedId(nodeId);

            /*
             * A placeholder is not a step to configure — it is the invitation
             * to choose one. Its id carries where it sits, so the action lands
             * on the right arm without tracking a separate selection.
             */
            const target = readPlaceholderId(nodeId);

            if (target) {
              setAddingAt(target);
              return;
            }

            /*
             * An unchosen trigger has no settings to show — opening its form
             * would present an empty sheet. The question it is actually asking
             * is which trigger, so that is the list that opens.
             */
            if (nodeId === triggerNode?.id && triggerNode.subtype === '') {
              setChoosingTrigger(true);
              return;
            }

            setEditingId(nodeId);
          }}
          onInsertStep={(parentId) => insertAfter('ACTION', parentId)}
          onInsertBranch={(parentId) => insertAfter('BRANCH', parentId)}
          onMoveNode={(nodeId, position) =>
            setEdits((previous) => ({
              ...previous,
              moved: { ...previous.moved, [nodeId]: position },
            }))
          }
        />
      </div>

      <NodeConfigurationSheet
        node={graph.nodes.find((node) => node.id === editingId) ?? null}
        metadata={metadata}
        onClose={() => setEditingId(null)}
        onSave={(nodeId, configuration) =>
          setEdits((previous) => ({
            ...previous,
            configured: { ...previous.configured, [nodeId]: configuration },
          }))
        }
      />
    </div>
  );
}
