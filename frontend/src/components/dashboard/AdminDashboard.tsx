import { Link } from "react-router-dom";
import { DashboardWidget } from "./DashboardWidget";

export default function AdminDashboard() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-4 lg:grid-cols-2">
        <DashboardWidget title="Today's Sales" icon="💰" value="₱15,240" subtitle="Total revenue for today" />
        <DashboardWidget title="Pending Approvals" icon="🕒" value={4} subtitle="Open reservation and event requests" />
        <DashboardWidget title="Low Stock Alerts" icon="⚠️" value={3} subtitle="Materials need restocking" />
        <DashboardWidget title="Upcoming Events" icon="🎉" value={2} subtitle="Catering events scheduled" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <DashboardWidget title="Recent Sales" icon="📈" value="" subtitle="Latest completed transactions">
          <ul className="space-y-3 text-sm text-slate-700">
            <li>• #KTN-001 ₱1,450</li>
            <li>• #KTN-002 ₱890</li>
            <li>• #KTN-003 ₱2,396</li>
          </ul>
        </DashboardWidget>

        <DashboardWidget title="Inventory Alerts" icon="📦" value="" subtitle="Stock levels to review">
          <ul className="space-y-3 text-sm text-slate-700">
            <li>• Rice – 5kg left (reorder)</li>
            <li>• Salmon – 3kg left (critical)</li>
            <li>• Nori – 50 sheets left</li>
          </ul>
        </DashboardWidget>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-red-700">Quick Actions</p>
            <p className="mt-1 text-sm text-slate-500">Jump to common workflows.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "POS", path: "/staff/pos" },
            { label: "Inventory", path: "/staff/inventory" },
            { label: "Reservations", path: "/staff/reservations" },
            { label: "Catering", path: "/staff/catering" },
            { label: "Users", path: "/staff/admin" },
            { label: "Settings", path: "/staff/settings" }
          ].map((action) => (
            <Link
              key={action.label}
              to={action.path}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-sm font-semibold text-slate-900 transition hover:border-red-700 hover:bg-white"
            >
              {action.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
