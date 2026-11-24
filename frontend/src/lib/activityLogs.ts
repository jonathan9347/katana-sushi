import { api } from "./api";

export type ActivityLogItem = {
  id: string;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  created_at: string;
  message: string;
};

export type ActivityLogsResponse = {
  logs: ActivityLogItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export async function fetchActivityLogs(page = 1, limit = 10) {
  const response = await api.get<ActivityLogsResponse>("/api/admin/activity-logs", {
    params: { page, limit }
  });
  return response.data;
}
