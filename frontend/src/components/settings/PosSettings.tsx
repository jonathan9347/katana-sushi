import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export default function PosSettings() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3 text-red-700">💳
          <CardTitle className="ml-2">POS Settings</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 lg:grid-cols-3">
          <label className="space-y-2 text-sm text-slate-700">
            <span>Default Tax Rate</span>
            <input className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3" defaultValue="12%" />
          </label>
          <label className="space-y-2 text-sm text-slate-700">
            <span>Receipt Footer</span>
            <input className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3" defaultValue="Thank you for dining with us!" />
          </label>
          <label className="space-y-2 text-sm text-slate-700">
            <span>Receipt Paper Size</span>
            <input className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3" defaultValue="80mm" />
          </label>
        </div>
        <div className="mt-6">
          <Button>Save POS Settings</Button>
        </div>
      </CardContent>
    </Card>
  );
}
