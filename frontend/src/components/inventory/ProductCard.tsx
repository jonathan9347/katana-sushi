import { Edit } from "lucide-react";
import { resolveImageUrl } from "../../lib/api";
import { Button } from "../ui/button";

export type MenuProduct = {
  id: string;
  name: string;
  category: string;
  price: string | number;
  description?: string | null;
  image_url?: string | null;
  is_available?: boolean;
  recipes?: Array<{
    recipe_ingredients: Array<{
      id: string;
      raw_material_id: string;
      quantity_per_yield: string | number;
      unit: string;
      raw_material: {
        id: string;
        name: string;
        unit: string;
        cost_per_unit: string | number;
      };
    }>;
  }>;
};

type ProductCardProps = {
  product: MenuProduct;
  canEdit: boolean;
  onEdit: (product: MenuProduct) => void;
  onToggleAvailable: (product: MenuProduct) => void;
};

export default function ProductCard({ canEdit, product, onEdit, onToggleAvailable }: ProductCardProps) {
  const available = product.is_available !== false;
  const imageSrc = resolveImageUrl(product.image_url);

  return (
    <article className="grid min-h-[300px] gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {imageSrc ? (
        <div className="h-40 overflow-hidden rounded-lg bg-slate-100">
          <img src={imageSrc} alt={product.name} className="h-full w-full object-cover" />
        </div>
      ) : (
        <div className="flex h-40 items-center justify-center rounded-lg bg-slate-100 text-5xl">🍣</div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="line-clamp-2 font-semibold text-slate-950">{product.name}</h3>
          <span className="mt-2 inline-flex rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
            {product.category}
          </span>
        </div>
        {canEdit && (
          <Button aria-label={`Edit ${product.name}`} size="sm" variant="ghost" onClick={() => onEdit(product)}>
            <Edit className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between gap-3">
        <p className="text-lg font-semibold text-slate-950">PHP {Number(product.price).toLocaleString()}</p>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          <input
            checked={available}
            className="h-4 w-4 accent-red-700"
            disabled={!canEdit}
            type="checkbox"
            onChange={() => onToggleAvailable(product)}
          />
          Available
        </label>
      </div>
    </article>
  );
}
