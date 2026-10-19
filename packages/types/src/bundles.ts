import type { BundlePart } from '@coretask/contracts';

/** A bundle as Customize › Bundles lists it. */
export interface Bundle {
  id: string;
  name: string;
  description: string | null;
  /** The project it is made from and refreshed from; null once that is gone or hidden. */
  sourceProject: { id: string; name: string } | null;
  version: number;
  sections: string[];
  fields: { id: string; name: string }[];
  rules: { name: string; live: boolean }[];
  taskTemplates: { name: string }[];
  /** The projects it is applied to that the reader can see, and the version each took. */
  projects: { id: string; name: string; appliedVersion: number }[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateBundlePayload {
  name: string;
  description?: string | null;
  sourceProjectId: string;
  /** What to carry; all four when left out. */
  parts?: BundlePart[];
}

/** What applying a bundle to one project did. */
export interface BundleApplyResult {
  projectId: string;
  sectionsAdded: number;
  fieldsAdded: number;
  rulesWritten: number;
  rulesLive: number;
  /** Rules that were live in the source but need an answer here before they can run. */
  rulesNeedingAttention: string[];
  templatesWritten: number;
}

/** A refresh: the new version, and what happened in each project it reached. */
export interface BundleRefreshResult {
  version: number;
  applied: BundleApplyResult[];
  /** Projects the refresher may not manage; they stay on their version until someone syncs. */
  skipped: number;
}
