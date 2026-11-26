import { useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, Package, ReceiptText } from "lucide-react";
import { SectionNavTab } from "../../../components/layout/SectionNav";
import BatchManagement from "./BatchManagement";
import InventoryMovements from "./InventoryMovements";
import InventoryReservations from "./InventoryReservations";
import MaterialsList from "./MaterialsList";
import SellingProductsList from "./SellingProductsList";
import WasteDisposal from "./WasteDisposal";
import YieldEstimator from "./YieldEstimator";
import { MaterialBatch, StaffRole } from "./types";
import "./InventoryMaterials.css";

type InventoryTab = "stock" | "reservations" | "movements";
type StockView = "materials" | "batches" | "waste" | "menu-products" | "yield";
type MaterialsStockFilter = "all" | "issues" | "low" | "negative" | "expiring";

const tabs: Array<SectionNavTab<InventoryTab>> = [
  { id: "stock", label: "Stock", icon: <Package aria-hidden="true" className="h-4 w-4" /> },
  { id: "reservations", label: "Reservations", icon: <ClipboardList aria-hidden="true" className="h-4 w-4" /> },
  { id: "movements", label: "Movements", icon: <ReceiptText aria-hidden="true" className="h-4 w-4" /> }
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
    <main className="inventory-page min-h-screen px-4 py-5 pb-24 md:px-6 md:py-6 md:pb-6">
      <div className="inventory-page-content grid w-full gap-5">
        <header className="inventory-page-header flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Inventory</h1>
            <p className="mt-1 text-sm">Track what’s in stock, what’s running low, and what needs reordering.</p>
          </div>
          <span className="inventory-role-pill">Signed in as {role.replace("_", " ")}</span>
        </header>

        <nav className="inventory-primary-nav" aria-label="Section navigation">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={activeTab === tab.id}
              className={`inventory-primary-tab ${activeTab === tab.id ? "is-active bg-red-700" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        {activeTab === "stock" && !readOnly && (
          <nav className="inventory-stock-nav" aria-label="Stock tools">
            {([
              ["materials", "Materials"],
              ["batches", "Stock In"],
              ["waste", "Waste disposal"],
              ["menu-products", "Menu products"],
              ["yield", "Yield estimator"]
            ] as const).map(([view, label]) => (
              <button
                key={view}
                type="button"
                aria-current={stockView === view ? "page" : undefined}
                className={`inventory-stock-tab ${stockView === view ? "is-active" : ""}`}
                onClick={() => {
                  setStockView(view);
                  if (view !== "waste") {
                    setWastePreload(null);
                  }
                }}
              >
                {label}
              </button>
            ))}
          </nav>
        )}

        <section className="grid min-w-0">
          <div className="min-w-0">
            {activeTab === "stock" && (
              <div className="grid gap-4">
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
