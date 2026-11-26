import { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  CreditCard,
  Home,
  LogOut,
  Package,
  Settings,
  UserRound,
  type LucideIcon
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import "./Sidebar.css";

type SidebarProps = {
  role: string;
  hidden: boolean;
  onToggle: () => void;
};

type SidebarItem = {
  label: string;
  to: string;
  icon: LucideIcon;
  roles: string[];
  animation: "dashboard" | "inventory" | "payments" | "reservations" | "reports" | "settings";
};

const mainItems: SidebarItem[] = [
  {
    label: "Dashboard",
    to: "/staff/dashboard",
    icon: Home,
    roles: ["admin", "inventory_manager", "cashier", "receptionist", "event_coordinator", "chef"],
    animation: "dashboard"
  },
  {
    label: "Inventory",
    to: "/staff/inventory",
    icon: Package,
    roles: ["admin", "inventory_manager"],
    animation: "inventory"
  },
  {
    label: "Payments",
    to: "/staff/pos",
    icon: CreditCard,
    roles: ["admin", "cashier"],
    animation: "payments"
  },
  {
    label: "Reservations",
    to: "/staff/reservations",
    icon: CalendarDays,
    roles: ["admin", "cashier", "receptionist", "event_coordinator", "chef"],
    animation: "reservations"
  },
  {
    label: "Reports",
    to: "/staff/analytics",
    icon: BarChart3,
    roles: ["admin"],
    animation: "reports"
  }
];

const settingsItem: SidebarItem = {
  label: "Settings",
  to: "/staff/settings",
  icon: Settings,
  roles: ["admin"],
  animation: "settings"
};

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("katana_user") ?? "{}") as {
      name?: string;
      role?: string;
    };
  } catch {
    return {};
  }
}

function ReportsIcon() {
  return (
    <svg className="sidebar-icon sidebar-icon--reports" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20.5h16" />
      <rect className="sidebar-bar sidebar-bar--first" x="6" y="12" width="3" height="7" rx="0.5" />
      <rect className="sidebar-bar sidebar-bar--second" x="10.5" y="8" width="3" height="11" rx="0.5" />
      <rect className="sidebar-bar sidebar-bar--third" x="15" y="4" width="3" height="15" rx="0.5" />
    </svg>
  );
}

export default function Sidebar({ role, hidden, onToggle }: SidebarProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const navigate = useNavigate();
  const normalizedRole = role.toLowerCase();
  const user = getStoredUser();
  const visibleMainItems = mainItems.filter((item) => item.roles.includes(normalizedRole));
  const showSettings = settingsItem.roles.includes(normalizedRole);
  const displayRole = normalizedRole === "staff" ? "Team member" : normalizedRole.replace("_", " ");

  const setSidebarRef = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    if (hidden) {
      element.setAttribute("inert", "");
    } else {
      element.removeAttribute("inert");
    }
  }, [hidden]);

  useEffect(() => {
    if (hidden) setProfileOpen(false);
  }, [hidden]);

  async function logout() {
    try {
      await api.post("/api/auth/logout");
    } catch (error) {
      console.error("Staff logout could not be recorded", error);
    }

    localStorage.removeItem("katana_token");
    localStorage.removeItem("katana_role");
    localStorage.removeItem("katana_user");
    navigate("/staff/login");
  }

  function renderItem(item: SidebarItem) {
    const Icon = item.icon;
    const isReports = item.label === "Reports";

    return (
      <NavLink
        key={item.to}
        to={item.to}
        aria-label={item.label}
        className={({ isActive }) =>
          `sidebar-link sidebar-link--${item.animation}${isActive ? " is-active" : ""}`
        }
      >
        {isReports
          ? <ReportsIcon />
          : <Icon className="sidebar-icon" aria-hidden="true" strokeWidth={1.8} />}
      </NavLink>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`sidebar-toggle${hidden ? " is-hidden" : ""}`}
        aria-label={hidden ? "Show menu" : "Hide menu"}
        aria-expanded={!hidden}
        aria-controls="staff-navigation-rail"
        onClick={onToggle}
      >
        <img src="/images/katana-logo.jpg" alt="" aria-hidden="true" />
        <span className="sidebar-toggle-badge" aria-hidden="true">
          <ChevronLeft />
        </span>
      </button>

      <aside
        ref={setSidebarRef}
        id="staff-navigation-rail"
        className={`sidebar-rail${hidden ? " is-hidden" : ""}`}
        aria-hidden={hidden}
      >
        <div className="sidebar-decoration" aria-hidden="true">
          <svg width="100%" height="100%">
            <defs>
              <pattern id="sidebar-seigaiha" width="48" height="24" patternUnits="userSpaceOnUse">
                <path
                  d="M-24 24a24 24 0 0 1 48 0M0 24a24 24 0 0 1 48 0M24 24a24 24 0 0 1 48 0M-12 24a12 12 0 0 1 24 0M12 24a12 12 0 0 1 24 0M36 24a12 12 0 0 1 24 0"
                  fill="none"
                  stroke="white"
                  strokeOpacity=".11"
                  strokeWidth="1"
                />
              </pattern>
              <linearGradient id="sidebar-wave-fade" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="white" stopOpacity=".9" />
                <stop offset="58%" stopColor="white" stopOpacity=".65" />
                <stop offset="100%" stopColor="white" stopOpacity=".12" />
              </linearGradient>
              <mask id="sidebar-wave-mask">
                <rect width="100%" height="100%" fill="url(#sidebar-wave-fade)" />
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="url(#sidebar-seigaiha)" mask="url(#sidebar-wave-mask)" />
          </svg>
          <span />
        </div>

        <nav className="sidebar-nav" aria-label="Main">
          <div className="sidebar-nav-group">
            {visibleMainItems.map(renderItem)}
          </div>

          <div className="sidebar-bottom-group">
            {showSettings && renderItem(settingsItem)}
            {showSettings && <span className="sidebar-divider" aria-hidden="true" />}
            <div className="sidebar-profile">
              <button
                type="button"
                className="sidebar-link sidebar-profile-button"
                aria-label="Profile"
                aria-expanded={profileOpen}
                aria-controls="sidebar-profile-menu"
                onClick={() => setProfileOpen((current) => !current)}
              >
                <UserRound className="sidebar-icon" aria-hidden="true" strokeWidth={1.8} />
              </button>
              {profileOpen && (
                <div className="sidebar-profile-menu" id="sidebar-profile-menu">
                  <div className="sidebar-profile-summary">
                    <p>{user.name ?? "User"}</p>
                    <span>{displayRole}</span>
                  </div>
                  <button type="button" className="sidebar-logout" onClick={logout}>
                    <LogOut aria-hidden="true" />
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </nav>
      </aside>
    </>
  );
}
