import {
  FORM_ANSWER_MAX,
  FORM_MULTI_SEPARATOR,
  FormQuestionKind,
  TASK_TITLE_MAX_LENGTH,
} from '@coretask/contracts';
import type { PublicForm } from '@coretask/types';
import { CircleCheck, ClipboardX } from 'lucide-react';
import { useState } from 'react';

import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api/api-error';

import { usePublicForm, useSubmitForm } from '../hooks/use-forms';

/**
 * A form, filled in by link — Asana's form page.
 *
 * Reachable signed out on purpose: whoever submits it usually has no account.
 * The endpoint behind it shows the form's own words and its project's name,
 * nothing else, and a closed or unknown link reads the same as a missing one.
 */
/** The browser's own control for the kinds that have one. */
const INPUT_TYPE: Partial<Record<FormQuestionKind, string>> = {
  [FormQuestionKind.EMAIL]: 'email',
  [FormQuestionKind.DATE]: 'date',
  [FormQuestionKind.NUMBER]: 'number',
};

export function PublicFormPage({ token }: { token: string }) {
  const { data: form, isLoading, isError } = usePublicForm(token);

  if (isLoading) {
    return (
      <Centered>
        <Skeleton className="h-72 w-full" />
      </Centered>
    );
  }

  if (isError || !form) {
    return (
      <Centered>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardX className="size-5 text-muted-foreground" aria-hidden="true" />
              This form is not taking responses
            </CardTitle>
            <CardDescription>
              The link may be mistyped, or the form has been closed. Ask whoever sent it for a
              current one.
            </CardDescription>
          </CardHeader>
        </Card>
      </Centered>
    );
  }

  return <FilledForm token={token} form={form} />;
}

function FilledForm({ token, form }: { token: string; form: PublicForm }) {
  const submit = useSubmitForm(token);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);

  const missing = form.questions.some(
    (question) => question.required && !(answers[question.id] ?? '').trim(),
  );
  const ready = title.trim() !== '' && !missing && !submit.isPending;

  const reset = () => {
    setTitle('');
    setDetails('');
    setAnswers({});
    submit.reset();
    setSent(false);
  };

  if (sent) {
    return (
      <Centered>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CircleCheck className="size-5 text-success" aria-hidden="true" />
              Thanks — your response was sent
            </CardTitle>
            <CardDescription>
              It is now a task in {form.projectName}. Someone on the team will pick it up.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={reset}>
              Submit another response
            </Button>
          </CardContent>
        </Card>
      </Centered>
    );
  }

  return (
    <Centered>
      <Card>
        <CardHeader>
          <p className="text-xs font-medium text-muted-foreground">{form.projectName}</p>
          <CardTitle className="text-xl">{form.name}</CardTitle>
          {form.description && (
            <CardDescription className="whitespace-pre-line">{form.description}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!ready) return;
              submit.mutate(
                {
                  title: title.trim(),
                  details: details.trim() || null,
                  answers: Object.fromEntries(
                    Object.entries(answers)
                      .map(([id, value]) => [id, value.trim()] as const)
                      .filter(([, value]) => value !== ''),
                  ),
                },
                { onSuccess: () => setSent(true) },
              );
            }}
          >
            <Field label="Title" htmlFor="form-title" required>
              <Input
                id="form-title"
                value={title}
                maxLength={TASK_TITLE_MAX_LENGTH}
                placeholder="A short summary of the request"
                onChange={(event) => setTitle(event.target.value)}
                required
                autoFocus
              />
            </Field>
            <Field label="Details" htmlFor="form-details">
              <Textarea
                id="form-details"
                rows={4}
                value={details}
                maxLength={FORM_ANSWER_MAX}
                onChange={(event) => setDetails(event.target.value)}
              />
            </Field>
            {form.questions.map((question) => {
              const id = `form-q-${question.id}`;
              const value = answers[question.id] ?? '';
              const onChange = (next: string) =>
                setAnswers((current) => ({ ...current, [question.id]: next }));
              return (
                <Field
                  key={question.id}
                  label={question.label}
                  htmlFor={id}
                  required={question.required}
                >
                  {question.kind === FormQuestionKind.LONG_TEXT ? (
                    <Textarea
                      id={id}
                      rows={3}
                      value={value}
                      maxLength={FORM_ANSWER_MAX}
                      required={question.required}
                      onChange={(event) => onChange(event.target.value)}
                    />
                  ) : question.kind === FormQuestionKind.SINGLE_SELECT ? (
                    <div
                      role="radiogroup"
                      id={id}
                      aria-label={question.label}
                      className="space-y-1.5"
                    >
                      {(question.options ?? []).map((option) => (
                        <label key={option} className="flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name={id}
                            value={option}
                            checked={value === option}
                            onChange={() => onChange(option)}
                            className="size-4 accent-primary"
                          />
                          {option}
                        </label>
                      ))}
                    </div>
                  ) : question.kind === FormQuestionKind.MULTI_SELECT ? (
                    <div id={id} role="group" aria-label={question.label} className="space-y-1.5">
                      {(question.options ?? []).map((option) => {
                        const chosen = value ? value.split(FORM_MULTI_SEPARATOR) : [];
                        return (
                          <label key={option} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              value={option}
                              checked={chosen.includes(option)}
                              onChange={(event) =>
                                onChange(
                                  (question.options ?? [])
                                    .filter((candidate) =>
                                      candidate === option
                                        ? event.target.checked
                                        : chosen.includes(candidate),
                                    )
                                    .join(FORM_MULTI_SEPARATOR),
                                )
                              }
                              className="size-4 accent-primary"
                            />
                            {option}
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <Input
                      id={id}
                      type={INPUT_TYPE[question.kind] ?? 'text'}
                      value={value}
                      maxLength={FORM_ANSWER_MAX}
                      required={question.required}
                      onChange={(event) => onChange(event.target.value)}
                    />
                  )}
                </Field>
              );
            })}

            {submit.isError && (
              <p role="alert" className="text-sm text-destructive">
                {submit.error instanceof ApiError
                  ? submit.error.message
                  : 'Could not send the response. Try again.'}
              </p>
            )}

            <Button type="submit" disabled={!ready} loading={submit.isPending}>
              Submit
            </Button>
          </form>
        </CardContent>
      </Card>
      <p className="mt-4 text-center text-xs text-muted-foreground">Powered by CoreTask</p>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main id="main-content" className="mx-auto flex min-h-dvh max-w-xl items-center px-4 py-10">
      <div className="w-full">{children}</div>
    </main>
  );
}
