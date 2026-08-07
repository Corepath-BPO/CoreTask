import { AutomationRuleStatus, type AutomationNodeType } from '@coretask/contracts';
import type {
  AutomationCatalogEntry,
  AutomationGraphNode,
  AutomationRuleGraph,
} from '@coretask/types';
import { deriveEdges, validateGraphStructure } from '@coretask/validation';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { useProject } from '@/features/projects/hooks/use-projects';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';

import { useCreateRule, usePublishRule } from '../../hooks/use-automations';
import {
  useAutomationGraph,
  useAutomationMetadata,
  useSaveGraph,
} from '../hooks/use-automation-graph';

import { NodeConfigRail, type RailMode } from '../configuration/node-config-rail';
import type { RuleSettings } from '../configuration/rule-settings-panel';
import {
  adoptChildren,
  applyEdits,
  branchRows,
  copyBranchRow,
  fallbackRow,
  FALLBACK_CONFIGURATION,
  hasEdits,
  makeBranchRow,
  makeDefaultNodes,
  makeNodeUnder,
  NO_EDITS,
  readPlaceholderId,
  withDescendants,
  withPlaceholder,
  type CanvasNode,
  type GraphEdits,
} from '../lib/graph-edits';

import { AutomationBuilderHeader, type SaveState } from './automation-builder-header';
import { AutomationCanvas } from './automation-canvas';

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
  const nodes = makeDefaultNodes(sectionId);

  return {
    id: '',
    projectId,
    name: '',
    description: null,
    status: AutomationRuleStatus.DRAFT,
    version: 0,
    // Chaining allowed by default, matching the column: a new rule behaves the
    // same way every existing one does until somebody says otherwise.
    allowChaining: true,
    // Nobody owns it yet — the panel says so rather than showing a blank row.
    createdBy: null,
    publishedAt: null,
    // The widening is the safe direction: a `CanvasNode` is a stored node plus
    // one type the database has no row for, and this one is a plain trigger.
    graph: { nodes: nodes as AutomationGraphNode[], edges: [] },
    createdAt: '',
    updatedAt: '',
  };
}

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
  /* The same query the project pages use, so the name in the header comes from
     the cache they have already filled rather than from a request of its own. */
  const { data: project } = useProject(workspaceId, projectId);
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

  /*
   * The rule's own settings, overlaid on the stored ones.
   *
   * The same shape as the node edits below and for the same reason: what
   * somebody typed lives apart from what was saved, so closing without saving
   * leaves nothing behind. Only the keys they touched are here, so a field they
   * never opened cannot be written back as an empty string.
   */
  const [settingsEdits, setSettingsEdits] = useState<Partial<RuleSettings>>({});
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
  const [addingAt, setAddingAt] = useState<{
    parentId: string;
    arm: string | null;
    /** Whether what already follows the parent should move after the new step. */
    insert?: boolean;
  } | null>(null);

  /*
   * What the rail is showing.
   *
   * One piece of state rather than three booleans, because the panel can only
   * ever be doing one of these things and separate flags made states that
   * cannot exist representable — a trigger list open behind an action form.
   */
  const [rail, setRail] = useState<RailMode>({ kind: 'closed' });

  /*
   * A name for a rule started from a section.
   *
   * Derived rather than written into state: the section's *name* is not in the
   * URL — only its id — so there is nothing to suggest until the metadata that
   * resolves ids to names arrives, and an effect that filled the field in
   * afterwards could land on top of what somebody had already typed.
   *
   * Only with a section to name it after. "Untitled rule" is a name nobody
   * chose, which then has to be found again in a list, so an empty field that
   * asks is the better default.
   */
  const suggestedName =
    isNew && sectionId
      ? (metadata?.sections.find((entry) => entry.id === sectionId)?.name ?? '')
      : '';

  const settings: RuleSettings = {
    /*
     * `||` on the stored name, not `??`.
     *
     * A blank rule carries `''`, which is not nullish, so `??` stopped there and
     * the suggestion below was never reached. A saved rule cannot have an empty
     * name — the endpoint requires one — so falling through on empty only ever
     * affects the rule that has not been saved yet.
     */
    name:
      settingsEdits.name ?? (rule?.name || (suggestedName ? `When moved to ${suggestedName}` : '')),
    description: settingsEdits.description ?? rule?.description ?? '',
    allowChaining: settingsEdits.allowChaining ?? rule?.allowChaining ?? true,
  };

  const currentName = settings.name;

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

  /** Answers with the step it added, so the caller can go on to set it up. */
  const addAction = (subtype: string, configuration: Record<string, unknown> = {}): CanvasNode => {
    const target = addingAt ?? { parentId: lastNodeId ?? '', arm: null };
    const node = {
      ...makeNodeUnder('ACTION', subtype, target.parentId || null, target.arm, realNodes),
      configuration,
    };

    setEdits((previous) => ({
      ...previous,
      added: [...previous.added, node],
      /*
       * Inserting is decided here rather than when the picker opened.
       *
       * Creating the step first and asking afterwards left a blank card behind
       * whenever somebody closed the list without choosing — a step that is
       * nothing, which forks the rule and refuses to publish. A step nobody has
       * chosen is not a step, so now nothing exists until one is.
       */
      ...(target.insert
        ? { reparented: { ...previous.reparented, ...adoptChildren(node, realNodes) } }
        : {}),
    }));

    return node;
  };

  /** Whether this step is one of the rule's branches rather than a step on one. */
  const isBranchRow = (nodeId: string) => branchRows(realNodes).some((row) => row.id === nodeId);

  /**
   * A copy of a step, running immediately after the one it came from.
   *
   * After rather than beside it: two steps sharing a parent are two paths from
   * the same point, which is a branch — and duplicating an action is almost
   * always "do that again with one thing changed", not "fork the rule here".
   *
   * Its settings come along. A copy that arrived empty would be a new step with
   * extra steps, and the reason to duplicate is that most of the answers are
   * already right.
   *
   * A branch is the exception, and has to be: it is a question *and* the actions
   * answering it, so the same treatment would hand the copy the original's
   * actions and leave the original with none — see `copyBranchRow`.
   */
  const duplicateNode = (nodeId: string) => {
    const original = realNodes.find((node) => node.id === nodeId);
    if (!original) return;

    if (isBranchRow(nodeId)) {
      const copies = copyBranchRow(realNodes, nodeId);
      const [row] = copies;
      if (!row) return;

      setEdits((previous) => ({ ...previous, added: [...previous.added, ...copies] }));

      setSelectedId(row.id);
      setRail({ kind: 'configure', nodeId: row.id });
      return;
    }

    const copy: CanvasNode = {
      ...makeNodeUnder(
        original.type as AutomationNodeType,
        original.subtype,
        original.id,
        null,
        realNodes,
      ),
      configuration: { ...original.configuration },
    };

    setEdits((previous) => ({
      ...previous,
      added: [...previous.added, copy],
      reparented: { ...previous.reparented, ...adoptChildren(copy, realNodes) },
    }));

    setSelectedId(copy.id);
    setRail({ kind: 'configure', nodeId: copy.id });
  };

  /**
   * Removing a step, and closing the gap it leaves.
   *
   * Whatever followed attaches to whatever came before, so deleting the third of
   * five steps does not take the last two with it.
   *
   * A branch again goes as a piece. Its actions exist because of its question,
   * so re-parenting them onto the trigger would turn "assign Maya when the
   * priority is high" into "assign Maya" — a rule nobody wrote, arrived at by
   * removing something. Deciding it here rather than in each control means every
   * route to it agrees: the × on the card, the connector's menu, the panel.
   */
  const deleteNode = (nodeId: string) => {
    const removed = isBranchRow(nodeId) ? withDescendants(realNodes, nodeId) : [nodeId];

    setEdits((previous) => ({ ...previous, removed: [...previous.removed, ...removed] }));
    setRail((previous) =>
      previous.kind === 'configure' && removed.includes(previous.nodeId)
        ? { kind: 'closed' }
        : previous,
    );
  };

  /**
   * The fallback: what runs when nothing else matched.
   *
   * A row like any other — a condition hanging off the trigger — marked as the
   * one with no question. That mark is the whole difference: the runner takes
   * the first row whose condition holds and this one always does, so it needs no
   * comparison and the canvas must not ask for one.
   *
   * So this opens the action list straight away, where "Otherwise if…" opens the
   * condition form. That is exactly the distinction the two words draw: one adds
   * another question, the other adds the answer for when none of them held.
   */
  const addOtherwise = () => {
    if (!triggerNode) return;

    const inserted = makeBranchRow(realNodes, triggerNode.id, FALLBACK_CONFIGURATION);

    setEdits((previous) => ({ ...previous, added: [...previous.added, inserted] }));

    // Straight to the actions, because that is the whole of what somebody
    // chose — there is no question to answer first.
    openActionPicker({ parentId: inserted.id, arm: null });
  };

  /**
   * Another question, on its own row under the trigger.
   *
   * A sibling of the rows already there rather than something nested inside the
   * last one. Nesting is what made an else-if a split with two arms — a "Split
   * on" card carrying placeholders for paths nobody asked for — where what
   * somebody wants is one more line: a question, and what to do when it holds.
   *
   * The runner reads the siblings in order and takes the first that holds, which
   * is what makes a list of these behave like the if/else-if chain it reads as.
   */
  const addElseIf = () => {
    if (!triggerNode) return;

    const inserted = makeBranchRow(realNodes, triggerNode.id);

    setEdits((previous) => ({ ...previous, added: [...previous.added, inserted] }));

    // Straight into its condition: an unanswered question is not a step yet.
    setSelectedId(inserted.id);
    setRail({ kind: 'configure', nodeId: inserted.id });
  };

  /*
   * Adding a step in the middle of a rule rather than at the end.
   *
   * Whatever used to follow `parentId` now follows the new step, so the rule
   * gains a stage instead of growing a second tail. `adoptChildren` works out
   * which nodes that is — only the ones on the same arm, so inserting into one
   * side of a split leaves the other side where it was.
   *
   * Nothing exists until the action is chosen. Creating the step first left a
   * blank card behind whenever somebody closed the list without picking — a step
   * that is nothing, which forks the rule and refuses to publish.
   */
  const insertStepAfter = (parentId: string) => {
    const parent = realNodes.find((node) => node.id === parentId);
    if (!parent) return;

    openActionPicker({ parentId, arm: null, insert: true });
  };

  const triggerNode = realNodes.find((node) => node.type === 'TRIGGER') ?? null;

  const openActionPicker = (target: { parentId: string; arm: string | null; insert?: boolean }) => {
    setAddingAt(target);
    setRail({
      kind: 'choose',
      title: 'Do this…',
      description: 'Add an action that happens as a result of the rule.',
      entries: metadata?.actions ?? [],
    });
  };

  const openTriggerPicker = () =>
    setRail({
      kind: 'choose',
      title: 'When this happens…',
      description: 'Choose what starts this rule.',
      entries: metadata?.triggers ?? [],
    });

  /*
   * One list, two meanings, decided by where it was opened from.
   *
   * The rail does not know whether it is offering triggers or actions — it was
   * handed a list of entries. What a chosen one means is a property of the
   * click that opened it, which is exactly what `addingAt` records.
   */
  const chooseFromRail = (entry: AutomationCatalogEntry) => {
    if (!addingAt) {
      setTrigger(entry.subtype);
      return;
    }

    /*
     * Straight on to setting it up.
     *
     * Choosing "add a comment" and being handed a closed panel leaves somebody
     * with a step that says "write what it says" and no obvious way to. The
     * choice and the settings are two halves of one act, so the panel carries
     * on into the second.
     */
    /*
     * A generated row already knows its field, so the form does not ask again.
     *
     * Every "Change ⟨field⟩ to…" shares one subtype and differs only by the
     * field it names — without carrying that across, choosing one landed on a
     * form with an empty field picker, which is the click being thrown away.
     */
    const added = addAction(entry.subtype, entry.fieldId ? { fieldId: entry.fieldId } : {});
    setAddingAt(null);
    setSelectedId(added.id);
    setRail({ kind: 'configure', nodeId: added.id });
  };

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

    setRail({ kind: 'configure', nodeId: triggerNode.id });
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
          // Carried because "the fallback has to come last" is a fact about
          // this number: a rule that reads correctly down the canvas can still
          // have a row ordered after the one that catches everything.
          order: node.order,
        })),
        currentName,
      ),
    [realNodes, currentName],
  );

  const blocking = issues.filter((issue) => issue.level === 'ERROR');
  const dirty = Object.keys(settingsEdits).length > 0 || hasEdits(edits);
  const saving = saveGraph.isPending || createRule.isPending;

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  /*
   * A rule cannot be created without a name — the endpoint requires one, and
   * "Untitled rule" is a name nobody chose that then has to be found again in a
   * list. The validator reports it as a problem of its own, so the count beside
   * Publish says why rather than a save being allowed to fail.
   */
  const unnamed = currentName.trim() === '';

  /*
   * What the header reports about the last write.
   *
   * Derived from the mutations rather than tracked: they already know whether a
   * request is in flight, whether it landed and whether it failed, and a second
   * copy of that in state is a second thing that can disagree with the first.
   *
   * "Saved" needs `!dirty` as well as success — otherwise a rule edited straight
   * after a save would go on claiming to be written while it no longer was.
   *
   * TODO(M8): debounced autosave lands in milestone 8. Nothing here starts a
   * save; this only surfaces the state the existing one already has.
   */
  const saveState: SaveState = saving
    ? 'saving'
    : saveGraph.isError || createRule.isError
      ? 'error'
      : (saveGraph.isSuccess || createRule.isSuccess) && !dirty
        ? 'saved'
        : 'idle';

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
            description: settings.description,
            // The row's own trigger columns; the server keeps them in step with
            // the trigger node from here on, but a create has to state them.
            triggerType: triggerNode?.subtype ?? '',
            triggerConfig: triggerNode?.configuration ?? {},
            nodes,
          })
        ).id
      : (await saveGraph.mutateAsync({
          ruleId: rule.id,
          name: currentName,
          description: settings.description,
          allowChaining: settings.allowChaining,
          nodes,
        }),
        rule.id);

    setSettingsEdits({});
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

  /*
   * Saving lost its button, so it needs a key.
   *
   * Held in a ref rather than closed over by the listener: the handler depends
   * on the whole canvas, so naming it as a dependency would tear down and
   * re-attach a window listener on every keystroke somebody types into a step.
   *
   * TODO(M8): debounced autosave lands in milestone 8, after which this is a
   * shortcut rather than the only way to write a draft.
   */
  const requestSave = useRef<() => void>(() => {});

  useEffect(() => {
    requestSave.current = () => {
      if (!dirty || saving || unnamed) return;
      void saveDraft();
    };
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 's' || !(event.metaKey || event.ctrlKey)) return;

      // Always, even when there is nothing to write: otherwise the browser's own
      // "save this page" dialog opens over the builder.
      event.preventDefault();
      requestSave.current();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (isLoading || !rule) {
    return <Skeleton className="h-[70vh] w-full" />;
  }

  return (
    // `h-full` and `min-h-0`: the canvas below grows into whatever is left, and
    // without the minimum a flex child refuses to shrink past its content.
    <div className="flex h-full min-h-0 w-full flex-col">
      {/*
        One bar, and then the canvas.

        The row of Change trigger / Add action / Add branch that used to sit
        under this is gone: each of those is on the drawing itself, so the row
        was a second route to things somebody was already pointing at, and it
        cost the rule a strip of the only screen it has.
      */}
      <AutomationBuilderHeader
        projectName={project?.name}
        status={rule.status}
        name={currentName}
        onNameChange={(name) => setSettingsEdits((previous) => ({ ...previous, name }))}
        settingsOpen={rail.kind === 'settings'}
        onToggleSettings={() =>
          setRail((previous) =>
            previous.kind === 'settings' ? { kind: 'closed' } : { kind: 'settings' },
          )
        }
        save={saveState}
        issues={issues}
        onFocusIssue={(nodeId) => setSelectedId(nodeId)}
        publishing={publishRule.isPending}
        canPublish={blocking.length === 0 && !saving}
        onPublish={() => void publish()}
        onClose={onClose}
      />

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
      {/* A row: the canvas takes what the rail does not. */}
      <div className="flex min-h-0 w-full flex-1">
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
              openActionPicker(target);
              return;
            }

            /*
             * An unchosen trigger has no settings to show — opening its form
             * would present an empty sheet. The question it is actually asking
             * is which trigger, so that is the list that opens.
             */
            if (nodeId === triggerNode?.id && triggerNode.subtype === '') {
              openTriggerPicker();
              return;
            }

            /*
             * The fallback opens nothing, because there is nothing to set.
             *
             * Its form would be the condition form, which offers to give
             * "otherwise" a comparison — and a fallback with one is a row that
             * is neither the fallback nor a question.
             */
            if (fallbackRow(realNodes)?.id === nodeId) return;

            setRail({ kind: 'configure', nodeId });
          }}
          onAddElseIf={addElseIf}
          onAddOtherwise={addOtherwise}
          onChangeTrigger={openTriggerPicker}
          onDuplicateNode={duplicateNode}
          onDeleteNode={deleteNode}
          onInsertStep={insertStepAfter}
        />

        {/*
          Beside the canvas rather than over it.
          
          A step only makes sense in the shape it sits in, so covering the rule
          to configure one takes away the thing that explains what is being
          edited. The canvas is a flex sibling, so opening the panel narrows the
          drawing rather than hiding part of it.
        */}
        <NodeConfigRail
          mode={rail}
          nodes={graph.nodes}
          metadata={metadata}
          onClose={() => {
            setRail({ kind: 'closed' });
            setAddingAt(null);
          }}
          onChange={(nodeId, configuration) =>
            setEdits((previous) => ({
              ...previous,
              configured: { ...previous.configured, [nodeId]: configuration },
            }))
          }
          onDelete={deleteNode}
          onChoose={chooseFromRail}
          rule={rule}
          settings={settings}
          onSettingsChange={(next) => setSettingsEdits((previous) => ({ ...previous, ...next }))}
        />
      </div>
    </div>
  );
}
