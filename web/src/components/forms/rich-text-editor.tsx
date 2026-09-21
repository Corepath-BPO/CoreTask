import { INLINE_IMAGE_MIME_TYPES } from '@coretask/contracts';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Strikethrough,
  TextQuote,
  Underline,
} from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

import { isEmptyHtml, toEditorHtml } from '@/lib/rich-text';
import { cn } from '@/lib/utils';

import {
  AttachmentImage,
  insertAttachmentImage,
  type AttachmentImageAttrs,
} from './extensions/attachment-image';
import {
  DescriptionMention,
  mentionExtension,
  type MentionCandidate,
  type MentionHooks,
  type MentionSuggestion,
} from './extensions/mention';
import { MentionList } from './mention-list';

/**
 * The description editor.
 *
 * Tiptap over ProseMirror, with the marks and blocks Asana's description
 * offers and nothing beyond them: bold, italic, underline, strikethrough,
 * lists, links, code, two heading sizes, a quote — plus an `@` that names a
 * teammate and a picture pasted in place. The output is HTML, which the API
 * sanitises before it stores anything — this component never trusts its own
 * output. See docs/architecture/task-dates-and-rich-text.md.
 *
 * The content is loaded once, on mount. Like the plain textarea it replaces,
 * the editor is owned by the person typing: a background refetch of the same
 * task must not overwrite what they are writing. Callers key the editor by
 * task id so a different task starts fresh.
 */
function extensions(options: {
  placeholder?: string | undefined;
  workspaceId?: string | undefined;
  mention?: MentionHooks | undefined;
  /** The reader, so a chip naming them is tinted. Read-only views only. */
  highlightMentionId?: string | undefined;
}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      },
    }),
    Placeholder.configure({ placeholder: options.placeholder ?? '' }),
    AttachmentImage.configure({ workspaceId: options.workspaceId }),
    // Without hooks the chip still parses and renders; `@` is just a character.
    options.mention
      ? mentionExtension(options.mention)
      : DescriptionMention.configure({ highlightId: options.highlightMentionId ?? null }),
  ];
}

/**
 * Built once and kept: the editor holds the instances, and the callbacks
 * inside only ever run on a keystroke or a paste, never during a render.
 */
function useEditorExtensions(options: Parameters<typeof extensions>[0]) {
  const [built] = useState(() => extensions(options));
  return built;
}

/** What a paste or drop hands to the caller, and how a picture comes back. */
export type FilesHandler = (
  files: File[],
  insertImage: (attrs: AttachmentImageAttrs) => void,
) => void;

interface RichTextEditorProps {
  /** Stored HTML, or plain text from before the editor existed. */
  initialValue: string | null | undefined;
  /** Fired when focus leaves; `null` when the editor holds no text. */
  onBlur?: (html: string | null) => void;
  /** Fired on every edit; `null` when the editor holds no text. A composer reads this. */
  onChange?: ((html: string | null) => void) | undefined;
  /** Ctrl/Cmd+Enter, when the mention list is not the one being answered. */
  onSubmit?: (() => void) | undefined;
  /**
   * Files pasted, dropped or picked. They are the caller's to upload; a raster
   * image can then be put back where the caret was through `insertImage`.
   */
  onFiles?: FilesHandler | undefined;
  /** Where inline pictures live. Without it, they draw as placeholders. */
  workspaceId?: string | undefined;
  /** Who `@` can name. Read on every keystroke, so a late list still counts. */
  mentionables?: MentionCandidate[] | undefined;
  /** The Tiptap instance, for a caller that needs to clear or focus it. */
  editorRef?: RefObject<Editor | null> | undefined;
  /** Whether the formatting bar waits for focus (a description) or is always there (a composer). */
  toolbar?: 'focus' | 'always';
  /** Extra controls at the end of the formatting bar — a composer's paperclip. */
  toolbarExtras?: ReactNode;
  /** Tailwind class for the editing surface's minimum height; a comment box is shorter. */
  minHeightClassName?: string;
  autoFocus?: boolean;
  placeholder?: string;
  editable?: boolean;
  ariaLabel?: string;
  className?: string;
}

