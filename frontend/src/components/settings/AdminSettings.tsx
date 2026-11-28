import { useId, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  BookOpen,
  Box,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Mail,
  PencilLine,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  UserRound,
  X,
  type LucideIcon
} from "lucide-react";
import { useToast } from "../../hooks/useToast";
import { fetchActivityLogs, type ActivityLogItem } from "../../lib/activityLogs";
import {
  createStaffUser,
  fetchStaffUsers,
  resetStaffUserPassword,
  updateStaffUser,
  type StaffUser
} from "../../lib/adminUsers";
import { describeActivity, formatDate, formatDateTime, formatTime, humanizeEnum, type ActivityDescription } from "../../lib/display";
import { getApiErrorMessage } from "../../lib/errors";
import { Chip } from "../ui/Chip";
import { Drawer } from "../ui/Drawer";
import "./AdminSettings.css";

const staffRoles = ["admin", "inventory_manager", "receptionist", "chef", "cashier", "event_coordinator", "staff"];

const roleColors: Record<string, { background: string; color: string }> = {
  admin: { background: "#9B1D20", color: "#FFFFFF" },
  inventory_manager: { background: "#EFE9FB", color: "#5B3FA8" },
  receptionist: { background: "#FBEAEA", color: "#8A1719" },
  chef: { background: "#FDF1D9", color: "#6E4500" },
  cashier: { background: "#E1F4EA", color: "#14633A" },
  event_coordinator: { background: "#EAF1FB", color: "#2A5DB0" }
};

const categoryIcons: Record<ActivityDescription["icon"], LucideIcon> = {
  book: BookOpen,
  box: Box,
  clipboard: ClipboardList,
  calendar: CalendarDays,
  package: Box,
  user: UserRound,
  settings: Settings,
  activity: Activity
};

function formatRole(role: string) {
  return humanizeEnum(role);
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "S";
}

