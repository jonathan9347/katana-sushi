import { ReactNode } from "react";
import { NavLink } from "react-router-dom";

export type SectionNavTab<T extends string = string> = {
  id: T;
  label: string;
  icon?: ReactNode;
  to?: string;
  end?: boolean;
};

type SectionNavProps<T extends string = string> = {
  tabs: Array<SectionNavTab<T>>;
  activeTab?: T;
  className?: string;
  orientation?: "horizontal" | "vertical";
  onTabChange?: (tab: T) => void;
};

const baseClass =
  "inline-flex h-10 items-center gap-2 rounded-md border px-4 text-sm font-semibold transition";
const verticalBaseClass =
  "flex min-h-11 w-full items-center gap-3 rounded-md border px-4 text-left text-sm font-semibold transition";
const inactiveClass = "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50";
const activeClass = "border-red-700 bg-red-700 text-white";

export default function SectionNav<T extends string = string>({
  activeTab,
  className = "",
  orientation = "horizontal",
  tabs,
  onTabChange
}: SectionNavProps<T>) {
  const navClass = orientation === "vertical"
    ? `grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 ${className}`
    : `flex flex-wrap gap-2 border-b border-slate-200 pb-3 ${className}`;
  const itemClass = orientation === "vertical" ? verticalBaseClass : baseClass;

  return (
    <nav className={navClass} aria-label="Section navigation">
      {tabs.map((tab) => {
        const content = (
          <>
            {tab.icon}
            <span>{tab.label}</span>
          </>
        );

        if (tab.to) {
          return (
            <NavLink
              key={tab.id}
              className={({ isActive }) => `${itemClass} ${isActive ? activeClass : inactiveClass}`}
              end={tab.end}
              to={tab.to}
            >
              {content}
            </NavLink>
          );
        }

        return (
          <button
            key={tab.id}
            className={`${itemClass} ${activeTab === tab.id ? activeClass : inactiveClass}`}
            type="button"
            onClick={() => onTabChange?.(tab.id)}
          >
            {content}
          </button>
        );
      })}
    </nav>
  );
}
