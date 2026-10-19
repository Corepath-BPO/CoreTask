/** A project's Note: one document, and who last changed it. */
export interface ProjectNote {
  /** Sanitised rich text; empty when nobody has written anything. */
  body: string;
  updatedBy: { id: string; name: string } | null;
  updatedAt: string | null;
}

export interface SaveProjectNotePayload {
  body: string;
}
