import { api } from "./api";

export type StaffUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  last_login: string | null;
  created_at: string;
  updated_at: string;
};

export type StaffUsersResponse = {
  users: StaffUser[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type StaffUserPayload = {
  name: string;
  email: string;
  role: string;
};

export type NewStaffUserPayload = StaffUserPayload & {
  password: string;
};

export async function fetchStaffUsers(page = 1, limit = 20) {
  const response = await api.get<StaffUsersResponse>("/api/admin/users", {
    params: { page, limit }
  });
  return response.data;
}

export async function createStaffUser(payload: NewStaffUserPayload) {
  const response = await api.post<{ user: StaffUser }>("/api/admin/users", payload);
  return response.data.user;
}

export async function updateStaffUser(userId: string, payload: StaffUserPayload) {
  const response = await api.put<{ user: StaffUser }>(`/api/admin/users/${userId}`, payload);
  return response.data.user;
}

export async function resetStaffUserPassword(userId: string, password: string) {
  const response = await api.post<{ message: string; user: Pick<StaffUser, "id" | "name" | "email" | "role"> }>(
    `/api/admin/users/${userId}/reset-password`,
    { password }
  );
  return response.data.user;
}
