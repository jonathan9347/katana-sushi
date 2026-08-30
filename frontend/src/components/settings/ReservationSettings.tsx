import { FormEvent, useEffect, useState } from "react";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export default function ReservationSettings() {
  const { settings, saveSettings, isSaving } = useSystemSettings();
  const [form, setForm] = useState({
    max_party_size: String(settings.max_party_size),
    reservation_duration_minutes: String(settings.reservation_duration_minutes),
    reservation_grace_period_minutes: String(settings.reservation_grace_period_minutes),
    minimum_catering_pax: String(settings.minimum_catering_pax)
  });

  useEffect(() => {
    setForm({
      max_party_size: String(settings.max_party_size),
      reservation_duration_minutes: String(settings.reservation_duration_minutes),
      reservation_grace_period_minutes: String(settings.reservation_grace_period_minutes),
      minimum_catering_pax: String(settings.minimum_catering_pax)
    });
  }, [settings]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveSettings({
      ...settings,
      max_party_size: Number(form.max_party_size),
      reservation_duration_minutes: Number(form.reservation_duration_minutes),
      reservation_grace_period_minutes: Number(form.reservation_grace_period_minutes),
      minimum_catering_pax: Number(form.minimum_catering_pax)
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3 text-red-700">
          <span aria-hidden="true">Calendar</span>
          <CardTitle className="ml-2">Reservation Settings</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <div className="grid gap-4 lg:grid-cols-2">
            <NumberField label="Max Party Size" value={form.max_party_size} onChange={(value) => setForm((current) => ({ ...current, max_party_size: value }))} />
            <NumberField label="Default Reservation Duration" value={form.reservation_duration_minutes} onChange={(value) => setForm((current) => ({ ...current, reservation_duration_minutes: value }))} />
            <NumberField label="Grace Period" value={form.reservation_grace_period_minutes} onChange={(value) => setForm((current) => ({ ...current, reservation_grace_period_minutes: value }))} />
            <NumberField label="Minimum Catering Pax" value={form.minimum_catering_pax} onChange={(value) => setForm((current) => ({ ...current, minimum_catering_pax: value }))} />
          </div>
          <div className="mt-6">
            <Button type="submit" disabled={isSaving}>Save Reservation Settings</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-2 text-sm text-slate-700">
      <span>{label}</span>
      <input className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3" min="0" type="number" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
