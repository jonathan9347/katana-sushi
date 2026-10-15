import { FormEvent, useEffect, useState } from "react";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export default function CateringSettings() {
  const { settings, saveSettings, isSaving } = useSystemSettings();
  const [form, setForm] = useState({
    auto_lock_catering_ingredients: settings.auto_lock_catering_ingredients,
    release_catering_locks_on_completion: settings.release_catering_locks_on_completion
  });

  useEffect(() => {
    setForm({
      auto_lock_catering_ingredients: settings.auto_lock_catering_ingredients,
      release_catering_locks_on_completion: settings.release_catering_locks_on_completion
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
          <span aria-hidden="true">Catering</span>
          <CardTitle className="ml-2">Catering Settings</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <div className="grid gap-4 lg:grid-cols-2">
            <Toggle label="Auto-Lock Ingredients" checked={form.auto_lock_catering_ingredients} onChange={(checked) => setForm((current) => ({ ...current, auto_lock_catering_ingredients: checked }))} />
            <Toggle label="Release Locks After Event" checked={form.release_catering_locks_on_completion} onChange={(checked) => setForm((current) => ({ ...current, release_catering_locks_on_completion: checked }))} />
          </div>
          <div className="mt-6">
            <Button disabled={isSaving}>Save Catering Settings</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
      <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-red-700" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="text-sm text-slate-700">{label}</span>
    </label>
  );
}
