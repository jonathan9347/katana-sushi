import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export default function PasswordSettings() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3 text-red-700">🔒
          <CardTitle className="ml-2">Change Password</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 lg:grid-cols-3">
          <label className="space-y-2 text-sm text-slate-700">
            <span>Current Password</span>
            <input type="password" className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100" />
          </label>
          <label className="space-y-2 text-sm text-slate-700">
            <span>New Password</span>
            <input type="password" className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100" />
          </label>
          <label className="space-y-2 text-sm text-slate-700">
            <span>Confirm Password</span>
            <input type="password" className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100" />
          </label>
        </form>
        <div className="mt-6">
          <Button>Change Password</Button>
        </div>
      </CardContent>
    </Card>
  );
}
