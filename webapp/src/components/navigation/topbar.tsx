import { GlobalSearch } from '@/features/search/components/global-search';

import { CreateMenu } from './create-menu';
import { MobileNav } from './mobile-nav';
import { NotificationMenu } from './notification-menu';
import { UserMenu } from './user-menu';

/**
 * Application top bar: mobile nav trigger, search, create,
 * notifications, account menu.
 */
export function Topbar() {
  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border/75 bg-background/88 px-3 backdrop-blur-xl sm:px-5">
      <MobileNav />

      <GlobalSearch />

      <div className="ml-auto flex items-center gap-1">
        <CreateMenu />

        <NotificationMenu />

        <UserMenu />
      </div>
    </header>
  );
}
