import { api } from "./api";

export type StaffUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
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
  password?: string;
};

export async function fetchStaffUsers(page = 1, limit = 20) {
  const response = await api.get<StaffUsersResponse>("/api/admin/users", {
    params: { page, limit }
  });
  return response.data;
}

export async function createStaffUser(payload: StaffUserPayload) {
  const response = await api.post<{ user: StaffUser }>("/api/admin/users", payload);
  return response.data.user;
}

export async function updateStaffUser(userId: string, payload: StaffUserPayload) {
  const response = await api.put<{ user: StaffUser }>(`/api/admin/users/${userId}`, payload);
  return response.data.user;
}

export async function deactivateStaffUser(userId: string) {
  const response = await api.delete<{ user: StaffUser }>(`/api/admin/users/${userId}`);
  return response.data.user;
}
