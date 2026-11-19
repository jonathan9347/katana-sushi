import { useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import AdminSettings from "../../components/settings/AdminSettings";

type SettingsTab = "users" | "activity";

export default function Settings() {
  const { user } = useAuth();
  const role = user?.role ?? "staff";
  const displayRole = role.replace("_", " ").toUpperCase();
  const [activeTab, setActiveTab] = useState<SettingsTab>("users");

  return (
    <main className="min-h-screen bg-slate-100 p-6 pb-24 md:pl-24 lg:p-8">
      <section className="mx-auto max-w-6xl space-y-6">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 pb-5">
          <h1 className="text-2xl font-bold text-slate-950">Settings</h1>
          <span className="inline-flex rounded-full bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700 ring-1 ring-red-100">
            {displayRole}
          </span>
        </header>

        <div role="tablist" aria-label="Settings sections" className="flex gap-6 border-b border-slate-200">
          <button
            id="settings-tab-users"
            type="button"
            role="tab"
            aria-selected={activeTab === "users"}
            aria-controls="settings-tab-panel"
            onClick={() => setActiveTab("users")}
            className={`border-b-2 px-1 pb-3 text-sm font-semibold ${
              activeTab === "users" ? "border-red-700 text-red-700" : "border-transparent text-slate-600 hover:text-slate-950"
            }`}
          >
            Users
          </button>
          <button
            id="settings-tab-activity"
            type="button"
            role="tab"
            aria-selected={activeTab === "activity"}
            aria-controls="settings-tab-panel"
            onClick={() => setActiveTab("activity")}
            className={`border-b-2 px-1 pb-3 text-sm font-semibold ${
              activeTab === "activity" ? "border-red-700 text-red-700" : "border-transparent text-slate-600 hover:text-slate-950"
            }`}
          >
            Activity log
          </button>
        </div>

        <div id="settings-tab-panel" role="tabpanel" aria-labelledby={`settings-tab-${activeTab}`}>
          <AdminSettings activeTab={activeTab} />
        </div>
      </section>
    </main>
  );
}
