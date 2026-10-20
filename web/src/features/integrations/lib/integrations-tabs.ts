/** The tabs of Integrations, in order. */
export interface IntegrationsTab {
  label: string;
  segment: string;
  /** The workspace's, for its admins; the rest are each person's own. */
  adminOnly?: boolean;
  /** Routed and honest about being unbuilt, rather than a fake working screen. */
  comingSoon?: boolean;
}

export const INTEGRATIONS_TABS: IntegrationsTab[] = [
  { label: 'API keys', segment: 'api-keys', adminOnly: true },
  { label: 'Webhooks', segment: 'webhooks', adminOnly: true },
  { label: 'Playground', segment: 'playground', adminOnly: true },
  { label: 'App directory', segment: 'app-directory' },
  { label: 'OAuth apps', segment: 'oauth-apps' },
  { label: 'Connected apps', segment: 'connected-apps' },
  // Everyone links their own account; connecting the workspace is gated inside.
  { label: 'Slack', segment: 'slack' },
];
