import { DashboardWidget } from "./DashboardWidget";

export default function EventDashboard() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-4 lg:grid-cols-2">
        <DashboardWidget title="Upcoming Events" icon="🎉" value={3} subtitle="Scheduled catering events" />
        <DashboardWidget title="Active Events" icon="🎪" value={1} subtitle="Events in progress" />
        <DashboardWidget title="Locked Items" icon="🔒" value={8} subtitle="Ingredients reserved for events" />
        <DashboardWidget title="Pending Inquiries" icon="📩" value={2} subtitle="New catering requests" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <DashboardWidget title="Upcoming Events" icon="🎉" value="" subtitle="Event schedule summary">
          <ul className="space-y-3 text-sm text-slate-700">
            <li>• Wedding – June 25 (100 pax)</li>
            <li>• Birthday – June 20 (50 pax)</li>
            <li>• Corporate – June 30 (80 pax)</li>
          </ul>
        </DashboardWidget>

        <DashboardWidget title="Ingredient Locks" icon="🔒" value="" subtitle="Current lock assignments">
          <ul className="space-y-3 text-sm text-slate-700">
            <li>• Rice: 20kg (Wedding)</li>
            <li>• Salmon: 10kg (Wedding)</li>
            <li>• Nori: 200 sheets (Wedding)</li>
          </ul>
        </DashboardWidget>
      </div>
    </div>
  );
}
