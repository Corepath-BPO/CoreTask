/** The tabs of the admin console, in Asana's order. */
export interface AdminTab {
  label: string;
  segment: string;
  /** Routed and honest about being unbuilt, rather than a fake working screen. */
  comingSoon?: boolean;
}

export const ADMIN_TABS: AdminTab[] = [
  { label: 'Overview', segment: 'overview' },
  { label: 'Members', segment: 'members' },
  { label: 'Guests', segment: 'guests' },
  { label: 'Teams', segment: 'teams' },
  { label: 'Security', segment: 'security', comingSoon: true },
  { label: 'Apps', segment: 'apps', comingSoon: true },
  { label: 'Insights', segment: 'insights', comingSoon: true },
  { label: 'Audit log', segment: 'audit-log', comingSoon: true },
  { label: 'Export', segment: 'export', comingSoon: true },
  { label: 'Settings', segment: 'settings', comingSoon: true },
];
