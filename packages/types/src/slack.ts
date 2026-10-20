/** Integrations › Slack, for whoever is looking. */
export interface SlackStatus {
  /** Whether this server has a Slack app's credentials at all. */
  configured: boolean;
  installation: SlackInstallationSummary | null;
  /** The viewer's own link, when the workspace has Slack. */
  me: { linked: boolean; slackUserId: string | null };
  /** Whether the viewer may install or disconnect it. */
  canManage: boolean;
}

export interface SlackInstallationSummary {
  teamId: string;
  teamName: string;
  installedBy: { id: string; name: string } | null;
  installedAt: string;
  /** People here who have linked their Slack account. */
  linkedPeople: number;
}

/** Where the browser goes to approve the app in Slack. */
export interface SlackInstallUrl {
  url: string;
}

export interface CompleteSlackInstallPayload {
  code: string;
  state: string;
}

export interface SlackInstallResult {
  workspaceId: string;
  teamName: string;
}

export interface SlackLinkPayload {
  token: string;
}

/** What the link page says before the person agrees. */
export interface SlackLinkPreview {
  workspaceId: string;
  workspaceName: string;
  teamName: string;
  /** Someone in CoreTask this Slack account is already linked to, when it is. */
  linkedTo: { id: string; name: string } | null;
}

export interface SlackLinkResult {
  workspaceId: string;
  teamName: string;
}

/** A channel the bot can post to, for the picker. */
export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
}
