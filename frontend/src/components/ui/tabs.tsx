import { useRef, type ButtonHTMLAttributes, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";

export type TabItem = {
  id: string;
  label: string;
  icon?: ReactNode;
};

type TabsProps = {
  tabs: TabItem[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  idPrefix: string;
  panelId: string;
  className?: string;
};

export function Tabs({ tabs, value, onChange, label, idPrefix, panelId, className = "" }: TabsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, tabs.findIndex((tab) => tab.id === value));

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    onChange(tabs[nextIndex].id);
    refs.current[nextIndex]?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className={className}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(element) => { refs.current[index] = element; }}
          type="button"
          role="tab"
          id={`${idPrefix}-${tab.id}`}
          aria-selected={value === tab.id}
          aria-controls={panelId}
          tabIndex={selectedIndex === index ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

export function TabsList({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`flex flex-wrap gap-2 border-b border-slate-200 pb-3 ${className}`} {...props} />;
}

type TabsTriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
};

export function TabsTrigger({ active, className = "", ...props }: TabsTriggerProps) {
  return (
    <button
      className={`rounded-md border px-3 py-2 text-sm font-medium transition ${
        active
          ? "border-red-700 bg-red-700 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      } ${className}`}
      {...props}
    />
  );
}
