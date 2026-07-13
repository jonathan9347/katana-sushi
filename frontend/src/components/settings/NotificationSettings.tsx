import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

const notificationItems = [
  "Email Notifications",
  "SMS Notifications",
  "Low Stock Alerts"
];

export default function NotificationSettings() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3 text-red-700">🔔
          <CardTitle className="ml-2">Notification Preferences</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {notificationItems.map((label) => (
            <label key={label} className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-red-700" />
              <span className="text-sm text-slate-700">{label}</span>
            </label>
          ))}
        </div>
        <div className="mt-6">
          <Button>Save Preferences</Button>
        </div>
      </CardContent>
    </Card>
  );
}
