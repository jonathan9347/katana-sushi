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
  onTabChange?: (tab: T) => void;
};

const baseClass =
  "inline-flex h-10 items-center gap-2 rounded-md border px-4 text-sm font-semibold transition";
const inactiveClass = "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50";
const activeClass = "border-red-700 bg-red-700 text-white";

export default function SectionNav<T extends string = string>({
  activeTab,
  className = "",
  tabs,
  onTabChange
}: SectionNavProps<T>) {
  return (
    <nav className={`flex flex-wrap gap-2 border-b border-slate-200 pb-3 ${className}`} aria-label="Section navigation">
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
              className={({ isActive }) => `${baseClass} ${isActive ? activeClass : inactiveClass}`}
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
            className={`${baseClass} ${activeTab === tab.id ? activeClass : inactiveClass}`}
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
