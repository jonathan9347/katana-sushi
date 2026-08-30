import { FormEvent, useEffect, useState } from "react";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export default function PosSettings() {
  const { settings, saveSettings, isSaving } = useSystemSettings();
  const [form, setForm] = useState({
    tax_rate_percent: String(settings.tax_rate_percent),
    receipt_footer: settings.receipt_footer,
    receipt_paper_size: settings.receipt_paper_size
  });

  useEffect(() => {
    setForm({
      tax_rate_percent: String(settings.tax_rate_percent),
      receipt_footer: settings.receipt_footer,
      receipt_paper_size: settings.receipt_paper_size
    });
  }, [settings]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveSettings({ ...settings, ...form, tax_rate_percent: Number(form.tax_rate_percent) });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3 text-red-700">
          <span aria-hidden="true">POS</span>
          <CardTitle className="ml-2">POS Settings</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <div className="grid gap-4 lg:grid-cols-3">
            <label className="space-y-2 text-sm text-slate-700">
              <span>Default Tax Rate</span>
              <input className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3" min="0" max="100" step="0.01" type="number" value={form.tax_rate_percent} onChange={(event) => setForm((current) => ({ ...current, tax_rate_percent: event.target.value }))} />
            </label>
            <label className="space-y-2 text-sm text-slate-700">
              <span>Receipt Footer</span>
              <input className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3" value={form.receipt_footer} onChange={(event) => setForm((current) => ({ ...current, receipt_footer: event.target.value }))} />
            </label>
            <label className="space-y-2 text-sm text-slate-700">
              <span>Receipt Paper Size</span>
              <select className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3" value={form.receipt_paper_size} onChange={(event) => setForm((current) => ({ ...current, receipt_paper_size: event.target.value }))}>
                <option value="58mm">58mm</option>
                <option value="80mm">80mm</option>
                <option value="A4">A4</option>
              </select>
            </label>
          </div>
          <div className="mt-6">
            <Button type="submit" disabled={isSaving}>Save POS Settings</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
