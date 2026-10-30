import { randomBytes } from 'node:crypto';

import {
  FORM_CHOICE_KINDS,
  FORM_MULTI_SEPARATOR,
  FORM_OPTION_MAX,
  FORM_QUESTION_KINDS,
  FormQuestionKind,
  MAX_FORM_OPTIONS,
  MAX_FORM_QUESTIONS,
  MAX_FORMS_PER_PROJECT,
  WorkspaceRole,
  formAnswerProblem,
} from '@coretask/contracts';
import type {
  FormQuestion,
  FormSubmission,
  ProjectForm,
  ProjectFormDraft,
  PublicForm,
} from '@coretask/types';
import { Injectable } from '@nestjs/common';
import type { Prisma, ProjectForm as FormRow } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { escapeHtml } from '../../common/utils/rich-text.util';
import { PrismaService } from '../../database/prisma.service';
import { ProjectAccessService } from '../project-access/project-access.service';
import { TasksService } from '../tasks/tasks.service';

/** Bytes behind a public link: unguessable, and short enough to paste. */
const TOKEN_BYTES = 18;

function readQuestions(value: Prisma.JsonValue): FormQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return [];
    const record = row as Record<string, unknown>;
    const label = typeof record['label'] === 'string' ? record['label'].trim() : '';
    const id = typeof record['id'] === 'string' ? record['id'] : '';
    if (!label || !id) return [];
    const kind = FORM_QUESTION_KINDS.includes(record['kind'] as FormQuestionKind)
      ? (record['kind'] as FormQuestionKind)
      : FormQuestionKind.SHORT_TEXT;
    const options = Array.isArray(record['options'])
      ? record['options'].filter((option): option is string => typeof option === 'string')
      : [];
    return [
      {
        id,
        label,
        kind,
        required: record['required'] === true,
        ...(FORM_CHOICE_KINDS.includes(kind) ? { options } : {}),
      },
    ];
  });
}

