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
    onError: () => toast("Unable to save settings.")
  });

  return {
    ...query,
    settings,
    saveSettings: mutation.mutate,
    isSaving: mutation.isPending
  };
}
