import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import AdminDashboard from "../../components/dashboard/AdminDashboard";
import CashierDashboard from "../../components/dashboard/CashierDashboard";
import InventoryDashboard from "../../components/dashboard/InventoryDashboard";
import ReceptionDashboard from "../../components/dashboard/ReceptionDashboard";
import EventDashboard from "../../components/dashboard/EventDashboard";
import ChefDashboard from "../../components/dashboard/ChefDashboard";

export default function Dashboard() {
  const { user } = useAuth();
  const role = user?.role ?? "staff";
  const displayRole = role.replace("_", " ").toUpperCase();

  const dashboardComponent = {
    admin: <AdminDashboard />,
    inventory_manager: <InventoryDashboard />,
    cashier: <CashierDashboard />,
    receptionist: <ReceptionDashboard />,
    event_coordinator: <EventDashboard />,
    chef: <ChefDashboard />
  }[role as keyof Record<string, JSX.Element>] ?? <AdminDashboard />;

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 lg:px-8">
      <div className="mx-auto max-w-6xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-red-700">Staff Portal</p>
            <h1 className="mt-2 text-4xl font-black text-slate-950">Welcome back, {user?.name ?? "Staff"}</h1>
            <p className="mt-2 text-sm text-slate-600">
              Role: <span className="font-semibold uppercase text-slate-900">{displayRole}</span>
            </p>
          </div>
          <Link
            to="/staff/settings"
            className="inline-flex items-center rounded-full border border-red-700 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
          >
            Settings
          </Link>
        </div>

        <section className="grid gap-6">{dashboardComponent}</section>
      </div>
    </main>
  );
}
