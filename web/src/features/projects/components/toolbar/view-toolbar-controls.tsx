import type { ProjectViewType } from '@coretask/contracts';
import type { ProjectFieldMetadata, ViewSettings } from '@coretask/types';
import { Save } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { FilterPopover } from './filter-popover';
import { GroupPopover } from './group-popover';
import { OptionsPopover } from './options-popover';
import { SortPopover } from './sort-popover';

/**
 * Asana's four toolbar buttons — Filter, Sort, Group, Options — wired to the
 * open view's settings.
 *
 * Mounted by both the List and the Board into the tab row's slot, so the two
 * views offer the same controls in the same place. Each button turns
 * secondary and shows a count while its setting holds, so a narrowed view
 * never reads as a small project. "Save as my view" appears only for
 * somebody who has changed a view they may not write to.
 */
export function ViewToolbarControls({
  viewType,
  settings,
  metadata,
  meId,
  canPersist,
  dirty,
  onChange,
  onSaveAs,
}: {
  viewType: ProjectViewType;
  settings: ViewSettings;
  metadata: ProjectFieldMetadata | undefined;
  meId: string | undefined;
  canPersist: boolean;
  dirty: boolean;
  onChange: (patch: Partial<ViewSettings>) => void;
  onSaveAs: () => void;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="View settings">
      {!canPersist && dirty && (
        <Button variant="outline" size="sm" onClick={onSaveAs}>
          <Save />
          Save as my view
        </Button>
      )}
      <FilterPopover settings={settings} metadata={metadata} meId={meId} onChange={onChange} />
      <SortPopover settings={settings} metadata={metadata} onChange={onChange} />
      <GroupPopover settings={settings} metadata={metadata} onChange={onChange} />
      <OptionsPopover
        viewType={viewType}
        settings={settings}
        metadata={metadata}
        onChange={onChange}
      />
    </div>
  );
}
