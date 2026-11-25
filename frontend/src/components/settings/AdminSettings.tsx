import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, PencilLine, Plus, Search, X } from "lucide-react";
import { useToast } from "../../hooks/useToast";
import { fetchActivityLogs, type ActivityLogItem } from "../../lib/activityLogs";
import {
  createStaffUser,
  fetchStaffUsers,
  resetStaffUserPassword,
  updateStaffUser,
  type StaffUser
} from "../../lib/adminUsers";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

const staffRoles = ["admin", "inventory_manager", "cashier", "receptionist", "event_coordinator", "chef", "staff"];

function formatRole(role: string) {
  if (role === "staff") {
    return "Team member";
  }

  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Never";
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "S";
}

function ActivityLogTable({ logs }: { logs: ActivityLogItem[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-left">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Actor</th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Action</th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {logs.length === 0 ? (
            <tr>
              <td className="px-4 py-8 text-center text-sm text-slate-500" colSpan={3}>
                No activity recorded yet.
              </td>
            </tr>
          ) : (
            logs.map((log) => (
              <tr key={log.id} className="align-top">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-xs font-bold text-red-700">
                      {getInitials(log.actor_name ?? "System")}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{log.actor_name ?? "System"}</p>
                      <p className="text-xs text-slate-500">{log.actor_role ? formatRole(log.actor_role) : "System"}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">
                    {log.entity}
                  </span>
                  <p className="mt-2 max-w-xl break-words">{log.message}</p>
                </td>
                <td className="px-4 py-3 text-sm text-slate-500">{formatDateTime(log.created_at)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminSettings({ activeTab }: { activeTab: "users" | "activity" }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [activityPage, setActivityPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "staff",
    password: ""
  });

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

  const filteredUsers = useMemo(() => {
    const normalizedQuery = searchTerm.trim().toLowerCase();
    return users.filter((user) => {
      const nameMatch = !normalizedQuery || user.name.toLowerCase().includes(normalizedQuery);
      const emailMatch = !normalizedQuery || user.email.toLowerCase().includes(normalizedQuery);
      const roleMatch = roleFilter === "all" || user.role === roleFilter;
      return roleMatch && (nameMatch || emailMatch);
    });
  }, [roleFilter, searchTerm, users]);

  const openAddDrawer = () => {
    setEditingUserId(null);
    setForm({ name: "", email: "", role: "staff", password: "" });
    setResetPassword("");
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingUserId(null);
    setForm({ name: "", email: "", role: "staff", password: "" });
    setResetPassword("");
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
      toast(editingUserId ? "User updated successfully." : "User added successfully.");
      closeDrawer();
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "activity-logs"] });
    },
    onError: (error: any) => {
      toast(error?.response?.data?.message ?? `Unable to ${editingUserId ? "update" : "add"} user.`);
    }
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) =>
      resetStaffUserPassword(userId, password),
    onSuccess: (_user, variables) => {
      const target = users.find((user) => user.id === variables.userId);
      toast(`Password reset for ${target?.name ?? "user"}.`);
      setResetPassword("");
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "activity-logs"] });
    },
    onError: (error: any) => {
      toast(error?.response?.data?.message ?? "Unable to reset password.");
    }
  });

  const canSubmitUser =
    form.name.trim() &&
    form.email.trim() &&
    (!editingUserId ? form.password.trim().length >= 8 : true) &&
    !upsertUserMutation.isPending;

  return (
    <Card>
      {activeTab === "users" && <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-red-700">
            <span aria-hidden="true">Users</span>
            <CardTitle className="ml-2">User Management</CardTitle>
          </div>
          <Button type="button" variant="default" onClick={openAddDrawer}>
            <Plus className="mr-2 h-4 w-4" />
            Add user
          </Button>
        </div>
      </CardHeader>}
      <CardContent className="space-y-8 pt-6">
        {activeTab === "users" && <section>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Users</h3>
              <p className="text-sm text-slate-500">Manage accounts and role assignments.</p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-700 outline-none focus:border-red-300"
                  placeholder="Search by name or email"
                  aria-label="Search users"
                />
              </div>
              <select
                aria-label="Filter by role"
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value)}
                className="rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-red-300"
              >
                <option value="all">All roles</option>
                {staffRoles.map((role) => (
                  <option key={role} value={role}>{formatRole(role)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-left">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Name</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Email</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Role</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {usersQuery.isLoading ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-slate-500" colSpan={4}>
                      Loading users...
                    </td>
                  </tr>
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-slate-500" colSpan={4}>
                      No matching users found.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user: StaffUser) => (
                    <tr key={user.id}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
                            {getInitials(user.name)}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{user.name}</p>
                            <p className="text-xs text-slate-500">{formatDateTime(user.last_login)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">{user.email}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className="inline-flex rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-100">
                          {formatRole(user.role)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            aria-label={`Edit ${user.name}`}
                            onClick={() => {
                              setEditingUserId(user.id);
                              setForm({
                                name: user.name,
                                email: user.email,
                                role: user.role,
                                password: ""
                              });
                              setDrawerOpen(true);
                            }}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                          >
                            <PencilLine className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>}

        {activeTab === "activity" && <section>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">User Activity Log</h3>
              <p className="text-sm text-slate-500">Recent activity and system events.</p>
            </div>
          </div>

          <div className="space-y-4">
            {activityQuery.isLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
                Loading recent activity...
              </div>
            ) : (
              <>
                <ActivityLogTable logs={logs} />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-500">
                    Page {activityQuery.data?.page ?? 1} of {totalLogPages}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={activityPage <= 1}
                      onClick={() => setActivityPage((current) => Math.max(1, current - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={activityPage >= totalLogPages}
                      onClick={() => setActivityPage((current) => Math.min(totalLogPages, current + 1))}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>}
      </CardContent>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30" onClick={closeDrawer}>
          <div
            className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-red-700">Users</p>
                <h3 className="mt-2 text-2xl font-black text-slate-950">
                  {editingUserId ? "Edit user" : "Add user"}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
                aria-label="Close drawer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-8 space-y-5">
              <label className="block space-y-2 text-sm text-slate-700">
                <span>Full name</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 outline-none transition focus:border-red-300 focus:bg-white"
                  placeholder="Maria Santos"
                />
              </label>

              <label className="block space-y-2 text-sm text-slate-700">
                <span>Email address</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                  className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 outline-none transition focus:border-red-300 focus:bg-white"
                  placeholder="maria@katana.com"
                />
              </label>

              <label className="block space-y-2 text-sm text-slate-700">
                <span>Role</span>
                <select
                  value={form.role}
                  onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}
                  className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 outline-none transition focus:border-red-300 focus:bg-white"
                >
                  {staffRoles.map((role) => (
                    <option key={role} value={role}>
                      {formatRole(role)}
                    </option>
                  ))}
                </select>
              </label>

              {!editingUserId && <label className="block space-y-2 text-sm text-slate-700">
                <span>Password</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                  className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 outline-none transition focus:border-red-300 focus:bg-white"
                  placeholder="Minimum 8 characters"
                />
              </label>}
            </div>

            {editingUserId && (
              <section className="mt-8 border-t border-slate-200 pt-6" aria-labelledby="reset-password-title">
                <h4 id="reset-password-title" className="text-base font-semibold text-slate-900">Reset password</h4>
                <label className="mt-4 block space-y-2 text-sm text-slate-700">
                  <span>New password</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={resetPassword}
                    onChange={(event) => setResetPassword(event.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-red-300"
                    placeholder="Minimum 8 characters"
                  />
                </label>
                <Button
                  type="button"
                  className="mt-4"
                  disabled={resetPassword.trim().length < 8 || resetPasswordMutation.isPending}
                  onClick={() => resetPasswordMutation.mutate({ userId: editingUserId, password: resetPassword.trim() })}
                >
                  <KeyRound className="mr-2 h-4 w-4" />
                  {resetPasswordMutation.isPending ? "Resetting..." : "Reset password"}
                </Button>
              </section>
            )}

            <div className="mt-8 flex items-center justify-end gap-3">
              <Button type="button" variant="outline" onClick={closeDrawer}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!canSubmitUser || upsertUserMutation.isPending}
                onClick={() => upsertUserMutation.mutate()}
              >
                {upsertUserMutation.isPending ? "Saving..." : editingUserId ? "Update user" : "Save user"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
