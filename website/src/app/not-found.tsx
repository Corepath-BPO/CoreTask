import type { Metadata } from 'next';

import { Mark } from '@/components/brand';
import { ButtonLink } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false },
};

export default function NotFound() {
  return (
    <main className="grid min-h-svh place-items-center px-6 text-center">
      <div>
        <Mark className="mx-auto h-16 w-auto text-fg" />
        <h1 className="headline mt-8">This page isn’t on the board.</h1>
        <p className="lede mx-auto mt-4 max-w-md">
          The link may be old, or the page may have moved.
        </p>
        <ButtonLink href="/" className="mt-8">
          Back to CoreTask
        </ButtonLink>
      </div>
    </main>
  );
}
