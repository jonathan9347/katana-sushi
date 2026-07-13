import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export default function InventorySettings() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3 text-red-700">📦
          <CardTitle className="ml-2">Inventory Settings</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 lg:grid-cols-3">
          <label className="space-y-2 text-sm text-slate-700">
            <span>Reorder Level Default</span>
            <input className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3" defaultValue="10 units" />
          </label>
          <label className="space-y-2 text-sm text-slate-700">
            <span>Low Stock Alert Threshold</span>
            <input className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3" defaultValue="20%" />
          </label>
          <label className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-red-700" checked readOnly />
            <span className="text-sm text-slate-700">Auto-Reorder</span>
          </label>
        </div>
        <div className="mt-6">
          <Button>Save Inventory Settings</Button>
        </div>
      </CardContent>
    </Card>
  );
}
