import { ButtonHTMLAttributes, HTMLAttributes } from "react";

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