export function RichTextEditor({
  initialValue,
  onBlur,
  onChange,
  onSubmit,
  onFiles,
  workspaceId,
  mentionables,
  editorRef: externalEditorRef,
  toolbar = 'focus',
  toolbarExtras,
  minHeightClassName = 'min-h-[4.5rem]',
  autoFocus = false,
  placeholder,
  editable = true,
  ariaLabel = 'Description',
  className,
}: RichTextEditorProps) {
  /*
   * The extensions are built once, so everything they call back into lives in
   * refs: the member list arrives after the editor exists, and the key handler
   * has to see the list that is open now, not the one from the first render.
   */
  const mentionablesRef = useRef(mentionables);
  const onFilesRef = useRef(onFiles);
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  const suggestionOpenRef = useRef(false);
  const editorRef = useRef<Editor | null>(null);
  const keyHandlerRef = useRef<(event: KeyboardEvent) => boolean>(() => false);

  const [suggestion, setSuggestion] = useState<MentionSuggestion | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const takeFiles = (list: FileList | null | undefined, event: Event): boolean => {
    const files = [...(list ?? [])];
    if (files.length === 0 || !onFilesRef.current) return false;
    event.preventDefault();
    onFilesRef.current(files, (attrs) => {
      if (editorRef.current) insertAttachmentImage(editorRef.current, attrs);
    });
    return true;
  };

  const editorExtensions = useEditorExtensions({
    placeholder,
    workspaceId,
    mention: {
      candidates: () => mentionablesRef.current ?? [],
      onState: (next) => {
        suggestionOpenRef.current = next !== null && next.items.length > 0;
        setSuggestion(next);
        setHighlighted(0);
      },
      onKeyDown: (event) => keyHandlerRef.current(event),
    },
  });

  const editor = useEditor(
    {
      extensions: editorExtensions,
      content: toEditorHtml(initialValue),
      editable,
      autofocus: autoFocus ? 'end' : false,
      editorProps: {
        attributes: {
          class: `rich-text ${minHeightClassName} focus:outline-none`,
          'aria-label': ariaLabel,
          'aria-multiline': 'true',
          role: 'textbox',
        },
        handlePaste: (_view, event) => takeFiles(event.clipboardData?.files, event),
        handleDrop: (_view, event) => takeFiles(event.dataTransfer?.files, event),
        // Ctrl/Cmd+Enter posts, unless the mention list is up — then Enter is
        // its pick, exactly as the plain textarea composer ruled.
        handleKeyDown: (_view, event) => {
          if (
            event.key === 'Enter' &&
            (event.ctrlKey || event.metaKey) &&
            onSubmitRef.current &&
            !suggestionOpenRef.current
          ) {
            event.preventDefault();
            onSubmitRef.current();
            return true;
          }
          return false;
        },
      },
      onBlur: ({ editor: instance }) => {
        onBlur?.(reported(instance));
      },
      onUpdate: ({ editor: instance }) => {
        onChangeRef.current?.(reported(instance));
      },
    },
    [],
  );

  useLayoutEffect(() => {
    mentionablesRef.current = mentionables;
    onFilesRef.current = onFiles;
    onChangeRef.current = onChange;
    onSubmitRef.current = onSubmit;
    editorRef.current = editor;
    if (externalEditorRef) externalEditorRef.current = editor;
  });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  const items = suggestion?.items ?? [];

  // The list owns the arrows and Enter while it is up; otherwise choosing a
  // name would put a newline in the description instead.
  useLayoutEffect(() => {
    keyHandlerRef.current = (event) => {
      if (!suggestion || items.length === 0) return false;

      switch (event.key) {
        case 'ArrowDown':
          setHighlighted((current) => (current + 1) % items.length);
          return true;
        case 'ArrowUp':
          setHighlighted((current) => (current - 1 + items.length) % items.length);
          return true;
        case 'Enter':
        case 'Tab': {
          const picked = items[highlighted];
          if (picked) suggestion.command(picked);
          return true;
        }
        case 'Escape':
          setSuggestion(null);
          return true;
        default:
          return false;
      }
    };
  });

  // Just under the caret, in the editor box's own coordinates. Measured and
  // written to the node rather than held in state: it changes per keystroke.
  useLayoutEffect(() => {
    const list = listRef.current;
    const box = wrapperRef.current;
    const rect = suggestion?.clientRect?.();
    if (!list || !box || !rect) return;

    const boxRect = box.getBoundingClientRect();
    list.style.top = `${rect.bottom - boxRect.top + 4}px`;
    list.style.left = `${Math.max(0, rect.left - boxRect.left)}px`;
  }, [suggestion]);

  const focused = useEditorState({
    editor,
    selector: ({ editor: instance }) => instance?.isFocused ?? false,
  });

  return (
    <div
      ref={wrapperRef}
      className={cn(
        'relative -mx-2 rounded-md border px-2 py-1.5 transition-colors',
        editable
          ? 'border-transparent hover:border-input focus-within:border-input'
          : 'border-transparent',
        className,
      )}
    >
      <EditorContent editor={editor} />

      {suggestion && items.length > 0 && (
        <MentionList
          ref={listRef}
          items={items}
          highlighted={highlighted}
          onHighlight={setHighlighted}
          onPick={(candidate) => suggestion.command(candidate)}
        />
      )}

      {/* Asana's formatting bar surfaces under the text while it is being
          edited; a bar that is always there makes every description look
          like a form. A composer is a form, and keeps its bar. */}
      {editable && editor && (toolbar === 'always' || focused) && (
        <Toolbar
          editor={editor}
          extras={toolbarExtras}
          onPickFiles={
            onFiles
              ? (files) =>
                  onFiles(files, (attrs) => {
                    if (editorRef.current) insertAttachmentImage(editorRef.current, attrs);
                  })
              : undefined
          }
        />
      )}
    </div>
  );
}

