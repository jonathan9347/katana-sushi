import { useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, Package, ReceiptText } from "lucide-react";
import SectionNav, { SectionNavTab } from "../../../components/layout/SectionNav";
import BatchManagement from "./BatchManagement";
import InventoryMovements from "./InventoryMovements";
import InventoryReservations from "./InventoryReservations";
import MaterialsList from "./MaterialsList";
import SellingProductsList from "./SellingProductsList";
import WasteDisposal from "./WasteDisposal";
import YieldEstimator from "./YieldEstimator";
import { MaterialBatch, StaffRole } from "./types";

type InventoryTab = "stock" | "reservations" | "movements";
type StockView = "materials" | "batches" | "waste" | "menu-products" | "yield";
type MaterialsStockFilter = "all" | "issues" | "low" | "negative" | "expiring";

const tabs: Array<SectionNavTab<InventoryTab>> = [
  { id: "stock", label: "Stock", icon: <Package className="h-4 w-4" /> },
  { id: "reservations", label: "Reservations", icon: <ClipboardList className="h-4 w-4" /> },
  { id: "movements", label: "Movements", icon: <ReceiptText className="h-4 w-4" /> }
];

function getStoredRole(): StaffRole {
  if (!localStorage.getItem("katana_token")) {
    return "staff";
  }

  return (localStorage.getItem("katana_role")?.toLowerCase() as StaffRole | null) ?? "staff";
}

export default function InventoryPage({ readOnly = false }: { readOnly?: boolean }) {
  const [activeTab, setActiveTab] = useState<InventoryTab>("stock");
  const [stockView, setStockView] = useState<StockView>("materials");
  const [materialsStockFilter, setMaterialsStockFilter] = useState<MaterialsStockFilter>("all");
  const [batchesExpiringOnly, setBatchesExpiringOnly] = useState(false);
  const [wastePreload, setWastePreload] = useState<{
    raw_material_id: string;
    batch_id?: string;
    quantity?: string;
    reason?: "spoilage" | "expired" | "prep_waste" | "damaged" | "other";
    notes?: string;
  } | null>(null);
  const role = getStoredRole();
  const allowed = role === "admin" || role === "inventory_manager" || (readOnly && role === "chef");
  const visibleTabs = readOnly ? tabs.filter((tab) => tab.id === "stock") : tabs;

  const handleQuickDispose = (batch: MaterialBatch) => {
    setActiveTab("stock");
    setStockView("waste");
    setWastePreload({
      raw_material_id: batch.raw_material.id,
      batch_id: batch.id,
      quantity: String(Number(batch.remaining_quantity) || 0),
      reason: "expired",
      notes: `Expired batch ${batch.batch_number} was disposed after review.`
    });
  };

  if (!allowed) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold text-slate-950">Inventory access required</h1>
        <p className="max-w-md text-slate-600">Sign in with an admin or inventory manager account to manage stock.</p>
        <Link className="text-red-700 underline" to="/staff/login">
          Sign in
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 lg:pl-4 lg:pr-8">
      <div className="grid w-full gap-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase text-red-700">Inventory</p>
            <h1 className="text-3xl font-semibold text-slate-950">Inventory Management</h1>
          </div>
          <p className="text-sm text-slate-500">Signed in as {role.replace("_", " ")}</p>
        </div>

        <section className="grid min-w-0 gap-4">
          <SectionNav activeTab={activeTab} tabs={visibleTabs} onTabChange={setActiveTab} />
          <div className="min-w-0">
            {activeTab === "stock" && (
              <div className="grid gap-4">
                {!readOnly && (
                  <div className="flex flex-wrap gap-2">
                    {([
                      ["materials", "Materials"],
                      ["batches", "Stock In"],
                      ["waste", "Waste Disposal"],
                      ["menu-products", "Menu Products"],
                      ["yield", "Yield Estimator"]
                    ] as const).map(([view, label]) => (
                      <button
                        key={view}
                        type="button"
                        onClick={() => {
                          setStockView(view);
                          if (view !== "waste") {
                            setWastePreload(null);
                          }
                        }}
                        className={`rounded-md px-3 py-2 text-sm font-semibold ${stockView === view ? "bg-red-700 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {stockView === "materials" && (
                  <MaterialsList
                    role={role}
                    onNavigateStockView={setStockView}
                    onOpenReservations={() => setActiveTab("reservations")}
                    initialStockFilter={materialsStockFilter}
                  />
                )}
                {stockView === "batches" && (
                  <BatchManagement
                    initialExpiringOnly={batchesExpiringOnly}
                    onExpiringOnlyChange={setBatchesExpiringOnly}
                    onQuickDispose={handleQuickDispose}
                  />
                )}
                {stockView === "waste" && (
                  <WasteDisposal
                    initialForm={wastePreload ?? undefined}
                    onPreloadConsumed={() => setWastePreload(null)}
                  />
                )}
                {stockView === "menu-products" && !readOnly && <SellingProductsList role={role} />}
                {stockView === "yield" && !readOnly && <YieldEstimator />}
              </div>
            )}
            {activeTab === "reservations" && !readOnly && <InventoryReservations />}
            {activeTab === "movements" && !readOnly && <InventoryMovements />}
          </div>
        </section>
      </div>
    </main>
  );
}
