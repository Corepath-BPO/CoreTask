import {
  Blocks,
  CircleDot,
  ClipboardList,
  LayoutTemplate,
  Mail,
  Package,
  SlidersHorizontal,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export type CustomizeRowId =
  | 'rules'
  | 'fields'
  | 'forms'
  | 'emails'
  | 'apps'
  | 'task-templates'
  | 'bundles'
  | 'status-templates';

export interface CustomizeRowDescriptor {
  id: CustomizeRowId;
  label: string;
  icon: LucideIcon;
  /**
   * False while the feature behind the row does not exist at all — the row
   * renders disabled with a "Soon" badge, the same honesty the view tabs use.
   * A built row can still be inert if no section view answers it yet.
   */
  built: boolean;
}

export interface CustomizeGroupDescriptor {
  id: 'ai-studio' | 'workflow';
  label: string;
  rows: CustomizeRowDescriptor[];
}

/** Live numbers merged over the static descriptors by the panel. */
export type CustomizeCounts = Partial<Record<CustomizeRowId, number>>;

/** The panel's table of contents, grouped and ordered as Asana draws it. */
export const CUSTOMIZE_GROUPS: CustomizeGroupDescriptor[] = [
  {
    id: 'ai-studio',
    label: 'AI Studio',
    rows: [{ id: 'rules', label: 'Rules', icon: Zap, built: true }],
  },
  {
    id: 'workflow',
    label: 'Workflow features',
    rows: [
      { id: 'fields', label: 'Fields', icon: SlidersHorizontal, built: true },
      { id: 'forms', label: 'Forms', icon: ClipboardList, built: false },
      { id: 'emails', label: 'Emails', icon: Mail, built: false },
      { id: 'apps', label: 'Apps', icon: Blocks, built: false },
      { id: 'task-templates', label: 'Task types and templates', icon: LayoutTemplate, built: false },
      { id: 'bundles', label: 'Bundles', icon: Package, built: false },
      { id: 'status-templates', label: 'Status templates', icon: CircleDot, built: false },
    ],
  },
];
