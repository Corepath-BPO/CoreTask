import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { Reveal } from './motion';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

export function ButtonLink({
  href,
  children,
  variant = 'primary',
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'ghost';
  className?: string;
}) {
  return (
    <a
      href={href}
      className={cx(
        'group inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-[0.95rem] font-medium transition-[background,color,box-shadow,transform] duration-300 active:scale-[0.98]',
        variant === 'primary'
          ? 'bg-brand text-ink shadow-[0_0_0_1px_rgb(133_200_84/0.4),0_12px_40px_-12px_rgb(133_200_84/0.7)] hover:shadow-[0_0_0_1px_rgb(133_200_84/0.6),0_18px_50px_-10px_rgb(133_200_84/0.9)]'
          : 'border border-line-2 bg-white/[0.03] text-fg hover:bg-white/[0.07]',
        className,
      )}
    >
      {children}
      {variant === 'primary' && (
        <ArrowRight
          aria-hidden
          className="size-4 transition-transform duration-300 group-hover:translate-x-0.5"
        />
      )}
    </a>
  );
}

/** Eyebrow, heading and lede for a section — the heading is the section's H2. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  lede,
  align = 'left',
  className,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lede?: string;
  align?: 'left' | 'center';
  className?: string;
}) {
  return (
    <div className={cx(align === 'center' && 'mx-auto text-center', className)}>
      <Reveal>
        <p className="eyebrow">{eyebrow}</p>
      </Reveal>
      <Reveal delay={0.05}>
        <h2 id={id} className="headline mt-4">
          {title}
        </h2>
      </Reveal>
      {lede && (
        <Reveal delay={0.1}>
          <p className={cx('lede mt-5 max-w-2xl', align === 'center' && 'mx-auto')}>{lede}</p>
        </Reveal>
      )}
    </div>
  );
}

/** A short list of supporting points under a section's main visual. */
export function PointGrid({
  points,
  columns = 4,
  className,
}: {
  points: readonly { title: string; body: string }[];
  /** Columns on large screens; two below that. */
  columns?: 2 | 4;
  className?: string;
}) {
  return (
    <ul
      className={cx(
        'grid gap-x-8 gap-y-6 sm:grid-cols-2',
        columns === 4 && 'lg:grid-cols-4',
        className,
      )}
    >
      {points.map((point, i) => (
        <li key={point.title}>
          <Reveal delay={i * 0.06}>
            <div className="border-t border-line-2 pt-4">
              <h3 className="text-[0.98rem] font-medium text-fg">{point.title}</h3>
              <p className="mt-1.5 text-[0.92rem] leading-relaxed text-muted">{point.body}</p>
            </div>
          </Reveal>
        </li>
      ))}
    </ul>
  );
}

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('mx-auto w-full max-w-[1240px] px-5 sm:px-8', className)}>{children}</div>
  );
}
