import { useState } from "react";
import { Link } from "react-router-dom";
import { Boxes, Calculator, CalendarClock, ClipboardList, PackageSearch, ReceiptText, Scale, Trash2 } from "lucide-react";
import SectionNav, { SectionNavTab } from "../../../components/layout/SectionNav";
import BatchManagement from "./BatchManagement";
import ConversionRulesEditor from "./ConversionRulesEditor";
import LowStockAlert from "./LowStockAlert";
import MaterialsList from "./MaterialsList";
import SellingProductsList from "./SellingProductsList";
import TransactionHistory from "./TransactionHistory";
import WasteDisposal from "./WasteDisposal";
import YieldEstimator from "./YieldEstimator";
import { StaffRole } from "./types";

type InventoryTab = "materials" | "menu-products" | "yield" | "low-stock" | "batches" | "waste" | "transactions" | "conversion-rules";

const tabs: Array<SectionNavTab<InventoryTab> & { adminOnly?: boolean }> = [
  { id: "materials", label: "Materials", icon: <Boxes className="h-4 w-4" /> },
  { id: "menu-products", label: "Menu Products", icon: <PackageSearch className="h-4 w-4" /> },
  { id: "yield", label: "Yield Estimator", icon: <Calculator className="h-4 w-4" /> },
  { id: "low-stock", label: "Low Stock Alerts", icon: <ClipboardList className="h-4 w-4" /> },
  { id: "batches", label: "Batches & Expiry", icon: <CalendarClock className="h-4 w-4" /> },
  { id: "waste", label: "Waste Disposal", icon: <Trash2 className="h-4 w-4" /> },
  { id: "transactions", label: "Transactions", icon: <ReceiptText className="h-4 w-4" /> },
  { id: "conversion-rules", label: "Conversion Rules", icon: <Scale className="h-4 w-4" />, adminOnly: true }
];

function getStoredRole(): StaffRole {
  if (!localStorage.getItem("katana_token")) {
    return "staff";
  }

  return (localStorage.getItem("katana_role")?.toLowerCase() as StaffRole | null) ?? "staff";
}

export default function InventoryPage({ readOnly = false }: { readOnly?: boolean }) {
  const [activeTab, setActiveTab] = useState<InventoryTab>("materials");
  const role = getStoredRole();
  const allowed = role === "admin" || role === "inventory_manager" || (readOnly && role === "chef");
  const visibleTabs = readOnly
    ? tabs.filter((tab) => tab.id === "materials")
    : tabs.filter((tab) => !tab.adminOnly || role === "admin");

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
    <main className="min-h-screen bg-slate-100 px-4 py-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase text-red-700">Staff</p>
            <h1 className="text-3xl font-semibold text-slate-950">Inventory Management</h1>
          </div>
          <p className="text-sm text-slate-500">Signed in as {role.replace("_", " ")}</p>
        </div>

        <SectionNav activeTab={activeTab} tabs={visibleTabs} onTabChange={setActiveTab} />

        {activeTab === "materials" && <MaterialsList role={role} />}
        {activeTab === "menu-products" && <SellingProductsList role={role} />}
        {activeTab === "yield" && <YieldEstimator />}
        {activeTab === "low-stock" && <LowStockAlert />}
        {activeTab === "batches" && <BatchManagement />}
        {activeTab === "waste" && <WasteDisposal />}
        {activeTab === "transactions" && <TransactionHistory />}
        {activeTab === "conversion-rules" && role === "admin" && <ConversionRulesEditor />}
      </div>
    </main>
  );
}
