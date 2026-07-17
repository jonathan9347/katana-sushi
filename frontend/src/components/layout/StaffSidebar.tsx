import {
  BarChart3,
  CalendarDays,
  CreditCard,
  DatabaseBackup,
  Home,
  Lock,
  LogOut,
  Package,
  PartyPopper,
  Settings,
  Shield,
  User,
  Users
} from "lucide-react";
import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";

type StaffRole = "admin" | "inventory_manager" | "cashier" | "receptionist" | "event_coordinator" | string;

type MenuItem = {
  label: string;
  to: string;
  icon: typeof Home;
  roles: string[];
};

const menuItems: MenuItem[] = [
  { label: "Dashboard", to: "/staff/dashboard", icon: Home, roles: ["admin", "inventory_manager", "cashier", "receptionist", "event_coordinator", "chef"] },
  { label: "Inventory", to: "/staff/inventory", icon: Package, roles: ["admin", "inventory_manager"] },
  { label: "POS", to: "/staff/pos", icon: CreditCard, roles: ["admin", "cashier"] },
  { label: "Dine-in", to: "/staff/reservations", icon: CalendarDays, roles: ["admin", "receptionist"] },
  { label: "Catering", to: "/staff/catering", icon: PartyPopper, roles: ["admin", "event_coordinator"] },
  { label: "Analytics", to: "/staff/analytics", icon: BarChart3, roles: ["admin", "inventory_manager"] },
  { label: "Settings", to: "/staff/settings", icon: Settings, roles: ["admin", "inventory_manager", "cashier", "receptionist", "event_coordinator", "chef"] }
];

const mobileItems = menuItems.slice(0, 5);

function canSee(item: { roles: string[] }, role: StaffRole) {
  return item.roles.includes(role);
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("katana_user") ?? "{}") as { name?: string; role?: string; email?: string };
  } catch {
    return {};
  }
}

function tooltipClass() {
  return "pointer-events-none absolute left-full top-1/2 z-[70] ml-2 -translate-y-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs font-bold text-white opacity-0 shadow-lg transition-opacity delay-200 group-hover:opacity-100";
}

function iconClass(isActive: boolean) {
  return `group relative flex h-12 w-full items-center justify-center rounded-md transition ${
    isActive ? "bg-red-700 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
  }`;
}

export default function StaffSidebar() {
  const [profileOpen, setProfileOpen] = useState(false);
  const navigate = useNavigate();
  const role = (localStorage.getItem("katana_role") ?? "staff").toLowerCase();
  const user = getStoredUser();
  const visibleItems = menuItems.filter((item) => canSee(item, role));
  const topItems = visibleItems.filter((item) => item.label !== "Settings");
  const bottomItems = visibleItems.filter((item) => item.label === "Settings");

  function logout() {
    localStorage.removeItem("katana_token");
    localStorage.removeItem("katana_role");
    localStorage.removeItem("katana_user");
    navigate("/staff/login");
  }

  return (
    <>
      <aside className="fixed left-4 top-1/2 z-40 hidden -translate-y-1/2 rounded-[2rem] border border-slate-200 bg-white/90 p-4 shadow-2xl backdrop-blur-md md:block">
        <div className="flex min-h-[420px] w-20 flex-col justify-between">
          <div className="space-y-3">
            <div className="flex h-14 items-center justify-center rounded-3xl border border-slate-200 bg-slate-50 text-center text-sm font-semibold text-slate-700">
              Staff
            </div>
            <nav className="space-y-2">
              {topItems.map((item) => {
                const Icon = item.icon;

                return (
                  <NavLink key={item.to} to={item.to} className={({ isActive }) => iconClass(isActive)}>
                    <Icon className="h-6 w-6" />
                    <span className={tooltipClass()}>{item.label}</span>
                  </NavLink>
                );
              })}
            </nav>
          </div>

          <div className="space-y-2">
            {bottomItems.map((item) => {
              const Icon = item.icon;

              return (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => iconClass(isActive)}>
                  <Icon className="h-6 w-6" />
                  <span className={tooltipClass()}>{item.label}</span>
                </NavLink>
              );
            })}

            <div className="relative w-full">
              <button onClick={() => setProfileOpen((current) => !current)} className="group relative flex h-12 w-full items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-950">
                <User className="h-6 w-6" />
                <span className={tooltipClass()}>Profile</span>
              </button>
              {profileOpen && (
                <div className="absolute left-full bottom-0 ml-3 w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-xl">
                  <div className="border-b border-slate-200 px-3 py-2">
                    <p className="truncate text-sm font-black text-slate-950">{user.name ?? "Staff User"}</p>
                    <p className="truncate text-xs text-slate-500">{role.replace("_", " ")}</p>
                  </div>
                  <button className="mt-2 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100">
                    <User className="h-4 w-4" /> My Profile
                  </button>
                  <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100">
                    <Shield className="h-4 w-4" /> Change Password
                  </button>
                  <button onClick={logout} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold text-red-700 hover:bg-red-50">
                    <LogOut className="h-4 w-4" /> Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>

      <nav className="fixed bottom-0 left-0 right-0 z-50 grid grid-cols-5 border-t border-slate-200 bg-white px-2 pb-2 pt-2 shadow-[0_-8px_20px_rgba(15,23,42,0.08)] md:hidden">
        {mobileItems.filter((item) => canSee(item, role)).map((item) => {
          const Icon = item.icon;

          return (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `flex min-h-14 flex-col items-center justify-center gap-1 rounded-md text-[11px] font-bold ${isActive ? "text-red-700" : "text-slate-600"}`}>
              <Icon className="h-5 w-5" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </>
  );
}

export function PlaceholderStaffPage({ title, icon: Icon = Lock }: { title: string; icon?: typeof Lock }) {
  return (
    <main className="min-h-screen bg-slate-100 p-6 pb-24 md:pl-24 lg:p-8 lg:pl-24">
      <section className="mx-auto max-w-5xl rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <Icon className="h-8 w-8 text-red-700" />
        <h1 className="mt-4 text-2xl font-black text-slate-950">{title}</h1>
        <p className="mt-2 text-sm text-slate-600">This category is reachable from the minimalist staff sidebar.</p>
      </section>
    </main>
  );
}

export { BarChart3, DatabaseBackup, Settings, Users };
