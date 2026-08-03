import type { LucideIcon } from 'lucide-react';

import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/feedback/empty-state';

interface PlaceholderPageProps {
  title: string;
  description: string;
  icon: LucideIcon;
  /** What this screen will do once its API exists. */
  plannedFor: string;
}

/**
 * Stand-in for sidebar destinations whose API is not built yet.
 *
 * A real, navigable route with an honest empty state beats a dead link or a
 * half-built screen — and it is one file to delete per feature that lands.
 */
export function PlaceholderPage({ title, description, icon, plannedFor }: PlaceholderPageProps) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <EmptyState icon={icon} title={`${title} is coming next`} description={plannedFor} />
    </div>
  );
}
