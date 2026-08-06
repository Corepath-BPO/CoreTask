import { validateGraphStructure } from '@coretask/validation';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';

import {
  useAutomationGraph,
  useAutomationMetadata,
  useSaveGraph,
} from '../hooks/use-automation-graph';

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

  const [name, setName] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /*
   * Local positions, applied over the server's.
   *
   * A drag has to land immediately — waiting for a round trip makes the node
   * spring back under the cursor — and it is not worth a save on its own. They
   * are folded into the graph here and written when the draft is saved.
   */
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({});

  const currentName = name ?? rule?.name ?? '';

  const graph = useMemo(() => {
    if (!rule) return { nodes: [], edges: [] };

    return {
      ...rule.graph,
      nodes: rule.graph.nodes.map((node) => ({
        ...node,
        position: moved[node.id] ?? node.position,
      })),
    };
  }, [rule, moved]);

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
        graph.nodes.map((node) => ({
          id: node.id,
          type: node.type,
          subtype: node.subtype,
          configuration: node.configuration,
          parentId: node.parentId,
          branchKey: node.branchKey,
        })),
        currentName,
      ),
    [graph.nodes, currentName],
  );

  const blocking = issues.filter((issue) => issue.level === 'ERROR');
  const dirty = name !== null || Object.keys(moved).length > 0;

  const saveDraft = async () => {
    if (!rule) return;

    await saveGraph.mutateAsync({
      ruleId: rule.id,
      name: currentName,
      nodes: graph.nodes.map((node) => ({
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
    setMoved({});
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
            disabled={blocking.length > 0}
            title={blocking.length > 0 ? 'Fix the problems listed above first' : undefined}
          >
            Publish rule
          </Button>
        </div>
      </header>

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
          onOpenNode={setSelectedId}
          onMoveNode={(nodeId, position) =>
            setMoved((previous) => ({ ...previous, [nodeId]: position }))
          }
        />
      </div>
    </div>
  );
}
