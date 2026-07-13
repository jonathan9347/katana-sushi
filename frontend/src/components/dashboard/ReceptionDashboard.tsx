import { DashboardWidget } from "./DashboardWidget";

export default function ReceptionDashboard() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-4 lg:grid-cols-2">
        <DashboardWidget title="Today's Guests" icon="👥" value={24} subtitle="Expected guest count" />
        <DashboardWidget title="Pending Approvals" icon="🕒" value={2} subtitle="Reservations awaiting confirmation" />
        <DashboardWidget title="Total Tables" icon="🍽️" value={10} subtitle="Tables available today" />
        <DashboardWidget title="Walk-ins" icon="🚶" value={3} subtitle="Guests without reservations" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <DashboardWidget title="Today's Reservations" icon="📅" value="" subtitle="Upcoming table bookings">
          <ul className="space-y-3 text-sm text-slate-700">
            <li>• 7:00 PM John – 4 guests</li>
            <li>• 7:30 PM Maria – 2 guests</li>
            <li>• 8:00 PM Pedro – 6 guests</li>
          </ul>
        </DashboardWidget>

        <DashboardWidget title="Pending Approvals" icon="⏳" value="" subtitle="Need your attention">
          <ul className="space-y-3 text-sm text-slate-700">
            <li>• Maria – 7:30 PM – 2 guests</li>
            <li>• Pedro – 8:00 PM – 6 guests</li>
          </ul>
        </DashboardWidget>
      </div>
    </div>
  );
}
