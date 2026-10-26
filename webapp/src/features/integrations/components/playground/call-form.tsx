import { Field } from '@/components/forms/field';
import { fieldAria } from '@/components/forms/field-aria';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useProject, useProjects } from '@/features/projects/hooks/use-projects';

import type {
  PlaygroundCall,
  PlaygroundFieldSpec,
  PlaygroundHandoff,
  PlaygroundValues,
} from '../../lib/playground-calls';

interface CallFormProps {
  call: PlaygroundCall;
  workspaceId: string;
  values: PlaygroundValues;
  errors: Record<string, string>;
  onChange: (key: string, value: string) => void;
  /** The ids earlier answers carried, offered where a task or parent id is asked for. */
  handoff: PlaygroundHandoff;
}

/**
 * The fields of the chosen call, with the workspace filling in what it can:
 * projects and sections come from dropdowns, and a task id can be the one
 * just created. Ids are never typed by hand unless someone wants to.
 */
export function CallForm({ call, workspaceId, values, errors, onChange, handoff }: CallFormProps) {
  if (call.fields.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing to fill in. Run it and read the workspace id off the answer.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {call.fields.map((field) => (
        <PlaygroundField
          key={field.key}
          field={field}
          workspaceId={workspaceId}
          values={values}
          error={errors[field.key]}
          onChange={onChange}
          handoff={handoff}
        />
      ))}
    </div>
  );
}

function PlaygroundField({
  field,
  workspaceId,
  values,
  error,
  onChange,
  handoff,
}: {
  field: PlaygroundFieldSpec;
  workspaceId: string;
  values: PlaygroundValues;
  error: string | undefined;
  onChange: (key: string, value: string) => void;
  handoff: PlaygroundHandoff;
}) {
  const id = `playground-${field.key}`;
  const value = values[field.key] ?? '';
  // The id an earlier answer left for this very field, if it is not already in it.
  const offered = (handoff as Partial<Record<string, string | null>>)[field.key] ?? null;

  switch (field.kind) {
    case 'project':
      return (
        <ProjectSelect
          id={id}
          field={field}
          workspaceId={workspaceId}
          value={value}
          error={error}
          onChange={(next) => onChange(field.key, next)}
        />
      );
    case 'section':
      return (
        <SectionSelect
          id={id}
          field={field}
          workspaceId={workspaceId}
          projectId={values['projectId'] ?? ''}
          value={value}
          error={error}
          onChange={(next) => onChange(field.key, next)}
        />
      );
    case 'taskId':
      return (
        <Field label={field.label} htmlFor={id} error={error} required={field.required}>
          <div className="flex gap-2">
            <Input
              {...fieldAria(id, error)}
              value={value}
              placeholder={field.placeholder}
              spellCheck={false}
              className="font-mono text-xs"
              onChange={(event) => onChange(field.key, event.target.value)}
            />
            {offered && offered !== value && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onChange(field.key, offered)}
              >
                Use last created
              </Button>
            )}
          </div>
        </Field>
      );
    case 'select':
      return (
        <Field label={field.label} htmlFor={id} error={error} required={field.required}>
          <Select value={value} onValueChange={(next) => onChange(field.key, next)}>
            <SelectTrigger id={id} className="w-full">
              <SelectValue placeholder="Leave as default" />
            </SelectTrigger>
            <SelectContent>
              {(field.options ?? []).map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      );
    case 'textarea':
      return (
        <Field
          label={field.label}
          htmlFor={id}
          error={error}
          hint={field.hint}
          required={field.required}
        >
          <Textarea
            {...fieldAria(id, error)}
            value={value}
            rows={3}
            placeholder={field.placeholder}
            onChange={(event) => onChange(field.key, event.target.value)}
          />
        </Field>
      );
    default:
      return (
        <Field
          label={field.label}
          htmlFor={id}
          error={error}
          hint={field.hint}
          required={field.required}
        >
          <Input
            {...fieldAria(id, error)}
            value={value}
            placeholder={field.placeholder}
            onChange={(event) => onChange(field.key, event.target.value)}
          />
        </Field>
      );
  }
}

function ProjectSelect({
  id,
  field,
  workspaceId,
  value,
  error,
  onChange,
}: {
  id: string;
  field: PlaygroundFieldSpec;
  workspaceId: string;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const { data } = useProjects(workspaceId, { limit: 100 });
  const projects = data?.items ?? [];

  return (
    <Field label={field.label} htmlFor={id} error={error} required={field.required}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full" {...fieldAria(id, error)}>
          <SelectValue placeholder="Choose a project" />
        </SelectTrigger>
        <SelectContent>
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.name}
              <span className="ml-1 text-xs text-muted-foreground">· {project.key}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function SectionSelect({
  id,
  field,
  workspaceId,
  projectId,
  value,
  error,
  onChange,
}: {
  id: string;
  field: PlaygroundFieldSpec;
  workspaceId: string;
  projectId: string;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const { data: project } = useProject(workspaceId, projectId);
  const sections = project?.sections ?? [];

  return (
    <Field
      label={field.label}
      htmlFor={id}
      error={error}
      hint={field.hint}
      required={field.required}
    >
      <Select value={value} onValueChange={onChange} disabled={!projectId}>
        <SelectTrigger className="w-full" {...fieldAria(id, error)}>
          <SelectValue placeholder={projectId ? 'Choose a section' : 'Choose a project first'} />
        </SelectTrigger>
        <SelectContent>
          {sections.map((section) => (
            <SelectItem key={section.id} value={section.id}>
              {section.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
