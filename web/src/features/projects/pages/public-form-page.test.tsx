import { FormQuestionKind } from '@coretask/contracts';
import type { PublicForm } from '@coretask/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/api-error';

import { PublicFormPage } from './public-form-page';

const get = vi.fn();
const post = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

const form: PublicForm = {
  name: 'Maintenance request',
  description: 'Tell us what needs fixing.',
  projectName: 'Maintenance',
  questions: [
    { id: 'unit', label: 'Unit number', kind: FormQuestionKind.SHORT_TEXT, required: true },
    { id: 'email', label: 'Your email', kind: FormQuestionKind.EMAIL, required: false },
  ],
};

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PublicFormPage token="tok-123" />
    </QueryClientProvider>,
  );

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe('PublicFormPage', () => {
  it('shows the form, holds Submit until the required answers are in, and thanks the sender', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(form);
    post.mockResolvedValue({ received: true });
    renderPage();

    expect(await screen.findByText('Maintenance request')).toBeInTheDocument();
    expect(screen.getByText('Tell us what needs fixing.')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/public/forms/tok-123');

    const submit = screen.getByRole('button', { name: 'Submit' });
    await user.type(screen.getByLabelText(/Title/), 'Leaking tap');
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/Unit number/), '  4B ');
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(post).toHaveBeenCalledWith('/public/forms/tok-123/submissions', {
      title: 'Leaking tap',
      details: null,
      answers: { unit: '4B' },
    });
    expect(await screen.findByText(/your response was sent/)).toBeInTheDocument();
    expect(screen.getByText(/now a task in Maintenance/)).toBeInTheDocument();

    // Another response starts from a blank form.
    await user.click(screen.getByRole('button', { name: 'Submit another response' }));
    expect(screen.getByLabelText(/Title/)).toHaveValue('');
  });

  it('says what the server refused, and keeps what was typed', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(form);
    post.mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'BAD_REQUEST',
        message: '“Your email” needs an email address.',
      }),
    );
    renderPage();

    await user.type(await screen.findByLabelText(/Title/), 'Leaking tap');
    await user.type(screen.getByLabelText(/Unit number/), '4B');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByText(/needs an email address/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Title/)).toHaveValue('Leaking tap');
  });

  it('reads a closed or unknown link as one that is not taking responses', async () => {
    get.mockRejectedValue(
      new ApiError({ status: 404, code: 'RESOURCE_NOT_FOUND', message: 'Gone' }),
    );
    renderPage();

    expect(await screen.findByText('This form is not taking responses')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
  });

  it('asks choice, date and number questions with the right controls', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({
      ...form,
      questions: [
        {
          id: 'kind',
          label: 'Kind of issue',
          kind: FormQuestionKind.SINGLE_SELECT,
          required: true,
          options: ['Plumbing', 'Electrical'],
        },
        {
          id: 'rooms',
          label: 'Rooms',
          kind: FormQuestionKind.MULTI_SELECT,
          required: false,
          options: ['Kitchen', 'Bath', 'Hall'],
        },
        { id: 'when', label: 'Best day', kind: FormQuestionKind.DATE, required: false },
        { id: 'people', label: 'Occupants', kind: FormQuestionKind.NUMBER, required: false },
      ],
    } satisfies PublicForm);
    post.mockResolvedValue({ received: true });
    renderPage();

    await user.type(await screen.findByLabelText(/Title/), 'Sink drips');
    expect(screen.getByLabelText(/Best day/)).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText(/Occupants/)).toHaveAttribute('type', 'number');
    await user.click(screen.getByRole('radio', { name: 'Plumbing' }));
    await user.click(screen.getByRole('checkbox', { name: 'Bath' }));
    await user.click(screen.getByRole('checkbox', { name: 'Kitchen' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    // Chosen options travel in the order the form lists them, one per line.
    expect(post).toHaveBeenCalledWith('/public/forms/tok-123/submissions', {
      title: 'Sink drips',
      details: null,
      answers: { kind: 'Plumbing', rooms: 'Kitchen\nBath' },
    });
  });
});
