/**
 * The CoreTask mark: three open squares and one filled one. The page reads it
 * as a story — open work, and work that is done — so the filled square can
 * take the brand green where that story is being told.
 */
export function Mark({
  className,
  done = false,
  title,
}: {
  className?: string;
  done?: boolean;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <g fill="none" stroke="currentColor" strokeWidth="4">
        <rect x="8" y="8" width="18" height="18" />
        <rect x="38" y="8" width="18" height="18" />
        <rect x="8" y="38" width="18" height="18" />
      </g>
      <rect x="36" y="36" width="22" height="22" fill={done ? '#85C854' : 'currentColor'} />
    </svg>
  );
}

/** The horizontal lockup, white ink, trimmed to its artwork. */
export function Lockup({ className }: { className?: string }) {
  return (
    // A plain <img>: the export serves files as they are, and the SVG is 8 KB.
    <img
      src="/brand/coretask-lockup-white.svg"
      alt="CoreTask"
      width={309}
      height={46}
      className={className}
    />
  );
}
