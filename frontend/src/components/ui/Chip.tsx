import type { ButtonHTMLAttributes, ReactNode } from "react";

type ChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  selected?: boolean;
};

export function Chip({ children, selected = false, className = "", ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`ui-chip${selected ? " is-selected" : ""}${className ? ` ${className}` : ""}`}
      {...props}
    >
      {children}
    </button>
  );
}
