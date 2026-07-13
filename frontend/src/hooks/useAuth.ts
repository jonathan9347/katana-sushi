export type StaffUser = {
  id: string;
  email: string;
  role: string;
  name: string;
};

export function useAuth() {
  let user: StaffUser | null = null;

  if (typeof window !== "undefined") {
    try {
      const storedUser = localStorage.getItem("katana_user");
      const rawUser = storedUser ? JSON.parse(storedUser) : null;
      const role = (localStorage.getItem("katana_role") ?? rawUser?.role ?? "").toLowerCase();

      if (rawUser?.id && rawUser?.email && rawUser?.name) {
        user = { id: rawUser.id, email: rawUser.email, name: rawUser.name, role };
      }
    } catch {
      user = null;
    }
  }

  return {
    user,
    isLoading: false
  };
}
