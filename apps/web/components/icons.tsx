import type { CSSProperties } from "react";

type IconName =
  | "arrow"
  | "up-right"
  | "chevron"
  | "check"
  | "close"
  | "menu"
  | "wallet"
  | "spark"
  | "refresh"
  | "x"
  | "github"
  | "clock"
  | "link"
  | "copy"
  | "bolt"
  | "chog"
  | "globe"
  | "plus";

export function Icon({
  name,
  size = 20,
  className = "",
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const shapes: Record<IconName, React.ReactNode> = {
    arrow: (
      <>
        <path d="M4 12h15M13 5l7 7-7 7" />
      </>
    ),
    "up-right": (
      <>
        <path d="M5 19 19 5M5 5h14v14" />
      </>
    ),
    chevron: <path d="m5 9 7 7 7-7" />,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    menu: <path d="M4 7h16M4 16h16" />,
    wallet: (
      <>
        <path d="M19 7V4H5a2 2 0 0 0-2 2v13h18V7H5a1 1 0 0 1 0-2" />
        <path d="M21 11h-6v4h6" />
      </>
    ),
    spark: (
      <path d="m12 2 2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2Z" />
    ),
    refresh: (
      <>
        <path d="M20 11a8 8 0 0 0-14-5L3 9M3 3v6h6M4 13a8 8 0 0 0 14 5l3-3M21 21v-6h-6" />
      </>
    ),
    x: (
      <>
        <path d="m5 3 14 18h-4L1 3h4ZM21 3 3 21" />
      </>
    ),
    github: (
      <>
        <path d="M9 20c-4 1-4-2-6-2m12 4v-4a3.5 3.5 0 0 0-1-2.5c3.5-.4 7-1.7 7-6a4.5 4.5 0 0 0-1.2-3.2 4 4 0 0 0-.1-3.3s-1.3-.4-4.2 1.6a14 14 0 0 0-7 0C5.6 2.6 4.3 3 4.3 3a4 4 0 0 0-.1 3.3A4.5 4.5 0 0 0 3 9.5c0 4.3 3.5 5.6 7 6A3.5 3.5 0 0 0 9 18v4" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    link: (
      <>
        <path
          d="m10 13 4-4M8 15l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 9l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"
          transform="translate(0 -1)"
        />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
    bolt: <path d="m13 2-9 12h7l-1 8 10-13h-8l1-7Z" />,
    chog: (
      <>
        <path d="m12 2 3 4 5-1-1 5 3 3-4 2-1 5-5-2-5 2-1-5-4-2 3-3-1-5 5 1 3-4Z" />
        <circle cx="9" cy="11" r=".7" fill="currentColor" />
        <circle cx="15" cy="11" r=".7" fill="currentColor" />
        <path d="M9 15q3 2 6 0" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={style}
    >
      {shapes[name]}
    </svg>
  );
}
