/** A link the whole project should have to hand — Asana's "Key resources". */
export interface ProjectResource {
  id: string;
  title: string;
  url: string;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
}

export interface AddProjectResourcePayload {
  title: string;
  url: string;
}
