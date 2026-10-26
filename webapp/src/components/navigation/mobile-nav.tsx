import { Link } from '@tanstack/react-router';
import { Menu } from 'lucide-react';

import { env } from '@/app/config/env';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { WorkspaceSwitcher } from '@/features/workspaces/components/workspace-switcher';
import { useUiStore } from '@/stores/ui.store';

import { BrandMark } from './sidebar';
import { SidebarNav } from './sidebar-nav';

/**
 * Mobile navigation drawer.
 *
 * Built on the Dialog primitive so focus trapping, Escape handling and scroll
 * locking come from Radix rather than being reimplemented.
 */
export function MobileNav() {
  const open = useUiStore((state) => state.mobileNavOpen);
  const setOpen = useUiStore((state) => state.setMobileNavOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
          <Menu />
        </Button>
      </DialogTrigger>

      <DialogContent
        showCloseButton={false}
        className="left-0 top-0 h-dvh w-[17rem] max-w-[85vw] translate-x-0 translate-y-0 gap-0 rounded-none border-y-0 border-l-0 bg-sidebar p-0 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-[17rem]"
      >
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        <DialogDescription className="sr-only">Move between workspace sections.</DialogDescription>

        <div className="flex h-14 items-center gap-2 border-b px-4">
          <BrandMark />
          <span className="text-sm font-semibold">{env.appName}</span>
        </div>

        <div className="px-3 py-3">
          <WorkspaceSwitcher />
        </div>

        <ScrollArea className="flex-1">
          <div className="px-3 pb-6">
            {/* Closing on navigate: leaving the drawer open over the new route
                would hide the content the user just asked for. */}
            <SidebarNav onNavigate={() => setOpen(false)} />
          </div>
        </ScrollArea>

        <div className="border-t p-3">
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link to="/" onClick={() => setOpen(false)}>
              Back to dashboard
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
