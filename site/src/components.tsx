import type { ReactNode } from "react";
import { motion } from "motion/react";

export function Icon({
  name,
  size = 18,
}: {
  name:
    | "arrow"
    | "play"
    | "pause"
    | "reset"
    | "back"
    | "chevron"
    | "check"
    | "copy"
    | "github"
    | "map"
    | "branch"
    | "terminal"
    | "folder"
    | "plus"
    | "search"
    | "layers"
    | "settings"
    | "close";
  size?: number;
}) {
  const paths = {
    arrow: "M4 12h16m-6-6 6 6-6 6",
    play: "m8 5 11 7-11 7Z",
    pause: "M8 5v14M16 5v14",
    reset: "M4 11a8 8 0 1 1 2 7M4 4v7h7",
    back: "M19 12H5m6-6-6 6 6 6",
    chevron: "m9 5 7 7-7 7",
    check: "m5 12 4 4L19 6",
    copy: "M9 9h11v11H9ZM15 9V4H4v11h5",
    github:
      "M8 20v-3c-4 1-4-2-5-2m13 5v-4c0-1-.5-2-1-2 3-.3 5-2 5-5 0-1-.4-2-1-3 0-1 0-2-.4-3-2 0-3 1-4 1a13 13 0 0 0-5 0C9 3 8 3 6 3c-.4 1-.4 2 0 3-.8 1-1 2-1 3 0 3 2 5 5 5-.6.5-1 1-1 2",
    map: "M3 5h6v6H3Zm12 8h6v6h-6ZM6 11v5h9M9 8h9v5",
    branch: "M6 5v12m0-8c8 0 12 0 12-4M3 2h6v4H3Zm0 15h6v4H3Zm12-15h6v4h-6Z",
    terminal: "m4 6 6 6-6 6m9 0h7",
    folder: "M3 6h6l2 3h10v11H3Zm0 0V4h6l2 2h8v3",
    plus: "M12 4v16M4 12h16",
    search: "M20 20l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
    layers: "m12 3 9 5-9 5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
    settings: "M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6",
    close: "m6 6 12 12M6 18 18 6",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function Reveal({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.08 }}
      transition={{ duration: 0.5 }}
    >
      {children}
    </motion.div>
  );
}
