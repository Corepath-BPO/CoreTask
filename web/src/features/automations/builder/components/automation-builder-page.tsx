import { deriveEdges, validateGraphStructure } from '@coretask/validation';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, GitBranch, Loader2, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';

import { usePublishRule } from '../../hooks/use-automations';
import {
  useAutomationGraph,
  useAutomationMetadata,
  useSaveGraph,
} from '../hooks/use-automation-graph';

import { NodeConfigurationSheet } from '../configuration/node-configuration-sheet';
import {
  applyEdits,
  hasEdits,
  makeBranch,
  makeNodeUnder,
  NO_EDITS,
  readPlaceholderId,
  withPlaceholder,
  type GraphEdits,
} from '../lib/graph-edits';
import { StepSelector } from '../selectors/step-selector';

import { AutomationCanvas } from './automation-canvas';
import { AutomationValidationBanner } from './automation-validation-banner';

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
}: {
  projectId: string;
  ruleId: string;
}) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const navigate = useNavigate();

  const { data: rule, isLoading } = useAutomationGraph(workspaceId, projectId, ruleId);
  const { data: metadata } = useAutomationMetadata(workspaceId, projectId);
  const saveGraph = useSaveGraph(workspaceId, projectId);
  const publishRule = usePublishRule(workspaceId, projectId);

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

  const saveDraft = async () => {
    if (!rule) return;

    await saveGraph.mutateAsync({
      ruleId: rule.id,
      name: currentName,
      nodes: realNodes.map((node) => ({
        id: node.id,
        nodeType: node.type,
        subtype: node.subtype,
        configuration: node.configuration,
        position: node.position,
        parentId: node.parentId,
        branchKey: node.branchKey,
        order: node.order,
      })),
    });

    setName(null);
    setEdits(NO_EDITS);
  };

  /**
   * Publishing saves first.
   *
   * The endpoint validates what is *stored*, so publishing without saving would
   * check a rule nobody is looking at — and could make live a version different
   * from the one on screen.
   */
  const publish = async () => {
    await saveDraft();
    await publishRule.mutateAsync(ruleId);
  };

  if (isLoading || !rule) {
    return <Skeleton className="h-[70vh] w-full" />;
  }

  return (
    <div className="flex w-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border pb-3">
        <Button
          variant="ghost"
          size="sm"
          className="cursor-pointer"
          onClick={() => void navigate({ to: `/projects/${projectId}/automations` })}
        >
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
            disabled={!dirty || saveGraph.isPending}
            onClick={() => void saveDraft()}
          >
            {saveGraph.isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
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
            disabled={blocking.length > 0 || publishRule.isPending || saveGraph.isPending}
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

      <div className="flex items-center gap-2 pt-3">
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

      <AutomationValidationBanner issues={issues} onFocusNode={(nodeId) => setSelectedId(nodeId)} />

      {/*
        An explicit height, not `flex-1`.
        
        React Flow measures its container to place nodes and hides every node
        until it has, so a container of indefinite height shows an empty canvas
        rather than a broken one — no error, just nothing. `flex-1` would not
        help here: the page sits inside a block-level `space-y-3` wrapper, so
        there is no flex line to grow along and the height would come from
        `min-h` alone. Stating it outright is what makes the behaviour
        predictable.
      */}
      <div className="h-[calc(100vh-22rem)] min-h-[440px] w-full">
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

            setEditingId(nodeId);
          }}
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
