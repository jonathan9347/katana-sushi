import { useState } from "react";
import { Link } from "react-router-dom";
import { Boxes, ClipboardList, Package, PackageSearch, ReceiptText, Settings2 } from "lucide-react";
import SectionNav, { SectionNavTab } from "../../../components/layout/SectionNav";
import BatchManagement from "./BatchManagement";
import InventoryMovements from "./InventoryMovements";
import InventoryOverview from "./InventoryOverview";
import InventoryReservations from "./InventoryReservations";
import MaterialsList from "./MaterialsList";
import SellingProductsList from "./SellingProductsList";
import WasteDisposal from "./WasteDisposal";
import YieldEstimator from "./YieldEstimator";
import { StaffRole } from "./types";

type InventoryTab = "overview" | "stock" | "reservations" | "movements" | "setup";
type StockView = "materials" | "batches" | "waste";
type MaterialsStockFilter = "all" | "issues" | "low" | "negative" | "expiring";
type SetupView = "menu-products" | "yield";

const tabs: Array<SectionNavTab<InventoryTab>> = [
  { id: "overview", label: "Overview", icon: <Boxes className="h-4 w-4" /> },
  { id: "stock", label: "Stock", icon: <Package className="h-4 w-4" /> },
  { id: "reservations", label: "Reservations", icon: <ClipboardList className="h-4 w-4" /> },
  { id: "movements", label: "Movements", icon: <ReceiptText className="h-4 w-4" /> },
  { id: "setup", label: "Setup & Tools", icon: <Settings2 className="h-4 w-4" /> }
];

function getStoredRole(): StaffRole {
  if (!localStorage.getItem("katana_token")) {
    return "staff";
  }

  return (localStorage.getItem("katana_role")?.toLowerCase() as StaffRole | null) ?? "staff";
}

export default function InventoryPage({ readOnly = false }: { readOnly?: boolean }) {
  const [activeTab, setActiveTab] = useState<InventoryTab>(readOnly ? "stock" : "overview");
  const [stockView, setStockView] = useState<StockView>("materials");
  const [materialsStockFilter, setMaterialsStockFilter] = useState<MaterialsStockFilter>("all");
  const [batchesExpiringOnly, setBatchesExpiringOnly] = useState(false);
  const [setupView, setSetupView] = useState<SetupView>("menu-products");
  const role = getStoredRole();
  const allowed = role === "admin" || role === "inventory_manager" || (readOnly && role === "chef");
  const visibleTabs = readOnly ? tabs.filter((tab) => tab.id === "stock") : tabs;

  if (!allowed) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold text-slate-950">Inventory access required</h1>
        <p className="max-w-md text-slate-600">Sign in with an admin or inventory manager account to manage stock.</p>
        <Link className="text-red-700 underline" to="/staff/login">
          Go to staff login
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 lg:pl-4 lg:pr-8">
      <div className="grid w-full gap-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase text-red-700">Staff</p>
            <h1 className="text-3xl font-semibold text-slate-950">Inventory Management</h1>
          </div>
          <p className="text-sm text-slate-500">Signed in as {role.replace("_", " ")}</p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
          <aside className="lg:sticky lg:top-6">
            <SectionNav activeTab={activeTab} orientation="vertical" tabs={visibleTabs} onTabChange={setActiveTab} />
          </aside>

          <section className="min-w-0">
            {activeTab === "overview" && !readOnly && (
              <InventoryOverview
                onNavigate={(target) => {
                  setActiveTab(target.section);
                  if (target.stockView) setStockView(target.stockView);
                  if (target.stockFilter) setMaterialsStockFilter(target.stockFilter);
                  if (target.batchExpiringOnly !== undefined) setBatchesExpiringOnly(target.batchExpiringOnly);
                }}
              />
            )}
            {activeTab === "stock" && (
              <div className="grid gap-4">
                {!readOnly && (
                  <div className="flex flex-wrap gap-2">
                    {([
                      ["materials", "Materials"],
                      ["batches", "Batches & Expiry"],
                      ["waste", "Waste Disposal"]
                    ] as const).map(([view, label]) => (
                      <button
                        key={view}
                        type="button"
                        onClick={() => setStockView(view)}
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
                {stockView === "batches" &&                                 <BatchManagement
                  initialExpiringOnly={batchesExpiringOnly}
                  onExpiringOnlyChange={setBatchesExpiringOnly}
                />}
                {stockView === "waste" && <WasteDisposal />}
              </div>
            )}
            {activeTab === "reservations" && !readOnly && <InventoryReservations />}
            {activeTab === "movements" && !readOnly && <InventoryMovements />}
            {activeTab === "setup" && !readOnly && (
              <div className="grid gap-4">
                <div className="flex flex-wrap gap-2">
                  {([
                    ["menu-products", "Menu Products"],
                    ["yield", "Yield Estimator"]
                  ] as const).map(([view, label]) => (
                    <button
                      key={view}
                      type="button"
                      onClick={() => setSetupView(view)}
                      className={`rounded-md px-3 py-2 text-sm font-semibold ${setupView === view ? "bg-red-700 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {setupView === "menu-products" && <SellingProductsList role={role} />}
                {setupView === "yield" && <YieldEstimator />}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
