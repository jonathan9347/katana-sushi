import { FormEvent, useEffect, useState } from "react";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export default function AdminSettings() {
  const { settings, saveSettings, isSaving } = useSystemSettings();
  const [form, setForm] = useState({
    restaurant_name: settings.restaurant_name,
    timezone: settings.timezone,
    currency: settings.currency,
    tax_rate_percent: String(settings.tax_rate_percent)
  });

  useEffect(() => {
    setForm({
      restaurant_name: settings.restaurant_name,
      timezone: settings.timezone,
      currency: settings.currency,
      tax_rate_percent: String(settings.tax_rate_percent)
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
          <span aria-hidden="true">Settings</span>
          <CardTitle className="ml-2">Admin Settings</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold text-slate-900">User Management</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Button type="button" variant="outline">View All Users</Button>
                <Button type="button" variant="outline">Add New User</Button>
                <Button type="button" variant="outline">Manage Roles</Button>
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">System Settings</p>
              <div className="mt-3 grid gap-4">
                <label className="space-y-2 text-sm text-slate-700">
                  <span>Restaurant Name</span>
                  <input className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3" value={form.restaurant_name} onChange={(event) => setForm((current) => ({ ...current, restaurant_name: event.target.value }))} />
                </label>
                <label className="space-y-2 text-sm text-slate-700">
                  <span>Timezone</span>
                  <input className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3" value={form.timezone} onChange={(event) => setForm((current) => ({ ...current, timezone: event.target.value }))} />
                </label>
                <label className="space-y-2 text-sm text-slate-700">
                  <span>Tax Rate</span>
                  <input className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3" min="0" max="100" step="0.01" type="number" value={form.tax_rate_percent} onChange={(event) => setForm((current) => ({ ...current, tax_rate_percent: event.target.value }))} />
                </label>
                <label className="space-y-2 text-sm text-slate-700">
                  <span>Currency</span>
                  <input className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 uppercase" maxLength={8} value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} />
                </label>
              </div>
            </div>
          </div>
          <div className="mt-6">
            <Button type="submit" disabled={isSaving}>Save Admin Settings</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
