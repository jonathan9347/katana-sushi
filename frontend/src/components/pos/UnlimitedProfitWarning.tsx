type UnlimitedProfitWarningProps = {
  foodCost: number;
  customerPaid: number;
};

export default function UnlimitedProfitWarning({ customerPaid, foodCost }: UnlimitedProfitWarningProps) {
  const profit = customerPaid - foodCost;
  const margin = customerPaid > 0 ? (profit / customerPaid) * 100 : 0;

  if (margin > 15) {
    return null;
  }

  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">
      Profit warning: estimated margin is {margin.toFixed(1)}%.
    </div>
  );
}
