import { Hash, Link2 } from 'lucide-react';

import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useCopyToClipboard } from '@/lib/hooks/use-copy-to-clipboard';

import { sectionLink, type ProjectViewKind } from '../lib/section-link';

interface SectionLinkItemsProps {
  projectId: string;
  sectionId: string;
  view: ProjectViewKind;
}

/**
 * "Copy link" and "Copy ID" for a section, dropped into any section menu.
 *
 * Asana shows ids in its address bar and people wiring n8n read them from
 * there. A section has no page of its own, so the menu hands the id over
 * directly, and the link puts it in the URL for whoever opens it next.
 */
export function SectionLinkItems({ projectId, sectionId, view }: SectionLinkItemsProps) {
  const { copy } = useCopyToClipboard();

  return (
    <>
      <DropdownMenuItem
        onSelect={() =>
          void copy(sectionLink(projectId, view, sectionId), { success: 'Section link copied' })
        }
      >
        <Link2 />
        Copy link to section
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void copy(sectionId, { success: 'Section ID copied' })}>
        <Hash />
        Copy section ID
      </DropdownMenuItem>
    </>
  );
}
