import { DashboardWidget } from "./DashboardWidget";

export default function ChefDashboard() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-3 lg:grid-cols-2">
        <DashboardWidget title="Today's Orders" icon="🍣" value={15} subtitle="Orders to prepare" />
        <DashboardWidget title="Prep Required" icon="🔪" value="8 items" subtitle="Ingredients to stage" />
        <DashboardWidget title="Critical Stock" icon="⚠️" value={1} subtitle="Low stock items" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <DashboardWidget title="Today's Prep List" icon="🍣" value="" subtitle="Kitchen items to prepare">
          <ul className="space-y-3 text-sm text-slate-700">
            <li>• California Maki x12</li>
            <li>• Mango Roll x8</li>
            <li>• Salmon Nigiri x20</li>
            <li>• Volcano Roll x6</li>
          </ul>
        </DashboardWidget>

        <DashboardWidget title="Inventory Levels" icon="📦" value="" subtitle="Current kitchen stock">
          <ul className="space-y-3 text-sm text-slate-700">
            <li>• Rice: 50kg (Available)</li>
            <li>• Salmon: 3kg (Low)</li>
            <li>• Tuna: 8kg (Available)</li>
            <li>• Nori: 500 sheets (Available)</li>
          </ul>
        </DashboardWidget>
      </div>
    </div>
  );
}
