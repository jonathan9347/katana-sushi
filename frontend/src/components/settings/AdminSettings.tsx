import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export default function AdminSettings() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3 text-red-700">🔧
          <CardTitle className="ml-2">Admin Settings</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <p className="text-sm font-semibold text-slate-900">User Management</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Button variant="outline">View All Users</Button>
              <Button variant="outline">Add New User</Button>
              <Button variant="outline">Manage Roles</Button>
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">System Settings</p>
            <div className="mt-3 grid gap-4">
              <label className="space-y-2 text-sm text-slate-700">
                <span>Restaurant Name</span>
                <input className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3" defaultValue="Katana Sushi" />
              </label>
              <label className="space-y-2 text-sm text-slate-700">
                <span>Timezone</span>
                <input className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3" defaultValue="Asia/Manila" />
              </label>
              <label className="space-y-2 text-sm text-slate-700">
                <span>Tax Rate</span>
                <input className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3" defaultValue="12%" />
              </label>
              <label className="space-y-2 text-sm text-slate-700">
                <span>Currency</span>
                <input className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3" defaultValue="PHP" />
              </label>
            </div>
          </div>
        </div>
        <div className="mt-6">
          <Button>Save Admin Settings</Button>
        </div>
      </CardContent>
    </Card>
  );
}
