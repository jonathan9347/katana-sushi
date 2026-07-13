type DashboardWidgetProps = {
  title: string;
  icon: string;
  value: string | number;
  subtitle?: string;
  color?: "red" | "green" | "blue" | "yellow" | "gray";
  onClick?: () => void;
  children?: React.ReactNode;
};

const colorClasses: Record<NonNullable<DashboardWidgetProps["color"]>, string> = {
  red: "border-red-600 bg-red-50",
  green: "border-green-600 bg-green-50",
  blue: "border-blue-600 bg-blue-50",
  yellow: "border-yellow-600 bg-yellow-50",
  gray: "border-gray-600 bg-gray-50"
};

export function DashboardWidget({
  title,
  icon,
  value,
  subtitle,
  color = "red",
  onClick,
  children
}: DashboardWidgetProps) {
  const containerClass = `${colorClasses[color]} rounded-3xl border p-6 shadow-sm transition hover:shadow-lg ${onClick ? "cursor-pointer" : ""}`;

    const containerProps = {
    className: containerClass
  };

  const content = (
    <>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-600">{title}</p>
          <p className="mt-3 text-3xl font-extrabold text-slate-950">{value}</p>
          {subtitle && <p className="mt-2 text-sm text-slate-600">{subtitle}</p>}
        </div>
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm">{icon}</div>
      </div>
      {children ? <div className="mt-6">{children}</div> : null}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} {...containerProps}>
        {content}
      </button>
    );
  }

  return <div {...containerProps}>{content}</div>;
}
