import { FormEvent, useEffect, useState } from "react";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

const notificationItems = [
  { key: "email_notifications_enabled", label: "Email Notifications" },
  { key: "sms_notifications_enabled", label: "SMS Notifications" },
  { key: "low_stock_alerts_enabled", label: "Low Stock Alerts" }
] as const;

export default function NotificationSettings() {
  const { settings, saveSettings, isSaving } = useSystemSettings();
  const [form, setForm] = useState({
    email_notifications_enabled: settings.email_notifications_enabled,
    sms_notifications_enabled: settings.sms_notifications_enabled,
    low_stock_alerts_enabled: settings.low_stock_alerts_enabled
  });

  useEffect(() => {
    setForm({
      email_notifications_enabled: settings.email_notifications_enabled,
      sms_notifications_enabled: settings.sms_notifications_enabled,
      low_stock_alerts_enabled: settings.low_stock_alerts_enabled
    });
  }, [settings]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveSettings({ ...settings, ...form });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3 text-red-700">
          <span aria-hidden="true">Notifications</span>
          <CardTitle className="ml-2">Notification Preferences</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {notificationItems.map((item) => (
              <label key={item.key} className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-red-700"
                  checked={form[item.key]}
                  onChange={(event) => setForm((current) => ({ ...current, [item.key]: event.target.checked }))}
                />
                <span className="text-sm text-slate-700">{item.label}</span>
              </label>
            ))}
          </div>
          <div className="mt-6">
            <Button type="submit" disabled={isSaving}>Save Preferences</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