function toDto(row: FormRow): ProjectForm {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    token: row.token,
    isActive: row.isActive,
    sectionId: row.sectionId,
    questions: readQuestions(row.questions),
    submissionCount: row.submissionCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Questions as stored: trimmed, with ids, capped. */
function cleanQuestions(questions: FormQuestion[]): Prisma.InputJsonValue {
  return questions
    .map((question) => {
      const options = [
        ...new Set(
          (question.options ?? [])
            .map((option) => option.replace(/\s+/g, ' ').trim().slice(0, FORM_OPTION_MAX))
            .filter(Boolean),
        ),
      ].slice(0, MAX_FORM_OPTIONS);
      // A choice with nothing to choose from is a short answer instead.
      const kind =
        FORM_CHOICE_KINDS.includes(question.kind) && options.length === 0
          ? FormQuestionKind.SHORT_TEXT
          : question.kind;
      return {
        id: question.id || randomBytes(6).toString('base64url'),
        label: question.label.trim(),
        kind,
        required: question.required === true,
        ...(FORM_CHOICE_KINDS.includes(kind) ? { options } : {}),
      };
    })
    .filter((question) => question.label !== '')
    .slice(0, MAX_FORM_QUESTIONS);
}

/**
 * Intake forms — Asana's Forms.
 *
 * Editors manage a project's forms; anyone with a form's link may submit it,
 * and each submission becomes a task credited to the form's author (or, if
 * they have left, the workspace's owner) — a task needs a creator, and the
 * submitter has no account. The answers go into the description in full.
 */
@Injectable()
export class FormsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly tasks: TasksService,
  ) {}

  // -------------------------------------------------------------------------
  // Managing
  // -------------------------------------------------------------------------

  async list(workspaceId: string, projectId: string, actor: ActorContext): Promise<ProjectForm[]> {
    await this.requireEditor(workspaceId, projectId, actor);
    const rows = await this.prisma.projectForm.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
    draft: ProjectFormDraft,
  ): Promise<ProjectForm> {
    await this.requireEditor(workspaceId, projectId, actor);
    if ((await this.prisma.projectForm.count({ where: { projectId } })) >= MAX_FORMS_PER_PROJECT) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `A project holds up to ${MAX_FORMS_PER_PROJECT} forms.`,
      );
    }
    await this.assertSection(projectId, draft.sectionId);

    const row = await this.prisma.projectForm.create({
      data: {
        workspaceId,
        projectId,
        createdById: actor.userId,
        token: randomBytes(TOKEN_BYTES).toString('base64url'),
        name: draft.name.trim(),
        description: draft.description?.trim() || null,
        isActive: draft.isActive ?? true,
        sectionId: draft.sectionId ?? null,
        questions: cleanQuestions(draft.questions ?? []),
      },
    });
    return toDto(row);
  }

  async update(
    workspaceId: string,
    projectId: string,
    formId: string,
    actor: ActorContext,
    draft: Partial<ProjectFormDraft>,
  ): Promise<ProjectForm> {
    await this.requireEditor(workspaceId, projectId, actor);
    await this.require(projectId, formId);
    if (draft.sectionId !== undefined) await this.assertSection(projectId, draft.sectionId);

    const row = await this.prisma.projectForm.update({
      where: { id: formId },
      data: {
        ...(draft.name !== undefined ? { name: draft.name.trim() } : {}),
        ...(draft.description !== undefined
          ? { description: draft.description?.trim() || null }
          : {}),
        ...(draft.isActive !== undefined ? { isActive: draft.isActive } : {}),
        ...(draft.sectionId !== undefined ? { sectionId: draft.sectionId } : {}),
        ...(draft.questions !== undefined ? { questions: cleanQuestions(draft.questions) } : {}),
      },
    });
    return toDto(row);
  }

  async remove(
    workspaceId: string,
    projectId: string,
    formId: string,
    actor: ActorContext,
  ): Promise<void> {
    await this.requireEditor(workspaceId, projectId, actor);
    await this.require(projectId, formId);
    await this.prisma.projectForm.delete({ where: { id: formId } });
  }

  // -------------------------------------------------------------------------
  // The public side
  // -------------------------------------------------------------------------

  async publicForm(token: string): Promise<PublicForm> {
    const form = await this.openForm(token);
    return {
      name: form.name,
      description: form.description,
      projectName: form.project.name,
      questions: readQuestions(form.questions),
    };
  }

  async submit(token: string, submission: FormSubmission): Promise<{ received: true }> {
    const form = await this.openForm(token);
    const questions = readQuestions(form.questions);
    const answers = submission.answers ?? {};

    // Every required question answered, and every email an email.
    const missing = questions.filter(
      (question) => question.required && !(answers[question.id] ?? '').trim(),
    );
    if (missing.length > 0) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `Please answer: ${missing.map((question) => question.label).join(', ')}.`,
      );
    }
    for (const question of questions) {
      const problem = formAnswerProblem(question, answers[question.id] ?? '');
      if (problem) throw AppException.badRequest('BAD_REQUEST', problem);
    }

    const actor = await this.creditFor(form);
    const section =
      form.sectionId ??
      (
        await this.prisma.section.findFirst({
          where: { projectId: form.projectId },
          orderBy: { position: 'asc' },
          select: { id: true },
        })
      )?.id ??
      null;

    await this.tasks.create(form.workspaceId, actor, {
      title: submission.title.trim(),
      description: describe(submission.details ?? null, questions, answers, form.name),
      projectId: form.projectId,
      ...(section ? { sectionId: section } : {}),
    });

    await this.prisma.projectForm.update({
      where: { id: form.id },
      data: { submissionCount: { increment: 1 } },
    });

    return { received: true };
  }

  // -------------------------------------------------------------------------

  /** An active form, with its project — or a 404 that says nothing more. */
  private async openForm(token: string) {
    const form = await this.prisma.projectForm.findUnique({
      where: { token },
      include: { project: { select: { name: true, archivedAt: true } } },
    });
    if (!form || !form.isActive || form.project.archivedAt) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'This form is not taking responses.');
    }
    return form;
  }

  /** Who the task is credited to: the form's author while they are a member, else the owner. */
  private async creditFor(form: { workspaceId: string; createdById: string | null }) {
    const author = form.createdById
      ? await this.prisma.workspaceMember.findFirst({
          where: { workspaceId: form.workspaceId, userId: form.createdById, deactivatedAt: null },
          select: { userId: true, role: true },
        })
      : null;
    const member =
      author ??
      (await this.prisma.workspaceMember.findFirst({
        where: { workspaceId: form.workspaceId, role: WorkspaceRole.OWNER },
        orderBy: { createdAt: 'asc' },
        select: { userId: true, role: true },
      }));
    if (!member)
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'This form is not taking responses.');
    return { userId: member.userId, role: member.role } as ActorContext;
  }

  private async require(projectId: string, formId: string): Promise<FormRow> {
    const row = await this.prisma.projectForm.findFirst({ where: { id: formId, projectId } });
    if (!row) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Form not found.');
    return row;
  }

  private async assertSection(projectId: string, sectionId: string | null | undefined) {
    if (!sectionId) return;
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, projectId },
      select: { id: true },
    });
    if (!section)
      throw AppException.badRequest('BAD_REQUEST', 'That section is not in this project.');
  }

  private async requireEditor(workspaceId: string, projectId: string, actor: ActorContext) {
    const access = await this.access.findAccess(workspaceId, projectId, actor);
    if (!access) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Project not found.');
    await this.access.assertEffectiveRole(projectId, actor, WorkspaceRole.MEMBER);
  }
}

/** The task's description: the details, then every answered question, then where it came from. */
function describe(
  details: string | null,
  questions: FormQuestion[],
  answers: Record<string, string>,
  formName: string,
): string {
  const paragraphs = (text: string) =>
    text
      .split(/\n{2,}/)
      .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
      .join('');

  const parts: string[] = [];
  if (details?.trim()) parts.push(paragraphs(details.trim()));
  for (const question of questions) {
    const answer = (answers[question.id] ?? '').trim();
    if (!answer) continue;
    const shown =
      question.kind === FormQuestionKind.MULTI_SELECT
        ? answer
            .split(FORM_MULTI_SEPARATOR)
            .map((part) => part.trim())
            .filter(Boolean)
            .join(', ')
        : answer;
    parts.push(
      `<p><strong>${escapeHtml(question.label)}</strong><br>${escapeHtml(shown).replace(/\n/g, '<br>')}</p>`,
    );
  }
  parts.push(`<p><em>Submitted through the form “${escapeHtml(formName)}”.</em></p>`);
  return parts.join('');
}
