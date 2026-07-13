import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export default function ProfileSettings({ name, email, role }: { name?: string; email?: string; role?: string }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3 text-red-700">👤
          <CardTitle className="ml-2">Profile Settings</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Name</p>
            <p className="mt-2 text-sm text-slate-900">{name ?? "–"}</p>
          </div>
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Email</p>
            <p className="mt-2 text-sm text-slate-900">{email ?? "–"}</p>
          </div>
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Role</p>
            <p className="mt-2 text-sm text-slate-900">{role ?? "–"}</p>
          </div>
        </div>
        <div className="mt-6">
          <Button variant="outline">Update Profile</Button>
        </div>
      </CardContent>
    </Card>
  );
}
