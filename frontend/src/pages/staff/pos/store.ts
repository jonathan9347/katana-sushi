import { create } from "zustand";

export type PosProduct = {
  id: string;
  name: string;
  category: string;
  price: string | number;
  is_available?: boolean;
};

export type CartItem = {
  product: PosProduct;
  quantity: number;
};

type CartState = {
  items: CartItem[];
  addItem: (product: PosProduct) => void;
  removeItem: (productId: string) => void;
  decrementItem: (productId: string) => void;
  clearCart: () => void;
};

export const usePosCart = create<CartState>((set) => ({
  items: [],
  addItem: (product) =>
    set((state) => {
      const existingItem = state.items.find((item) => item.product.id === product.id);

      if (existingItem) {
        return {
          items: state.items.map((item) =>
            item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
          )
        };
      }

      return { items: [...state.items, { product, quantity: 1 }] };
    }),
  removeItem: (productId) => set((state) => ({ items: state.items.filter((item) => item.product.id !== productId) })),
  decrementItem: (productId) =>
    set((state) => ({
      items: state.items
        .map((item) => (item.product.id === productId ? { ...item, quantity: item.quantity - 1 } : item))
        .filter((item) => item.quantity > 0)
    })),
  clearCart: () => set({ items: [] })
}));
