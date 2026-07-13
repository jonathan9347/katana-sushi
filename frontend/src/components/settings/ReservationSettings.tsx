import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export default function ReservationSettings() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3 text-red-700">📅
          <CardTitle className="ml-2">Reservation Settings</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="space-y-2 text-sm text-slate-700">
            <span>Max Party Size</span>
            <input className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3" defaultValue="20" />
          </label>
          <label className="space-y-2 text-sm text-slate-700">
            <span>Default Reservation Duration</span>
            <input className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3" defaultValue="90 minutes" />
          </label>
          <label className="space-y-2 text-sm text-slate-700">
            <span>Grace Period</span>
            <input className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3" defaultValue="15 minutes" />
          </label>
          <label className="space-y-2 text-sm text-slate-700">
            <span>Minimum Catering Pax</span>
            <input className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3" defaultValue="10" />
          </label>
        </div>
        <div className="mt-6">
          <Button>Save Reservation Settings</Button>
        </div>
      </CardContent>
    </Card>
  );
}
