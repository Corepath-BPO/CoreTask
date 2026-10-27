/**
 * The parts of Asana's API objects the importer asks for.
 *
 * Asana returns only the fields named in `opt_fields`, so every property is
 * optional here: a field missing from a response is a field nobody asked for,
 * or one Asana leaves out for that object.
 */

export interface AsanaRef {
  gid: string;
  name?: string;
  resource_type?: string;
}

export interface AsanaWorkspace extends AsanaRef {
  is_organization?: boolean;
  email_domains?: string[];
}

export interface AsanaUser extends AsanaRef {
  email?: string | null;
}

export interface AsanaWorkspaceMembership {
  gid: string;
  user?: AsanaUser;
  is_admin?: boolean;
  is_guest?: boolean;
  is_active?: boolean;
}

export interface AsanaTeam extends AsanaRef {
  description?: string | null;
}

export interface AsanaEnumOption extends AsanaRef {
  color?: string | null;
  enabled?: boolean;
}

/** `resource_subtype`: text, number, enum, multi_enum, date, people, reference, formula… */
export interface AsanaCustomField extends AsanaRef {
  resource_subtype?: string;
  description?: string | null;
  precision?: number | null;
  /** number fields: none, percentage, currency, custom, duration, identifier. */
  format?: string | null;
  currency_code?: string | null;
  custom_label?: string | null;
  custom_label_position?: 'prefix' | 'suffix' | null;
  enum_options?: AsanaEnumOption[];
}

/** One field's value on one task, as `custom_fields` on a task carries it. */
export interface AsanaCustomFieldValue extends AsanaCustomField {
  text_value?: string | null;
  number_value?: number | null;
  enum_value?: AsanaEnumOption | null;
  multi_enum_values?: AsanaEnumOption[];
  date_value?: { date?: string | null; date_time?: string | null } | null;
  people_value?: AsanaUser[];
  display_value?: string | null;
}

export interface AsanaCustomFieldSetting {
  gid: string;
  custom_field?: AsanaCustomField;
  is_important?: boolean;
}

export interface AsanaProject extends AsanaRef {
  archived?: boolean;
  color?: string | null;
  notes?: string;
  html_notes?: string;
  owner?: AsanaUser | null;
  team?: AsanaTeam | null;
  privacy_setting?: string;
  start_on?: string | null;
  due_on?: string | null;
  due_date?: string | null;
  completed?: boolean;
  completed_at?: string | null;
  created_at?: string;
}

export interface AsanaMembership {
  gid: string;
  member?: AsanaUser;
  /** admin, editor, commenter, viewer. */
  access_level?: string;
}

export interface AsanaSection extends AsanaRef {}

export interface AsanaStatusUpdate {
  gid: string;
  /** on_track, at_risk, off_track, on_hold, complete, achieved, partial, missed, dropped. */
  status_type?: string;
  title?: string;
  text?: string;
  created_at?: string;
  author?: AsanaUser | null;
}

export interface AsanaTaskMembership {
  project?: AsanaRef;
  section?: AsanaRef | null;
}

export interface AsanaTask extends AsanaRef {
  /** default_task, milestone, approval. */
  resource_subtype?: string;
  html_notes?: string;
  completed?: boolean;
  completed_at?: string | null;
  assignee?: AsanaUser | null;
  due_on?: string | null;
  due_at?: string | null;
  start_on?: string | null;
  start_at?: string | null;
  created_at?: string;
  created_by?: AsanaRef | null;
  /** pending, approved, rejected, changes_requested. */
  approval_status?: string | null;
  num_subtasks?: number;
  parent?: AsanaRef | null;
  memberships?: AsanaTaskMembership[];
  tags?: AsanaRef[];
  followers?: AsanaRef[];
  likes?: { user?: AsanaRef }[];
  dependencies?: AsanaRef[];
  custom_fields?: AsanaCustomFieldValue[];
  custom_type?: AsanaRef | null;
  actual_time_minutes?: number | null;
}

export interface AsanaStory {
  gid: string;
  /** comment_added, attachment_added, assigned, marked_complete… */
  resource_subtype?: string;
  type?: 'comment' | 'system';
  text?: string;
  html_text?: string;
  created_at?: string;
  created_by?: AsanaUser | null;
  is_pinned?: boolean;
  likes?: { user?: AsanaRef }[];
}

export interface AsanaAttachment extends AsanaRef {
  /** asana, dropbox, gdrive, onedrive, box, vimeo, external. */
  host?: string;
  size?: number | null;
  download_url?: string | null;
  view_url?: string | null;
  permanent_url?: string | null;
  created_at?: string;
}

export interface AsanaPortfolio extends AsanaRef {
  color?: string | null;
  owner?: AsanaUser | null;
}
