import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { ChevronDown, ChevronRight, Plus, Search } from "lucide-react";
import ProductCard, { MenuProduct } from "../../../components/inventory/ProductCard";
import ProductModal, { ProductForm } from "../../../components/inventory/ProductModal";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { api } from "../../../lib/api";
import { useToast } from "../../../hooks/useToast";
import { StaffRole } from "./types";

type SellingProductsListProps = {
  role: StaffRole;
};

const defaultCategories = [
  "Classic Roll",
  "Fried Roll",
  "Futo Maki",
  "Hoso Maki",
  "Special Roll",
  "Nigiri",
  "Sashimi",
  "Baked Sushi",
  "Platter",
  "Spring Roll",
  "Gyozai",
  "Beverage"
];

export default function SellingProductsList({ role }: SellingProductsListProps) {
  const [search, setSearch] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<MenuProduct | null>(null);
  const isAdmin = role === "admin";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const response = await api.get<{ products: MenuProduct[] }>("/api/products?include_recipes=true");
      return response.data.products;
    }
  });

  const categories = useMemo(() => {
    const productCategories = new Set((productsQuery.data ?? []).map((product) => product.category));
    const extraCategories = Array.from(productCategories)
      .filter((category) => !defaultCategories.includes(category))
      .sort();
    return [...defaultCategories, ...extraCategories];
  }, [productsQuery.data]);

  const filteredProducts = useMemo(() => {
    const normalizedSearch = search.toLowerCase();

    return (productsQuery.data ?? []).filter((product) =>
      `${product.name} ${product.category}`.toLowerCase().includes(normalizedSearch)
    );
  }, [productsQuery.data, search]);

  const productGroups = useMemo(() => {
    const productsByCategory = new Map<string, MenuProduct[]>();

    filteredProducts.forEach((product) => {
      productsByCategory.set(product.category, [...(productsByCategory.get(product.category) ?? []), product]);
    });

    return categories
      .map((category) => ({
        category,
        products: productsByCategory.get(category) ?? []
      }))
      .filter((group) => group.products.length > 0);
  }, [categories, filteredProducts]);

  const saveProductMutation = useMutation({
    mutationFn: async (form: ProductForm) => {
      const formData = new FormData();
      formData.append("name", form.name);
      formData.append("category", form.category);
      formData.append("price", String(form.price));
      formData.append("description", form.description || "");
      formData.append("is_available", String(form.is_available));
      if (form.imageFile) {
        formData.append("imageFile", form.imageFile);
      }

      const recipePayload = {
        ingredients: form.ingredients.map((ingredient) => ({
          rawMaterialId: ingredient.rawMaterialId,
          quantity: Number(ingredient.quantity),
          unit: ingredient.unit
        }))
      };

      if (selectedProduct) {
        const response = await api.put(`/api/products/${selectedProduct.id}`, formData);
        await api.post(`/api/products/${selectedProduct.id}/recipe`, recipePayload);
        return response;
      }

      const response = await api.post<{ product: MenuProduct }>("/api/products", formData);
      await api.post(`/api/products/${response.data.product.id}/recipe`, recipePayload);
      return response;
    },
    onSuccess: () => {
      setModalOpen(false);
      setSelectedProduct(null);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventory", "yield"] });
      toast(selectedProduct ? "Product updated." : "Product added.");
    },
    onError: (error) => {
      const message = axios.isAxiosError<{ message?: string }>(error)
        ? error.response?.data?.message
        : null;
      toast(message ?? "Unable to save product.");
    }
  });

  const toggleAvailableMutation = useMutation({
    mutationFn: async (product: MenuProduct) =>
      api.put(`/api/products/${product.id}`, { is_available: product.is_available === false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast("Availability updated.");
    },
    onError: () => toast("Unable to update availability.")
  });

  const deleteProductMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProduct) {
        return null;
      }

      return api.delete(`/api/products/${selectedProduct.id}`);
    },
    onSuccess: () => {
      setModalOpen(false);
      setSelectedProduct(null);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventory", "yield"] });
      toast("Product deleted.");
    },
    onError: () => toast("Unable to delete product.")
  });

  function openAddModal() {
    setSelectedProduct(null);
    setModalOpen(true);
  }

  function openEditModal(product: MenuProduct) {
    setSelectedProduct(product);
    setModalOpen(true);
  }

  function deleteProduct() {
    if (window.confirm("Are you sure? This will soft delete the product and hide it from POS and menu views.")) {
      deleteProductMutation.mutate();
    }
  }

  function toggleCategory(category: string) {
    setCollapsedCategories((current) => ({
      ...current,
      [category]: !current[category]
    }));
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <CardTitle>Menu Products</CardTitle>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="h-10 w-full rounded-md border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100 sm:w-72"
              placeholder="Search products"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {isAdmin && (
            <Button onClick={openAddModal}>
              <Plus className="mr-2 h-4 w-4" />
              Add New Product
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {productsQuery.isLoading && <p className="text-sm text-slate-500">Loading products...</p>}
        {productsQuery.isError && <p className="text-sm text-red-700">Unable to load products.</p>}
        {productsQuery.data && productGroups.length === 0 && <p className="text-sm text-slate-500">No products found.</p>}
        {productsQuery.data && productGroups.length > 0 && (
          <div className="grid gap-5">
            {productGroups.map((group) => {
              const collapsed = collapsedCategories[group.category] ?? false;

              return (
                <section key={group.category} className="grid gap-3">
                  <button
                    className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:bg-slate-100"
                    type="button"
                    onClick={() => toggleCategory(group.category)}
                  >
                    <span className="flex items-center gap-2">
                      {collapsed ? <ChevronRight className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
                      <span className="text-sm font-semibold uppercase text-slate-900">{group.category}</span>
                    </span>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                      {group.products.length} {group.products.length === 1 ? "item" : "items"}
                    </span>
                  </button>
                  {!collapsed && (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                      {group.products.map((product) => (
                        <ProductCard
                          key={product.id}
                          canEdit={isAdmin}
                          product={product}
                          onEdit={openEditModal}
                          onToggleAvailable={(item) => isAdmin && toggleAvailableMutation.mutate(item)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </CardContent>

      <ProductModal
        canDelete={isAdmin}
        categories={categories}
        deletePending={deleteProductMutation.isPending}
        open={modalOpen}
        pending={saveProductMutation.isPending}
        product={selectedProduct}
        onClose={() => setModalOpen(false)}
        onDelete={deleteProduct}
        onSubmit={(form) => saveProductMutation.mutate(form)}
      />
    </Card>
  );
}
