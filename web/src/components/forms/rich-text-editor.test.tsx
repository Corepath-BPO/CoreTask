import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RichTextEditor, RichTextView } from './rich-text-editor';

const viewUrl = vi.hoisted(() => vi.fn());

vi.mock('@/features/attachments/hooks/use-attachment-view-url', () => ({
  useAttachmentViewUrl: (workspaceId: string | undefined, attachmentId: string | null) => ({
    isError: false,
    refetch: vi.fn(),
    ...viewUrl(workspaceId, attachmentId),
  }),
}));

beforeEach(() => {
  viewUrl.mockReset();
  viewUrl.mockReturnValue({ data: undefined, isError: false });
});

describe('RichTextEditor', () => {
  it('reads a plain-text description from before the editor as paragraphs', () => {
    render(<RichTextEditor initialValue={'first line\nsecond line'} />);

    const box = screen.getByRole('textbox', { name: 'Description' });
    const paragraphs = [...box.querySelectorAll('p')].map((p) => p.textContent);
    expect(paragraphs).toEqual(['first line', 'second line']);
  });

  it('renders stored markup as the structure it describes', () => {
    render(
      <RichTextEditor initialValue="<p>Read <strong>this</strong></p><ul><li>one</li></ul>" />,
    );

    const box = screen.getByRole('textbox', { name: 'Description' });
    expect(box.querySelector('strong')?.textContent).toBe('this');
    expect(box.querySelector('ul li')?.textContent).toBe('one');
  });

  it('is read-only for someone who cannot edit', () => {
    render(<RichTextEditor initialValue="<p>x</p>" editable={false} />);

    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveAttribute(
      'contenteditable',
      'false',
    );
  });

  it('reports the content on blur, and nothing at all when it is empty', () => {
    const onBlur = vi.fn();
    render(<RichTextEditor initialValue="<p>kept</p>" onBlur={onBlur} />);

    const box = screen.getByRole('textbox', { name: 'Description' });
    act(() => {
      box.focus();
      box.blur();
    });

    expect(onBlur).toHaveBeenCalledWith('<p>kept</p>');
  });

  it('reports nothing for whitespace alone, as the API would refuse it', () => {
    const onBlur = vi.fn();
    render(<RichTextEditor initialValue="<p>   </p>" onBlur={onBlur} />);

    const box = screen.getByRole('textbox', { name: 'Description' });
    act(() => {
      box.focus();
      box.blur();
    });

    expect(onBlur).toHaveBeenCalledWith(null);
  });

  it('shows the formatting bar only while the editor has focus', () => {
    render(<RichTextEditor initialValue="" />);

    expect(screen.queryByRole('toolbar', { name: 'Formatting' })).not.toBeInTheDocument();

    act(() => {
      screen.getByRole('textbox', { name: 'Description' }).focus();
    });

    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bulleted list' })).toBeInTheDocument();
  });
});

describe('RichTextEditor — mentions and images', () => {
  const ada = '019fc880-0000-7000-8000-000000000001';
  const shot = '019fc880-0000-7000-8000-000000000002';

  it('round-trips a mention chip through its stored shape', () => {
    const onBlur = vi.fn();
    render(
      <RichTextEditor
        initialValue={`<p>Ask <span data-mention="${ada}">@Ada</span> first</p>`}
        onBlur={onBlur}
      />,
    );

    const box = screen.getByRole('textbox', { name: 'Description' });
    const chip = box.querySelector('span[data-mention]');
    expect(chip?.getAttribute('data-mention')).toBe(ada);
    expect(chip?.textContent).toBe('@Ada');

    act(() => {
      box.focus();
      box.blur();
    });
    expect(onBlur).toHaveBeenCalledWith(`<p>Ask <span data-mention="${ada}">@Ada</span> first</p>`);
  });

  it('draws an attachment image from a fetched URL, and stores only the id', async () => {
    viewUrl.mockReturnValue({ data: { url: 'https://bucket.test/shot.png' }, isError: false });
    const onBlur = vi.fn();
    render(
      <RichTextEditor
        workspaceId="ws-1"
        initialValue={`<p>See</p><img data-attachment="${shot}" alt="shot.png">`}
        onBlur={onBlur}
      />,
    );

    const box = screen.getByRole('textbox', { name: 'Description' });
    // The node view mounts through a portal a beat after the editor does.
    await waitFor(() =>
      expect(box.querySelector('img')?.getAttribute('src')).toBe('https://bucket.test/shot.png'),
    );
    expect(viewUrl).toHaveBeenCalledWith('ws-1', shot);

    act(() => {
      box.focus();
      box.blur();
    });
    // The id and the alt, never a URL. (The editor keeps a paragraph after a
    // trailing picture so there is somewhere to type.)
    expect(onBlur).toHaveBeenCalledWith(
      expect.stringContaining(`<p>See</p><img data-attachment="${shot}" alt="shot.png">`),
    );
  });

  it('shows an honest placeholder for a picture that is gone', async () => {
    viewUrl.mockReturnValue({ data: undefined, isError: true });
    render(
      <RichTextEditor
        workspaceId="ws-1"
        initialValue={`<img data-attachment="${shot}" alt="shot.png">`}
      />,
    );

    expect(
      await screen.findByRole('img', { name: 'shot.png (image unavailable)' }),
    ).toBeInTheDocument();
  });

  it('hands pasted files to the caller and puts the picture back where asked', () => {
    viewUrl.mockReturnValue({ data: { url: 'https://bucket.test/shot.png' }, isError: false });
    const onFiles = vi.fn();
    const onBlur = vi.fn();
    render(
      <RichTextEditor
        workspaceId="ws-1"
        initialValue="<p>Before</p>"
        onFiles={onFiles}
        onBlur={onBlur}
      />,
    );

    const box = screen.getByRole('textbox', { name: 'Description' });
    const file = new File(['png'], 'shot.png', { type: 'image/png' });
    act(() => {
      box.focus();
    });
    fireEvent.paste(box, {
      clipboardData: { files: [file], items: [], types: ['Files'], getData: () => '' },
    });

    expect(onFiles).toHaveBeenCalledTimes(1);
    const [files, insertImage] = onFiles.mock.calls[0] as [File[], (attrs: object) => void];
    expect(files).toEqual([file]);

    act(() => {
      insertImage({ attachmentId: shot, alt: 'shot.png' });
      box.blur();
    });

    expect(onBlur).toHaveBeenLastCalledWith(
      expect.stringContaining(`<img data-attachment="${shot}" alt="shot.png">`),
    );
  });
});

describe('RichTextView', () => {
  it('renders without an editing surface', () => {
    render(<RichTextView html="<p>shown</p>" />);

    expect(screen.getByText('shown')).toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });
});
