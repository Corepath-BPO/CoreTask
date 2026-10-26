import { WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import { ArrowLeft, ArrowRightToLine, ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAutomations } from '@/features/automations/hooks/use-automations';
import { usePanelFocus } from '@/lib/hooks/use-panel-focus';
import { cn } from '@/lib/utils';

import { useBundles } from '../../hooks/use-bundles';
import { useProjectForms } from '../../hooks/use-forms';
import { useProjectApps } from '../../hooks/use-project-apps';
import { useProjectEmail } from '../../hooks/use-project-email';
import { useFieldMetadata } from '../../hooks/use-project-views';
import { useStatusTemplates } from '../../hooks/use-status-templates';
import { useTaskTemplates } from '../../hooks/use-task-templates';

import { CustomizeAppsSection } from './customize-apps-section';
import { CustomizeBundlesSection } from './customize-bundles-section';
import { CustomizeEmailsSection } from './customize-emails-section';
import { CustomizeFieldsSection } from './customize-fields-section';
import { CustomizeFormsSection } from './customize-forms-section';
import {
  CUSTOMIZE_GROUPS,
  type CustomizeCounts,
  type CustomizeRowDescriptor,
  type CustomizeRowId,
} from './customize-rows';
import { CustomizeRulesSection } from './customize-rules-section';
import { CustomizeStatusTemplatesSection } from './customize-status-templates-section';
import { CustomizeTemplatesSection } from './customize-templates-section';

const ROW_LABEL: Record<CustomizeRowId, string> = Object.fromEntries(
  CUSTOMIZE_GROUPS.flatMap((group) => group.rows.map((row) => [row.id, row.label])),
) as Record<CustomizeRowId, string>;

/**
 * Asana's Customize panel: what this project asks of its tasks, in one place.
 *
 * The same non-modal slide-over the task detail uses — always mounted, hidden
 * behind `inert`, the view behind it stays live. Narrower than the task panel
 * on purpose: this is a settings rail, not an editor. Open state lives in
 * `?customize=` on the project route, so it survives a tab switch and a reload,
 * and Back puts it away.
 *
 * The rows are a table of contents, and every one opens its section in place.
 * A row whose feature does not exist yet would say so with a "Soon" badge
 * rather than pad the panel with a door to nowhere; today none is left.
 */
export function CustomizePanel({
  workspaceId,
  projectId,
  role,
  open,
  onClose,
}: {
  workspaceId: string | undefined;
  projectId: string;
  role: WorkspaceRole;
  open: boolean;
  onClose: () => void;
}) {
  const [activeSection, setActiveSection] = useState<CustomizeRowId | null>(null);

  /*
   * A fresh open starts at the table of contents. Reset on the open edge, not
   * the close, so the slide-out never empties mid-animation — the same
   * render-adjust pattern as the task panel's `lastId`.
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setActiveSection(null);
  }

  // The panel is not modal, but Escape should still put it away — unless a
  // control inside already answered it (see the task panel's version).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const asideRef = useRef<HTMLElement>(null);
  usePanelFocus(asideRef, open);

  const [scrolled, setScrolled] = useState(false);

  /* Fetched only while open, and both are usually already cached — the board
     fetches the metadata, the Automations tab the rules. */
  const metadataQuery = useFieldMetadata(open ? workspaceId : undefined, projectId);
  const rulesQuery = useAutomations(open ? workspaceId : undefined, projectId);
  // Forms are an editor's tool; nobody else is shown them, so nobody else asks.
  const formsQuery = useProjectForms(
    open && hasAtLeastRole(role, WorkspaceRole.MEMBER) ? workspaceId : undefined,
    projectId,
  );
  const emailQuery = useProjectEmail(
    open && hasAtLeastRole(role, WorkspaceRole.MEMBER) ? workspaceId : undefined,
    projectId,
  );
  const appsQuery = useProjectApps(
    open && hasAtLeastRole(role, WorkspaceRole.MEMBER) ? workspaceId : undefined,
    projectId,
  );
  const templatesQuery = useTaskTemplates(open ? workspaceId : undefined, projectId);
  const statusTemplatesQuery = useStatusTemplates(open ? workspaceId : undefined, projectId);
  const bundlesQuery = useBundles(open ? workspaceId : undefined);
  const bundlesHere = bundlesQuery.data?.filter((bundle) =>
    bundle.projects.some((link) => link.id === projectId),
  );

  const activeFields = (metadataQuery.data?.customFields ?? []).filter(
    (field) => !field.isArchived,
  );
  const counts: CustomizeCounts = {
    ...(rulesQuery.data ? { rules: rulesQuery.data.length } : {}),
    ...(metadataQuery.data ? { fields: activeFields.length } : {}),
    ...(formsQuery.data ? { forms: formsQuery.data.length } : {}),
    ...(emailQuery.data ? { emails: emailQuery.data.receivedCount } : {}),
    ...(appsQuery.data ? { apps: appsQuery.data.length } : {}),
    ...(templatesQuery.data ? { 'task-templates': templatesQuery.data.length } : {}),
    ...(statusTemplatesQuery.data ? { 'status-templates': statusTemplatesQuery.data.length } : {}),
    ...(bundlesHere ? { bundles: bundlesHere.length } : {}),
  };

  const canEdit = hasAtLeastRole(role, WorkspaceRole.MEMBER);
  const canManage = hasAtLeastRole(role, WorkspaceRole.MANAGER);

  return (
    <aside
      ref={asideRef}
      tabIndex={-1}
      aria-label="Customize project"
      inert={!open}
      className={cn(
        'fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l bg-card shadow-xl outline-none transition-transform',
        // Decelerate into place; leave quicker than arriving. The global
        // reduced-motion kill-switch already flattens these transitions.
        open ? 'translate-x-0 duration-300 ease-out' : 'translate-x-full duration-200 ease-in',
      )}
    >
      <div
        className={cn(
          'flex shrink-0 items-center gap-2 border-b px-4 py-2.5 transition-[border-color,box-shadow]',
          scrolled ? 'shadow-[0_1px_3px_rgba(0,0,0,0.08)]' : 'border-transparent',
        )}
      >
        {activeSection !== null && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to customize"
            onClick={() => setActiveSection(null)}
          >
            <ArrowLeft />
          </Button>
        )}
        <h2 className="text-base font-semibold">
          {activeSection === null ? 'Customize' : ROW_LABEL[activeSection]}
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close customize panel"
          className="ml-auto"
          onClick={onClose}
        >
          <ArrowRightToLine />
        </Button>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
      >
        {activeSection === null && (
          <>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">This project</h3>
                <p className="text-xs text-muted-foreground">
                  View and edit features on this project
                </p>
              </div>
              {/* Asana's Add: every feature in one menu, each opening its own
                  section to set one up. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="shrink-0">
                    Add
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {CUSTOMIZE_GROUPS.flatMap((group) => group.rows)
                    .filter((row) => row.built)
                    .map((row) => (
                      <DropdownMenuItem key={row.id} onSelect={() => setActiveSection(row.id)}>
                        <row.icon />
                        {row.label}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {CUSTOMIZE_GROUPS.map((group) => (
              <section key={group.id} aria-label={group.label}>
                <h4 className="mb-1.5 mt-4 text-xs font-medium text-muted-foreground">
                  {group.label}
                </h4>
                <div className="space-y-2">
                  {group.rows.map((row) => (
                    <CustomizeRow
                      key={row.id}
                      row={row}
                      count={counts[row.id]}
                      onSelect={row.built ? setActiveSection : undefined}
                    />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}

        {activeSection === 'rules' && (
          <CustomizeRulesSection
            workspaceId={workspaceId}
            projectId={projectId}
            rules={rulesQuery.data}
            isLoading={rulesQuery.isLoading}
            canManage={canManage}
          />
        )}

        {activeSection === 'forms' && (
          <CustomizeFormsSection
            workspaceId={workspaceId}
            projectId={projectId}
            canEdit={canEdit}
          />
        )}

        {activeSection === 'emails' && (
          <CustomizeEmailsSection
            workspaceId={workspaceId}
            projectId={projectId}
            canEdit={canEdit}
          />
        )}

        {activeSection === 'apps' && (
          <CustomizeAppsSection workspaceId={workspaceId} projectId={projectId} canEdit={canEdit} />
        )}

        {activeSection === 'task-templates' && (
          <CustomizeTemplatesSection
            workspaceId={workspaceId}
            projectId={projectId}
            canEdit={canEdit}
          />
        )}

        {activeSection === 'bundles' && (
          <CustomizeBundlesSection
            workspaceId={workspaceId}
            projectId={projectId}
            canManage={canManage}
            partCounts={{
              ...(metadataQuery.data ? { SECTIONS: metadataQuery.data.sections.length } : {}),
              ...(metadataQuery.data ? { FIELDS: activeFields.length } : {}),
              ...(rulesQuery.data ? { RULES: rulesQuery.data.length } : {}),
              ...(templatesQuery.data ? { TASK_TEMPLATES: templatesQuery.data.length } : {}),
            }}
          />
        )}

        {activeSection === 'status-templates' && (
          <CustomizeStatusTemplatesSection
            workspaceId={workspaceId}
            projectId={projectId}
            canEdit={canEdit}
          />
        )}

        {activeSection === 'fields' && (
          <CustomizeFieldsSection
            workspaceId={workspaceId}
            projectId={projectId}
            metadata={metadataQuery.data}
            isLoading={metadataQuery.isLoading}
            canEdit={canEdit}
          />
        )}
      </div>
    </aside>
  );
}

/**
 * One entry in the table of contents. Without `onSelect` the row is display
 * only — which is also how an unbuilt feature renders, with the tabs' "Soon"
 * badge saying why.
 */
function CustomizeRow({
  row,
  count,
  onSelect,
}: {
  row: CustomizeRowDescriptor;
  count?: number | undefined;
  onSelect?: ((id: CustomizeRowId) => void) | undefined;
}) {
  const disabled = onSelect === undefined;

  return (
    <button
      type="button"
      disabled={disabled}
      title={row.built ? undefined : `${row.label} are not built yet`}
      onClick={() => onSelect?.(row.id)}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md border p-3 text-left text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
        disabled ? 'cursor-default' : 'cursor-pointer hover:bg-muted/50',
      )}
    >
      <row.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="font-medium">{row.label}</span>
      {!row.built && (
        <Badge variant="muted" className="text-[10px]">
          Soon
        </Badge>
      )}
      <span className="ml-auto flex items-center gap-1.5">
        {count !== undefined && (
          <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
        )}
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
      </span>
    </button>
  );
}
