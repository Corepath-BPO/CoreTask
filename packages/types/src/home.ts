import type { HomeWidget } from '@coretask/contracts';

/** One person's Home in one workspace. */
export interface HomeLayout {
  /** Shown, in order. */
  widgets: HomeWidget[];
  /** The private notepad's text; only its owner reads it. */
  notepad: string;
  /** False until they first change anything — the defaults are showing. */
  customized: boolean;
}

export interface UpdateHomeLayoutPayload {
  widgets?: HomeWidget[];
  notepad?: string;
}
