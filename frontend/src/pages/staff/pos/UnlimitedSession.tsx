import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import EndUnlimitedModal from "./EndUnlimitedModal";
import UnlimitedProfitWarning from "../../../components/pos/UnlimitedProfitWarning";
import UnlimitedTimer from "../../../components/pos/UnlimitedTimer";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { api } from "../../../lib/api";
import { useToast } from "../../../hooks/useToast";

type UnlimitedProduct = {
  id: string;
  name: string;
  category: string;
  price: string | number;
};

type UnlimitedSessionRecord = {
  id: string;
  pax_count: number;
  price_per_pax: number;
  total_paid: number;
  first_round_at?: string | null;
  ends_at: string;
  status: string;
  rounds: Array<{
    round_number: number;
    items: Array<{
      quantity: number;
      selling_product: UnlimitedProduct;
    }>;
  }>;
};

type UnlimitedSessionProps = {
  sessionId: string;
  onExit: () => void;
};

export default function UnlimitedSession({ sessionId, onExit }: UnlimitedSessionProps) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [endOpen, setEndOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const sessionQuery = useQuery({
    queryKey: ["pos", "unlimited", sessionId],
    queryFn: async () => {
      const response = await api.get<{ session: UnlimitedSessionRecord; settings: { leftover_charge_percent: number } }>(
        `/api/pos/unlimited/session/${sessionId}`
      );
      return response.data;
    }
  });

  const productsQuery = useQuery({
    queryKey: ["pos", "unlimited", "products"],
    queryFn: async () => {
      const response = await api.get<{ products: UnlimitedProduct[] }>("/api/pos/unlimited/included-products");
      return response.data.products;
    }
  });

  const submitRoundMutation = useMutation({
    mutationFn: async () =>
      api.post("/api/pos/unlimited/round", {
        sessionId,
        items: Object.entries(cart).map(([productId, quantity]) => ({ productId, quantity }))
      }),
    onSuccess: () => {
      setCart({});
      queryClient.invalidateQueries({ queryKey: ["pos", "unlimited", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["pos", "transactions"] });
      toast("Round submitted.");
    },
    onError: () => toast("Unable to submit round.")
  });

  const endSessionMutation = useMutation({
    mutationFn: async (leftovers: Array<{ productId: string; quantity: number }>) =>
      api.post("/api/pos/unlimited/end", { sessionId, leftovers }),
    onSuccess: () => {
      setEndOpen(false);
      queryClient.invalidateQueries({ queryKey: ["pos", "unlimited", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["pos", "transactions"] });
      queryClient.invalidateQueries({ queryKey: ["tables"] });
      toast("Unlimited session completed.");
      onExit();
    },
    onError: () => toast("Unable to end session.")
  });

  const orderedProducts = useMemo(() => {
    const ordered = new Map<string, { productId: string; name: string; price: number; quantity: number }>();

    sessionQuery.data?.session.rounds.forEach((round) => {
      round.items.forEach((item) => {
        const existing = ordered.get(item.selling_product.id);
        const quantity = (existing?.quantity ?? 0) + item.quantity;
        ordered.set(item.selling_product.id, {
          productId: item.selling_product.id,
          name: item.selling_product.name,
          price: Number(item.selling_product.price),
          quantity
        });
      });
    });

    return Array.from(ordered.values());
  }, [sessionQuery.data]);

  const foodCost = orderedProducts.reduce((total, product) => total + product.price * product.quantity, 0);
  const customerPaid = Number(sessionQuery.data?.session.total_paid ?? 0);
  const cartCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);

  function changeQuantity(productId: string, delta: number) {
    setCart((current) => {
      const next = Math.max((current[productId] ?? 0) + delta, 0);
      const updated = { ...current };

      if (next === 0) {
        delete updated[productId];
      } else {
        updated[productId] = next;
      }

      return updated;
    });
  }

  return (
    <div className="grid gap-4">
      {sessionQuery.data && (
        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium uppercase text-red-700">Unlimited Session</p>
                <h2 className="text-2xl font-semibold text-slate-950">Round {(sessionQuery.data.session.rounds.length || 0) + 1}</h2>
              </div>
              <Link className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50" to="/staff/pos/unlimited-settings">
                <Settings className="h-4 w-4" /> Settings
              </Link>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {sessionQuery.data.session.pax_count} guests paid PHP {customerPaid.toLocaleString()}
            </p>
          </div>
          <UnlimitedTimer firstRoundAt={sessionQuery.data.session.first_round_at} endsAt={sessionQuery.data.session.ends_at} />
        </div>
      )}

      <UnlimitedProfitWarning customerPaid={customerPaid} foodCost={foodCost} />

      <div className="grid grid-cols-[7fr_3fr] gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Unlimited Menu</CardTitle>
          </CardHeader>
          <CardContent>
            {productsQuery.isLoading && <p className="text-sm text-slate-500">Loading unlimited products...</p>}
            <div className="grid grid-cols-3 gap-3">
              {productsQuery.data?.map((product) => (
                <button
                  key={product.id}
                  className="min-h-28 rounded-md border border-slate-200 bg-white p-3 text-left hover:bg-red-50"
                  type="button"
                  onClick={() => changeQuantity(product.id, 1)}
                >
                  <span className="block font-semibold text-slate-950">{product.name}</span>
                  <span className="mt-2 inline-flex rounded-full bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">
                    {product.category}
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Current Round</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {Object.entries(cart).length === 0 && <p className="text-sm text-slate-500">No items selected.</p>}
            {Object.entries(cart).map(([productId, quantity]) => {
              const product = productsQuery.data?.find((item) => item.id === productId);

              return (
                <div key={productId} className="rounded-md border border-slate-200 p-3">
                  <p className="font-semibold text-slate-950">{product?.name ?? "Product"}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => changeQuantity(productId, -1)}>
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="grid h-10 min-w-10 place-items-center rounded-md border border-slate-200">{quantity}</span>
                    <Button size="sm" variant="outline" onClick={() => changeQuantity(productId, 1)}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
            <div className="mt-2 grid gap-2 border-t border-slate-200 pt-3 text-sm">
              <p>Food Cost: PHP {foodCost.toFixed(2)}</p>
              <p>Customer Paid: PHP {customerPaid.toFixed(2)}</p>
              <p>Profit: PHP {(customerPaid - foodCost).toFixed(2)}</p>
            </div>
            <Button disabled={cartCount === 0 || submitRoundMutation.isPending} onClick={() => submitRoundMutation.mutate()}>
              Submit Round
            </Button>
            <Button variant="outline" disabled={endSessionMutation.isPending} onClick={() => setEndOpen(true)}>
              End Session
            </Button>
          </CardContent>
        </Card>
      </div>

      <EndUnlimitedModal
        chargePercent={sessionQuery.data?.settings.leftover_charge_percent ?? 100}
        open={endOpen}
        orderedProducts={orderedProducts}
        pending={endSessionMutation.isPending}
        onClose={() => setEndOpen(false)}
        onEnd={(leftovers) => endSessionMutation.mutate(leftovers)}
      />
    </div>
  );
}
