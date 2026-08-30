import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "./useToast";
import {
  defaultSystemSettings,
  fetchSystemSettings,
  saveSystemSettings,
  type SystemSettings
} from "../lib/systemSettings";

export function useSystemSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const query = useQuery({
    queryKey: ["system-settings"],
    queryFn: fetchSystemSettings,
    retry: 1
  });
  const settings = query.data ?? defaultSystemSettings;
  const mutation = useMutation({
    mutationFn: (nextSettings: SystemSettings) => saveSystemSettings(nextSettings),
    onSuccess: (savedSettings) => {
      queryClient.setQueryData(["system-settings"], savedSettings);
      queryClient.invalidateQueries({ queryKey: ["system-settings"] });
      queryClient.invalidateQueries({ queryKey: ["inventory", "materials"] });
      queryClient.invalidateQueries({ queryKey: ["inventory", "low-stock"] });
      toast("Settings saved.");
    },
    onError: (error) => {
      // Prefer backend-provided message when available to help debugging
      const message =
        typeof error === "object" && error && "response" in error
          ? (error as any).response?.data?.message ?? "Unable to save settings."
          : "Unable to save settings.";
      console.error("Save system settings failed:", error);
      toast(message);
    }
  });

  return {
    ...query,
    settings,
    saveSettings: mutation.mutate,
    isSaving: mutation.isPending
  };
}
