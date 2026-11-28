import { useState } from "react";
import { Activity, ShieldCheck, UsersRound } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { humanizeEnum } from "../../lib/display";
import { Tabs } from "../../components/ui/tabs";
import AdminSettings from "../../components/settings/AdminSettings";
import "./Settings.css";

type SettingsTab = "users" | "activity";

const settingsTabs = [
  { id: "users", label: "Users", icon: <UsersRound aria-hidden="true" size={17} /> },
  { id: "activity", label: "Activity log", icon: <Activity aria-hidden="true" size={17} /> }
];

export default function Settings() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<SettingsTab>("users");
  const displayRole = humanizeEnum(user?.role ?? "staff").toUpperCase();

  return (
    <main className="settings-page">
      <section className="settings-content">
        <header className="settings-banner">
          <svg className="settings-banner-wave" width="100%" height="100%" aria-hidden="true">
            <defs>
              <pattern id="settings-seigaiha" width="48" height="24" patternUnits="userSpaceOnUse">
                <path
                  d="M-24 24a24 24 0 0 1 48 0M0 24a24 24 0 0 1 48 0M24 24a24 24 0 0 1 48 0M-12 24a12 12 0 0 1 24 0M12 24a12 12 0 0 1 24 0M36 24a12 12 0 0 1 24 0"
                  fill="none"
                  stroke="white"
                  strokeOpacity=".14"
                  strokeWidth="1"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#settings-seigaiha)" />
          </svg>
          <span className="settings-banner-circle" aria-hidden="true" />
          <div className="settings-banner-copy">
            <p>ADMINISTRATION</p>
            <h1>Settings</h1>
            <span>Manage accounts, roles, and review what happened in the system.</span>
          </div>
          <div className="settings-banner-role">
            <ShieldCheck aria-hidden="true" size={17} />
            <span>{displayRole}</span>
          </div>
        </header>

        <Tabs
          tabs={settingsTabs}
          value={activeTab}
          onChange={(value) => setActiveTab(value as SettingsTab)}
          label="Settings sections"
          idPrefix="settings-tab"
          panelId="settings-tab-panel"
          className="settings-tabs"
        />

        <div
          id="settings-tab-panel"
          role="tabpanel"
          aria-labelledby={`settings-tab-${activeTab}`}
          className="settings-tabpanel"
        >
          <AdminSettings activeTab={activeTab} />
        </div>
      </section>
    </main>
  );
}
