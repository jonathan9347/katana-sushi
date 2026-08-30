import { FormEvent, useEffect, useState } from "react";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export default function InventorySettings() {
  const { settings, saveSettings, isSaving } = useSystemSettings();
  const [form, setForm] = useState({
    default_reorder_level: String(settings.default_reorder_level),
    low_stock_threshold_percent: String(settings.low_stock_threshold_percent),
    auto_reorder_enabled: settings.auto_reorder_enabled
  });

  useEffect(() => {
    setForm({
      default_reorder_level: String(settings.default_reorder_level),
      low_stock_threshold_percent: String(settings.low_stock_threshold_percent),
      auto_reorder_enabled: settings.auto_reorder_enabled
    });
  }, [settings]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveSettings({
      ...settings,
      default_reorder_level: Number(form.default_reorder_level),
      low_stock_threshold_percent: Number(form.low_stock_threshold_percent),
      auto_reorder_enabled: form.auto_reorder_enabled
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3 text-red-700">
          <span aria-hidden="true">Inventory</span>
          <CardTitle className="ml-2">Inventory Settings</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <div className="grid gap-4 lg:grid-cols-3">
            <label className="space-y-2 text-sm text-slate-700">
              <span>Reorder Level Default</span>
              <input className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3" min="0" step="0.001" type="number" value={form.default_reorder_level} onChange={(event) => setForm((current) => ({ ...current, default_reorder_level: event.target.value }))} />
            </label>
            <label className="space-y-2 text-sm text-slate-700">
              <span>Low Stock Alert Threshold</span>
              <input className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3" min="0" max="500" step="0.01" type="number" value={form.low_stock_threshold_percent} onChange={(event) => setForm((current) => ({ ...current, low_stock_threshold_percent: event.target.value }))} />
            </label>
            <label className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-red-700" checked={form.auto_reorder_enabled} onChange={(event) => setForm((current) => ({ ...current, auto_reorder_enabled: event.target.checked }))} />
              <span className="text-sm text-slate-700">Auto-Reorder</span>
            </label>
          </div>
          <div className="mt-6">
            <Button type="submit" disabled={isSaving}>Save Inventory Settings</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
