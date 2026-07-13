import { DashboardWidget } from "./DashboardWidget";

export default function InventoryDashboard() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-4 lg:grid-cols-2">
        <DashboardWidget title="Total Materials" icon="📦" value={26} subtitle="Items tracked in inventory" />
        <DashboardWidget title="Low Stock" icon="⚠️" value={3} subtitle="Items below reorder level" />
        <DashboardWidget title="Critical" icon="🔥" value={1} subtitle="Urgent restock required" />
        <DashboardWidget title="Yield Estimate" icon="💹" value="₱45,000" subtitle="Potential value from current stock" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <DashboardWidget title="Inventory Summary" icon="📦" value="" subtitle="Current material levels">
          <ul className="space-y-3 text-sm text-slate-700">
            <li>• Rice: 50kg (80%)</li>
            <li>• Salmon: 12kg (60%)</li>
            <li>• Tuna: 8kg (40%)</li>
            <li>• Nori: 500 sheets</li>
          </ul>
        </DashboardWidget>

        <DashboardWidget title="Low Stock Alerts" icon="⚠️" value="" subtitle="Materials to review">
          <ul className="space-y-3 text-sm text-slate-700">
            <li>• Rice – 5kg left (reorder)</li>
            <li>• Salmon – 3kg left (critical)</li>
            <li>• Nori – 50 sheets left</li>
          </ul>
        </DashboardWidget>
      </div>
    </div>
  );
}
