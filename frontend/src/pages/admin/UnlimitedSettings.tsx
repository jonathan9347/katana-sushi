import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, Settings, ShoppingCart } from "lucide-react";
import { Link } from "react-router-dom";
import SectionNav, { SectionNavTab } from "../../components/layout/SectionNav";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { api } from "../../lib/api";
import { useToast } from "../../hooks/useToast";

type UnlimitedSettingsRecord = {
  price_per_person: number;
  time_limit_minutes: number;
  leftover_charge_percent: number;
};

type IncludedProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
  is_included: boolean;
};

const posTabs: Array<SectionNavTab> = [
  { id: "new-sale", label: "New Sale", icon: <ShoppingCart className="h-4 w-4" />, to: "/staff/pos", end: true },
  { id: "history", label: "Transaction History", icon: <Printer className="h-4 w-4" />, to: "/staff/pos/history" },
  { id: "settings", label: "Unlimited Settings", icon: <Settings className="h-4 w-4" />, to: "/staff/pos/unlimited-settings" }
];

function getStoredRole() {
  if (!localStorage.getItem("katana_token")) {
    return "staff";
  }

  return localStorage.getItem("katana_role")?.toLowerCase() ?? "staff";
}

export default function UnlimitedSettings() {
  const [settingsForm, setSettingsForm] = useState({
    price_per_person: "599",
    time_limit_minutes: "90",
    leftover_charge_percent: "100"
  });
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const role = getStoredRole();
  const allowed = role === "admin" || role === "cashier";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const settingsQuery = useQuery({
    queryKey: ["admin", "unlimited", "settings"],
    queryFn: async () => {
      const response = await api.get<{ settings: UnlimitedSettingsRecord }>("/api/admin/unlimited/settings");
      return response.data.settings;
    },
    enabled: allowed
  });

  const productsQuery = useQuery({
    queryKey: ["admin", "unlimited", "included-products"],
    queryFn: async () => {
      const response = await api.get<{ products: IncludedProduct[] }>("/api/admin/unlimited/included-products");
      return response.data.products;
    },
    enabled: allowed
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setSettingsForm({
        price_per_person: String(settingsQuery.data.price_per_person),
        time_limit_minutes: String(settingsQuery.data.time_limit_minutes),
        leftover_charge_percent: String(settingsQuery.data.leftover_charge_percent)
      });
    }
  }, [settingsQuery.data]);

  useEffect(() => {
    if (productsQuery.data) {
      setIncluded(Object.fromEntries(productsQuery.data.map((product) => [product.id, product.is_included])));
    }
  }, [productsQuery.data]);

  const saveSettingsMutation = useMutation({
    mutationFn: async () =>
      api.put("/api/admin/unlimited/settings", {
        price_per_person: Number(settingsForm.price_per_person),
        time_limit_minutes: Number(settingsForm.time_limit_minutes),
        leftover_charge_percent: Number(settingsForm.leftover_charge_percent)
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "unlimited", "settings"] });
      toast("Unlimited settings saved.");
    },
    onError: () => toast("Unable to save settings.")
  });

  const saveIncludedMutation = useMutation({
    mutationFn: async () =>
      api.put("/api/admin/unlimited/included-products", {
        products: Object.entries(included).map(([productId, isIncluded]) => ({ productId, isIncluded }))
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "unlimited", "included-products"] });
      queryClient.invalidateQueries({ queryKey: ["pos", "unlimited", "products"] });
      toast("Included products saved.");
    },
    onError: () => toast("Unable to save included products.")
  });

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveSettingsMutation.mutate();
  }

  if (!allowed) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold text-slate-950">POS settings access required</h1>
        <Link className="text-red-700 underline" to="/staff/login">Go to staff login</Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase text-red-700">Point of Sale</p>
            <h1 className="text-3xl font-semibold text-slate-950">Unlimited Settings</h1>
          </div>
        </div>

        <SectionNav tabs={posTabs} />

        <Card>
          <CardHeader>
            <CardTitle>Pricing and Rules</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 md:grid-cols-4" onSubmit={saveSettings}>
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                <span>Price per Person</span>
                <input className="h-10 rounded-md border border-slate-300 px-3" type="number" value={settingsForm.price_per_person} onChange={(event) => setSettingsForm((current) => ({ ...current, price_per_person: event.target.value }))} />
              </label>
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                <span>Time Limit Minutes</span>
                <input className="h-10 rounded-md border border-slate-300 px-3" type="number" value={settingsForm.time_limit_minutes} onChange={(event) => setSettingsForm((current) => ({ ...current, time_limit_minutes: event.target.value }))} />
              </label>
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                <span>Leftover Charge Percent</span>
                <input className="h-10 rounded-md border border-slate-300 px-3" type="number" value={settingsForm.leftover_charge_percent} onChange={(event) => setSettingsForm((current) => ({ ...current, leftover_charge_percent: event.target.value }))} />
              </label>
              <div className="flex items-end">
                <Button disabled={saveSettingsMutation.isPending}>Save Settings</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <CardTitle>Included Products</CardTitle>
            <Button disabled={saveIncludedMutation.isPending} onClick={() => saveIncludedMutation.mutate()}>
              Save Product Inclusion
            </Button>
          </CardHeader>
          <CardContent>
            {productsQuery.isLoading && <p className="text-sm text-slate-500">Loading products...</p>}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {productsQuery.data?.map((product) => (
                <label key={product.id} className="flex min-h-20 items-start gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm">
                  <input
                    checked={included[product.id] ?? false}
                    className="mt-1 h-4 w-4 accent-red-700"
                    type="checkbox"
                    onChange={(event) => setIncluded((current) => ({ ...current, [product.id]: event.target.checked }))}
                  />
                  <span>
                    <span className="block font-semibold text-slate-950">{product.name}</span>
                    <span className="mt-1 block text-xs text-slate-500">{product.category} - PHP {product.price}</span>
                  </span>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