function RoleAvatar({ name, role }: { name: string; role: string }) {
  const colors = roleColors[role] ?? { background: "#EEF0F5", color: "#3B4254" };
  return (
    <span className="settings-avatar" style={{ backgroundColor: colors.background, color: colors.color }} aria-hidden="true">
      {getInitials(name)}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  const colors = roleColors[role] ?? { background: "#EEF0F5", color: "#3B4254" };
  return (
    <span className={`settings-role-badge${role === "admin" ? " is-admin" : ""}`} style={{ backgroundColor: colors.background, color: colors.color }}>
      {formatRole(role)}
    </span>
  );
}

function ActivityEntry({ log, description }: { log: ActivityLogItem; description: ActivityDescription }) {
  const Icon = categoryIcons[description.icon];
  const avatarRole = log.actor_role ?? "staff";
  return (
    <article className={`settings-activity-entry tone-${description.tone}`}>
      <RoleAvatar name={description.actor} role={avatarRole} />
      <div className="settings-activity-copy">
        <p>
          <strong>{description.actor}</strong>{" "}
          {description.phrase}{" "}
          {description.target && <strong>{description.target}</strong>}
        </p>
        <span>{log.actor_role ? formatRole(log.actor_role) : "System"}</span>
      </div>
      <div className="settings-activity-meta">
        <span className={`settings-category-pill tone-${description.tone}`}>
          <Icon aria-hidden="true" size={14} />
          {description.category}
        </span>
        <time dateTime={log.created_at} title={formatDateTime(log.created_at)}>
          {formatTime(log.created_at)}
        </time>
      </div>
    </article>
  );
}

function groupByDay(entries: Array<{ log: ActivityLogItem; description: ActivityDescription }>) {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(today);
  const yesterdayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(yesterday);
  const groups = new Map<string, { label: string; entries: typeof entries }>();

  for (const entry of entries) {
    const key = entry.description.dayKey;
    const relative = key === todayKey ? "TODAY" : key === yesterdayKey ? "YESTERDAY" : "";
    const dateLabel = formatDate(entry.log.created_at).replace(/,\s*\d{4}$/, "");
    const label = relative ? `${relative} · ${dateLabel}` : dateLabel;
    if (!groups.has(key)) groups.set(key, { label, entries: [] });
    groups.get(key)?.entries.push(entry);
  }

  return Array.from(groups.entries()).map(([key, group]) => ({ key, ...group }));
}

function WavePattern({ id }: { id: string }) {
  return (
    <svg className="settings-drawer-wave" width="100%" height="100%" aria-hidden="true">
      <defs>
        <pattern id={id} width="48" height="24" patternUnits="userSpaceOnUse">
          <path
            d="M-24 24a24 24 0 0 1 48 0M0 24a24 24 0 0 1 48 0M24 24a24 24 0 0 1 48 0M-12 24a12 12 0 0 1 24 0M12 24a12 12 0 0 1 24 0M36 24a12 12 0 0 1 24 0"
            fill="none"
            stroke="white"
            strokeOpacity=".14"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

export default function AdminSettings({ activeTab }: { activeTab: "users" | "activity" }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [activitySearch, setActivitySearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [activityCategory, setActivityCategory] = useState("All activity");
  const [activityPage, setActivityPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "staff",
    password: ""
  });
  const roleGroupId = useId();

  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => fetchStaffUsers(1, 50),
    staleTime: 30_000
  });

  const activityQuery = useQuery({
    queryKey: ["admin", "activity-logs", activityPage],
    queryFn: () => fetchActivityLogs(activityPage, 10),
    staleTime: 30_000,
    refetchInterval: activeTab === "activity" ? 15_000 : false,
    refetchOnWindowFocus: true,
    enabled: activeTab === "activity"
  });

  const users = useMemo(() => usersQuery.data?.users ?? [], [usersQuery.data]);
  const logs = useMemo(() => activityQuery.data?.logs ?? [], [activityQuery.data]);
  const totalLogPages = activityQuery.data?.totalPages ?? 1;
  const roleOptions = useMemo(() => {
    const existing = new Set(users.map((user) => user.role).filter(Boolean));
    return [...staffRoles.filter((role) => existing.has(role)), ...Array.from(existing).filter((role) => !staffRoles.includes(role))];
  }, [users]);
  const roleCardOptions = useMemo(
    () => Array.from(new Set([...staffRoles, ...users.map((user) => user.role).filter(Boolean)])),
    [users]
  );

  const filteredUsers = useMemo(() => {
    const normalizedQuery = searchTerm.trim().toLowerCase();
    return users.filter((user) => {
      const nameMatch = !normalizedQuery || user.name.toLowerCase().includes(normalizedQuery);
      const emailMatch = !normalizedQuery || user.email.toLowerCase().includes(normalizedQuery);
      const roleMatch = roleFilter === "all" || user.role === roleFilter;
      return roleMatch && (nameMatch || emailMatch);
    });
  }, [roleFilter, searchTerm, users]);

  const descriptions = useMemo(
    () => logs.map((log) => ({ log, description: describeActivity(log, { users: Object.fromEntries(users.map((user) => [user.id, user.name])) }) })),
    [logs, users]
  );
  const nonReadActivity = descriptions.some(({ description }) => !description.hidden);
  const visibleActivity = useMemo(() => {
    const query = activitySearch.trim().toLowerCase();
    return descriptions.filter(({ log, description }) => {
      if (nonReadActivity && description.hidden) return false;
      const searchMatch = !query || [
        description.sentence,
        description.category,
        log.actor_role ? formatRole(log.actor_role) : "System"
      ].some((value) => value.toLowerCase().includes(query));
      const categoryMatch = activityCategory === "All activity" || description.category === activityCategory;
      return searchMatch && categoryMatch;
    });
  }, [activityCategory, activitySearch, descriptions, nonReadActivity]);
  const activityCategories = useMemo(
    () => Array.from(
      new Set(descriptions
        .filter(({ description }) => !(nonReadActivity && description.hidden))
        .map(({ description }) => description.category))
    ),
    [descriptions, nonReadActivity]
  );
  const activityGroups = useMemo(() => groupByDay(visibleActivity), [visibleActivity]);

  const openAddDrawer = () => {
    setEditingUserId(null);
    setForm({ name: "", email: "", role: "staff", password: "" });
    setResetPassword("");
    setPasswordVisible(false);
    setFormError("");
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingUserId(null);
    setForm({ name: "", email: "", role: "staff", password: "" });
    setResetPassword("");
    setPasswordVisible(false);
    setFormError("");
  };

  const upsertUserMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role
      };

      if (editingUserId) {
        return updateStaffUser(editingUserId, payload);
      }

      return createStaffUser({ ...payload, password: form.password.trim() });
    },
    onSuccess: () => {
      toast(editingUserId ? "User updated" : "User added");
      closeDrawer();
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "activity-logs"] });
    },
    onError: (error: unknown) => {
      setFormError(getApiErrorMessage(error, `Unable to ${editingUserId ? "update" : "add"} user.`));
    }
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) =>
      resetStaffUserPassword(userId, password),
    onSuccess: () => {
      toast("Password reset");
      setResetPassword("");
      setFormError("");
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "activity-logs"] });
    },
    onError: (error: unknown) => {
      setFormError(getApiErrorMessage(error, "Unable to reset password."));
    }
  });

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const canSubmitUser = Boolean(
    form.name.trim() &&
    validEmail &&
    (!editingUserId ? form.password.trim().length >= 8 : true) &&
    !upsertUserMutation.isPending
  );

  function submitUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitUser) return;
    setFormError("");
    upsertUserMutation.mutate();
  }

  function changePage(nextPage: number) {
    setActivityPage(Math.min(totalLogPages, Math.max(1, nextPage)));
  }

  function onRoleKeyDown(event: KeyboardEvent<HTMLLabelElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % roleCardOptions.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + roleCardOptions.length) % roleCardOptions.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = roleCardOptions.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextRole = roleCardOptions[nextIndex];
    setForm((current) => ({ ...current, role: nextRole }));
    document.getElementById(`${roleGroupId}-${nextRole}`)?.focus();
  }

  return (
    <>
      {activeTab === "users" && (
        <section className="settings-card" aria-labelledby="settings-users-title">
          <header className="settings-card-heading">
            <span className="settings-card-icon"><UsersRoundIcon /></span>
            <div>
              <h2 id="settings-users-title">User management</h2>
              <p>Manage accounts and role assignments.</p>
            </div>
          </header>

          <div className="settings-toolbar">
            <label className="settings-search">
              <Search aria-hidden="true" size={17} />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search by name or email"
                aria-label="Search users by name or email"
              />
            </label>
            <div className="settings-chip-row" role="group" aria-label="Filter users by role">
              <Chip selected={roleFilter === "all"} onClick={() => setRoleFilter("all")}>All roles</Chip>
              {roleOptions.map((role) => (
                <Chip key={role} selected={roleFilter === role} onClick={() => setRoleFilter(role)}>
                  {formatRole(role)}
                </Chip>
              ))}
            </div>
            <button type="button" className="settings-primary-button" onClick={openAddDrawer}>
              <Plus aria-hidden="true" size={18} />
              Add user
            </button>
          </div>

          <div className="settings-user-table-wrap">
            <div className="settings-user-table" role="table" aria-label="Staff users">
              <div className="settings-user-table-head" role="row">
                <span role="columnheader">Name</span>
                <span role="columnheader">Email</span>
                <span role="columnheader">Role</span>
                <span role="columnheader">Actions</span>
              </div>
              {usersQuery.isLoading ? (
                <div className="settings-table-empty" role="row">Loading users…</div>
              ) : filteredUsers.length === 0 ? (
                <div className="settings-table-empty" role="row">No matching users found.</div>
              ) : filteredUsers.map((user: StaffUser) => (
                <div className="settings-user-row" role="row" key={user.id}>
                  <div className="settings-user-name" role="cell">
                    <RoleAvatar name={user.name} role={user.role} />
                    <div className="settings-user-name-text">
                      <strong>{user.name}</strong>
                      <span>Last login: {user.last_login ? formatDateTime(user.last_login) : "Never"}</span>
                    </div>
                  </div>
                  <div className="settings-user-email" role="cell" title={user.email}>{user.email}</div>
                  <div className="settings-user-role" role="cell"><RoleBadge role={user.role} /></div>
                  <div className="settings-user-action" role="cell">
                    <button
                      type="button"
                      className="settings-edit-button"
                      aria-label={`Edit ${user.name}`}
                      onClick={() => {
                        setEditingUserId(user.id);
                        setForm({ name: user.name, email: user.email, role: user.role, password: "" });
                        setResetPassword("");
                        setPasswordVisible(false);
                        setFormError("");
                        setDrawerOpen(true);
                      }}
                    >
                      <PencilLine aria-hidden="true" size={15} />
                      <span>Edit</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {activeTab === "activity" && (
        <section className="settings-card" aria-labelledby="settings-activity-title">
          <header className="settings-card-heading">
            <span className="settings-card-icon"><Activity aria-hidden="true" size={19} /></span>
            <div>
              <h2 id="settings-activity-title">User activity log</h2>
              <p>Recent activity and system events, in plain language.</p>
            </div>
          </header>

          <div className="settings-toolbar settings-activity-toolbar">
            <label className="settings-search">
              <Search aria-hidden="true" size={17} />
              <input
                value={activitySearch}
                onChange={(event) => setActivitySearch(event.target.value)}
                placeholder="Search activity"
                aria-label="Search activity"
              />
            </label>
            <div className="settings-chip-row" role="group" aria-label="Filter activity by category">
              <Chip selected={activityCategory === "All activity"} onClick={() => setActivityCategory("All activity")}>All activity</Chip>
              {activityCategories.map((category) => (
                <Chip key={category} selected={activityCategory === category} onClick={() => setActivityCategory(category)}>
                  {category}
                </Chip>
              ))}
            </div>
          </div>

          {activityQuery.isLoading ? (
            <div className="settings-activity-empty">Loading recent activity…</div>
          ) : activityGroups.length === 0 ? (
            <div className="settings-activity-empty">No activity matches these filters.</div>
          ) : (
            <div className="settings-activity-groups">
              {activityGroups.map((group) => (
                <section className="settings-activity-group" key={group.key} aria-label={group.label}>
                  <div className="settings-day-heading">
                    <h3>{group.label}</h3>
                    <span>{group.entries.length}</span>
                    <i aria-hidden="true" />
                  </div>
                  <div className="settings-activity-list">
                    {group.entries.map(({ log, description }) => (
                      <ActivityEntry key={log.id} log={log} description={description} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          <footer className="settings-pagination">
            <span>Page {activityQuery.data?.page ?? activityPage} of {totalLogPages}</span>
            <div>
              <button type="button" aria-label="Previous activity page" disabled={activityPage <= 1} onClick={() => changePage(activityPage - 1)}>
                <ChevronLeft aria-hidden="true" size={17} />
                Previous
              </button>
              <button type="button" aria-label="Next activity page" disabled={activityPage >= totalLogPages} onClick={() => changePage(activityPage + 1)}>
                Next
                <ChevronRight aria-hidden="true" size={17} />
              </button>
            </div>
          </footer>
        </section>
      )}

      <Drawer
        open={drawerOpen}
        title={editingUserId ? "Edit user" : "Add user"}
        onClose={closeDrawer}
        className="settings-user-drawer"
      >
        <header className="settings-drawer-header">
          <WavePattern id="settings-drawer-pattern" />
          <span className="settings-drawer-circle" aria-hidden="true" />
          <div className="settings-drawer-heading">
            <p>Users</p>
            <h2>{editingUserId ? "Edit user" : "Add user"}</h2>
            <span>{editingUserId ? "Update details or reset the password." : "Create an account and choose what they can do."}</span>
          </div>
          <button type="button" className="settings-drawer-close" aria-label="Close" onClick={closeDrawer}>
            <X aria-hidden="true" size={20} />
          </button>
        </header>

        <form id="settings-user-form" className="settings-drawer-form" onSubmit={submitUser} noValidate>
          {formError && (
            <div className="settings-form-error" role="alert">
              <AlertCircle aria-hidden="true" size={17} />
              <span>{formError}</span>
            </div>
          )}
          <label className="settings-field">
            <span>Full name</span>
            <span className="settings-input-wrap">
              <UserRound aria-hidden="true" size={18} />
              <input
                required
                autoComplete="name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Maria Santos"
              />
            </span>
          </label>

          <label className="settings-field">
            <span>Email address</span>
            <span className="settings-input-wrap">
              <Mail aria-hidden="true" size={18} />
              <input
                required
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="maria@katana.com"
              />
            </span>
          </label>

          <fieldset className="settings-field settings-role-field">
            <legend>Role</legend>
            <div className="settings-role-grid" role="radiogroup" aria-label="User role">
              {roleCardOptions.map((role, index) => {
                const colors = roleColors[role] ?? { background: "#EEF0F5", color: "#3B4254" };
                return (
                  <label
                    className={`settings-role-card${form.role === role ? " is-selected" : ""}`}
                    key={role}
                    onKeyDown={(event) => onRoleKeyDown(event, index)}
                  >
                    <input
                      id={`${roleGroupId}-${role}`}
                      type="radio"
                      name="user-role"
                      value={role}
                      checked={form.role === role}
                      onChange={() => setForm((current) => ({ ...current, role }))}
                    />
                    <span className="settings-role-dot" style={{ backgroundColor: colors.background, borderColor: colors.color }} />
                    <span>{formatRole(role)}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {!editingUserId && (
            <div className="settings-field">
              <label htmlFor="settings-user-password">Password</label>
              <span className="settings-input-wrap">
                <LockKeyhole aria-hidden="true" size={18} />
                <input
                  id="settings-user-password"
                  required
                  minLength={8}
                  type={passwordVisible ? "text" : "password"}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                  placeholder="Minimum 8 characters"
                />
                <button
                  type="button"
                  className="settings-password-toggle"
                  aria-label={passwordVisible ? "Hide password" : "Show password"}
                  onClick={() => setPasswordVisible((visible) => !visible)}
                >
                  {passwordVisible ? <EyeOff aria-hidden="true" size={17} /> : <Eye aria-hidden="true" size={17} />}
                </button>
              </span>
              <small>Use at least 8 characters. The user can change it after signing in.</small>
            </div>
          )}

          {editingUserId && (
            <section className="settings-reset-card" aria-labelledby="settings-reset-title">
              <h3 id="settings-reset-title"><KeyRound aria-hidden="true" size={17} />Reset password</h3>
              <div className="settings-field">
                <label htmlFor="settings-reset-password">New password</label>
                <span className="settings-input-wrap">
                  <LockKeyhole aria-hidden="true" size={18} />
                  <input
                    id="settings-reset-password"
                    type={passwordVisible ? "text" : "password"}
                    autoComplete="new-password"
                    value={resetPassword}
                    onChange={(event) => {
                      setResetPassword(event.target.value);
                      setFormError("");
                    }}
                    placeholder="Minimum 8 characters"
                  />
                  <button
                    type="button"
                    className="settings-password-toggle"
                    aria-label={passwordVisible ? "Hide new password" : "Show new password"}
                    onClick={() => setPasswordVisible((visible) => !visible)}
                  >
                    {passwordVisible ? <EyeOff aria-hidden="true" size={17} /> : <Eye aria-hidden="true" size={17} />}
                  </button>
                </span>
              </div>
              <button
                type="button"
                className="settings-reset-button"
                disabled={resetPassword.trim().length < 8 || resetPasswordMutation.isPending}
                onClick={() => {
                  if (editingUserId) resetPasswordMutation.mutate({ userId: editingUserId, password: resetPassword.trim() });
                }}
              >
                <KeyRound aria-hidden="true" size={16} />
                {resetPasswordMutation.isPending ? "Resetting…" : "Reset password"}
              </button>
            </section>
          )}

        </form>

        <footer className="settings-drawer-footer">
          <button type="button" className="settings-secondary-button" onClick={closeDrawer}>Cancel</button>
          <button
            type="submit"
            form="settings-user-form"
            className="settings-primary-button"
            disabled={!canSubmitUser}
            aria-disabled={!canSubmitUser}
          >
            <Check aria-hidden="true" size={17} />
            {upsertUserMutation.isPending ? "Saving…" : editingUserId ? "Update user" : "Save user"}
          </button>
        </footer>
      </Drawer>
    </>
  );
}

function UsersRoundIcon() {
  return <UserRound aria-hidden="true" size={19} />;
}