/** A description as read-only rich text — the ticket dialog, a preview, a comment. */
export function RichTextView({
  html,
  workspaceId,
  highlightMentionId,
  className,
}: {
  html: string;
  /** Where inline pictures live; without it they draw as placeholders. */
  workspaceId?: string | undefined;
  /** The reader, so a chip naming them stands out. */
  highlightMentionId?: string | undefined;
  className?: string;
}) {
  const editor = useEditor(
    {
      extensions: extensions({ workspaceId, highlightMentionId }),
      content: toEditorHtml(html),
      editable: false,
      editorProps: { attributes: { class: 'rich-text' } },
    },
    [html, highlightMentionId],
  );

  return <EditorContent editor={editor} className={className} />;
}

function Toolbar({
  editor,
  extras,
  onPickFiles,
}: {
  editor: Editor;
  extras?: ReactNode;
  onPickFiles?: ((files: File[]) => void) | undefined;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      bold: instance.isActive('bold'),
      italic: instance.isActive('italic'),
      underline: instance.isActive('underline'),
      strike: instance.isActive('strike'),
      bulletList: instance.isActive('bulletList'),
      orderedList: instance.isActive('orderedList'),
      blockquote: instance.isActive('blockquote'),
      code: instance.isActive('code'),
      h1: instance.isActive('heading', { level: 1 }),
      h2: instance.isActive('heading', { level: 2 }),
      link: instance.isActive('link'),
    }),
  });

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openLink = () => {
    setLinkDraft((editor.getAttributes('link')['href'] as string | undefined) ?? '');
    setLinkOpen(true);
  };

  const applyLink = () => {
    const href = linkDraft.trim();
    if (href) {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    } else {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    }
    setLinkOpen(false);
  };

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="mt-1.5 flex flex-wrap items-center gap-0.5 border-t pt-1.5"
      // Pressing a tool must not blur the editor: blur is what saves, and a
      // save in the middle of formatting would be a save of half a thought.
      onMouseDown={(event) => event.preventDefault()}
    >
      <Tool
        label="Bold"
        active={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold />
      </Tool>
      <Tool
        label="Italic"
        active={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic />
      </Tool>
      <Tool
        label="Underline"
        active={state.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <Underline />
      </Tool>
      <Tool
        label="Strikethrough"
        active={state.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough />
      </Tool>

      <Divider />

      <Tool
        label="Bulleted list"
        active={state.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List />
      </Tool>
      <Tool
        label="Numbered list"
        active={state.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered />
      </Tool>

      <Divider />

      <Tool
        label="Link"
        active={state.link}
        onClick={linkOpen ? () => setLinkOpen(false) : openLink}
      >
        <Link2 />
      </Tool>
      <Tool
        label="Code"
        active={state.code}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code />
      </Tool>
      <Tool
        label="Quote"
        active={state.blockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <TextQuote />
      </Tool>

      <Divider />

      <Tool
        label="Heading 1"
        active={state.h1}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 />
      </Tool>
      <Tool
        label="Heading 2"
        active={state.h2}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 />
      </Tool>

      {/* A picture, for whoever has nothing on the clipboard. The file lands
          in the attachments as a paste would, then in the text. */}
      {onPickFiles && (
        <>
          <Divider />
          <Tool label="Image" active={false} onClick={() => fileInputRef.current?.click()}>
            <ImageIcon />
          </Tool>
          <input
            ref={fileInputRef}
            type="file"
            accept={INLINE_IMAGE_MIME_TYPES.join(',')}
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              // Reset, so choosing the same file twice fires twice.
              event.target.value = '';
              if (files.length > 0) onPickFiles(files);
            }}
          />
        </>
      )}

      {extras}

      {linkOpen && (
        <form
          className="mt-1 flex w-full items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            applyLink();
          }}
        >
          <input
            // The one control that needs to take focus from the editor.
            onMouseDown={(event) => event.stopPropagation()}
            autoFocus
            value={linkDraft}
            onChange={(event) => setLinkDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setLinkOpen(false);
                editor.commands.focus();
              }
            }}
            placeholder="Paste a link"
            aria-label="Link address"
            className="h-7 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-xs focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"
          />
          <button
            type="submit"
            className="h-7 cursor-pointer rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground hover:bg-primary/88"
          >
            {linkDraft.trim() ? 'Apply' : 'Remove'}
          </button>
        </form>
      )}
    </div>
  );
}

function Tool({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        'flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors [&_svg]:size-4',
        'hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
        active && 'bg-accent text-accent-foreground',
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />;
}

/**
 * What the editor reports: its HTML, or null when it shows nothing.
 *
 * Tiptap's own `isEmpty` is false for a paragraph of spaces, but the API
 * refuses that body as empty — so the same rule applies here, and a button
 * gated on the report cannot offer to post what the server will reject.
 */
function reported(instance: Editor): string | null {
  if (instance.isEmpty) return null;
  const html = instance.getHTML();
  return isEmptyHtml(html) ? null : html;
}
