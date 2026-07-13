import { useMemo } from "react";
import { useAuth } from "../../hooks/useAuth";
import ProfileSettings from "../../components/settings/ProfileSettings";
import PasswordSettings from "../../components/settings/PasswordSettings";
import NotificationSettings from "../../components/settings/NotificationSettings";
import AdminSettings from "../../components/settings/AdminSettings";
import InventorySettings from "../../components/settings/InventorySettings";
import PosSettings from "../../components/settings/PosSettings";
import ReservationSettings from "../../components/settings/ReservationSettings";
import CateringSettings from "../../components/settings/CateringSettings";

const sectionPermissions: Record<string, (role: string) => boolean> = {
  profile: () => true,
  password: () => true,
  notifications: () => true,
  adminSettings: (role) => role === "admin",
  inventorySettings: (role) => ["admin", "inventory_manager"].includes(role),
  posSettings: (role) => ["admin", "cashier"].includes(role),
  reservationSettings: (role) => ["admin", "receptionist"].includes(role),
  cateringSettings: (role) => ["admin", "event_coordinator"].includes(role)
};

export default function Settings() {
  const { user } = useAuth();
  const role = user?.role ?? "staff";
  const normalizedRole = role.toLowerCase();
  const displayRole = role.replace("_", " ").toUpperCase();

  const availableSections = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(sectionPermissions).map(([section, check]) => [section, check(normalizedRole)])
      ) as Record<
        | "profile"
        | "password"
        | "notifications"
        | "adminSettings"
        | "inventorySettings"
        | "posSettings"
        | "reservationSettings"
        | "cateringSettings",
        boolean
      >,
    [normalizedRole]
  );

  return (
    <main className="min-h-screen bg-slate-100 p-6 pb-24 md:pl-24 lg:p-8">
      <section className="mx-auto max-w-6xl space-y-6 rounded-3xl bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-red-700">Settings</p>
            <h1 className="mt-2 text-4xl font-black text-slate-950">Role-based settings</h1>
            <p className="mt-2 text-sm text-slate-600">Customize what matters most for your role: {displayRole}.</p>
          </div>
          <span className="inline-flex rounded-full bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 ring-1 ring-red-100">
            {displayRole}
          </span>
        </div>

        {availableSections.profile && <ProfileSettings name={user?.name} email={user?.email} role={displayRole} />}
        {availableSections.password && <PasswordSettings />}
        {availableSections.notifications && <NotificationSettings />}
        {availableSections.adminSettings && <AdminSettings />}
        {availableSections.inventorySettings && <InventorySettings />}
        {availableSections.posSettings && <PosSettings />}
        {availableSections.reservationSettings && <ReservationSettings />}
        {availableSections.cateringSettings && <CateringSettings />}
      </section>
    </main>
  );
}
