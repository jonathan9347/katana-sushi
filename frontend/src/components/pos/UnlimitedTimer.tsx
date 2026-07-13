import { useEffect, useMemo, useState } from "react";

type UnlimitedTimerProps = {
  firstRoundAt?: string | null;
  endsAt: string;
};

export default function UnlimitedTimer({ firstRoundAt, endsAt }: UnlimitedTimerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const remaining = useMemo(() => Math.max(new Date(endsAt).getTime() - now, 0), [endsAt, now]);
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  if (!firstRoundAt) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
        Timer starts after first round
      </div>
    );
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 text-center">
      <p className="text-xs font-semibold uppercase text-slate-500">Time Remaining</p>
      <p className="mt-1 text-2xl font-semibold text-slate-950">
        {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
      </p>
    </div>
  );
}
