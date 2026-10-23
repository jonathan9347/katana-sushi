import { create } from "zustand";

export type PosProduct = {
  id: string;
  name: string;
  category: string;
  price: string | number;
  is_available?: boolean;
  available_stock?: number | null;
  is_included?: boolean;
  is_sold_a_la_carte?: boolean;
  cart_compatibility?: {
    a_la_carte: { allowed: boolean; classification: string; message?: string };
    unlimited: { allowed: boolean; classification: string; message?: string };
  };
};

export type PosCartKey = "takeout" | "dine_in_ala_carte" | "dine_in_unlimited";

export type CartItem = {
  product: PosProduct;
  quantity: number;
  diningOrderType?: "ala_carte" | "unlimited";
};

type CartState = {
  carts: Record<PosCartKey, CartItem[]>;
  activeCartKey: PosCartKey;
  dineOrderType: "ala_carte" | "unlimited";
  dineHeadcount: number;
  items: CartItem[];
  addItem: (product: PosProduct) => void;
  addItemTo: (cartKey: PosCartKey, product: PosProduct, quantity?: number, diningOrderType?: CartItem["diningOrderType"]) => void;
  removeItem: (productId: string) => void;
  removeItemFrom: (cartKey: PosCartKey, productId: string, diningOrderType?: CartItem["diningOrderType"]) => void;
  decrementItem: (productId: string) => void;
  decrementItemFrom: (cartKey: PosCartKey, productId: string, diningOrderType?: CartItem["diningOrderType"]) => void;
  setItemsFor: (cartKey: PosCartKey, items: CartItem[]) => void;
  selectCart: (cartKey: PosCartKey) => void;
  setDineOrderType: (orderType: "ala_carte" | "unlimited") => void;
  setDineHeadcount: (headcount: number) => void;
  rotateDraftKey: (cartKey: PosCartKey) => void;
  draftKeys: Record<PosCartKey, string>;
  clearCart: () => void;
  clearCartFor: (cartKey: PosCartKey) => void;
};

const emptyCarts = (): Record<PosCartKey, CartItem[]> => ({
  takeout: [],
  dine_in_ala_carte: [],
  dine_in_unlimited: []
});

const newDraftKeys = (): Record<PosCartKey, string> => ({
  takeout: crypto.randomUUID(),
  dine_in_ala_carte: crypto.randomUUID(),
  dine_in_unlimited: crypto.randomUUID()
});

function addProduct(
  items: CartItem[],
  product: PosProduct,
  quantity: number,
  diningOrderType?: CartItem["diningOrderType"]
) {
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    (product.available_stock != null &&
      items.filter((item) => item.product.id === product.id).reduce((total, item) => total + item.quantity, 0) + quantity > product.available_stock)
  ) {
    return items;
  }

  const existingItem = items.find((item) =>
    item.product.id === product.id && item.diningOrderType === diningOrderType
  );
  if (existingItem) {
    return items.map((item) =>
      item.product.id === product.id && item.diningOrderType === diningOrderType
        ? { ...item, product, quantity: item.quantity + quantity }
        : item
    );
  }

  return [...items, { product, quantity, diningOrderType }];
}

function decrementProduct(items: CartItem[], productId: string, diningOrderType?: CartItem["diningOrderType"]) {
  return items
    .map((item) =>
      item.product.id === productId
        && (diningOrderType === undefined || item.diningOrderType === diningOrderType)
        ? { ...item, quantity: item.quantity - 1 }
        : item
    )
    .filter((item) => item.quantity > 0);
}

export const usePosCart = create<CartState>((set, get) => ({
  carts: emptyCarts(),
  activeCartKey: "takeout",
  dineOrderType: "ala_carte",
  dineHeadcount: 1,
  draftKeys: newDraftKeys(),
  items: [],
  addItem: (product) =>
    get().addItemTo(get().activeCartKey, product),
  addItemTo: (cartKey, product, quantity = 1, diningOrderType) =>
    set((state) => {
      const items = addProduct(state.carts[cartKey], product, quantity, diningOrderType);
      if (items === state.carts[cartKey]) return state;
      const carts = { ...state.carts, [cartKey]: items };
      return { carts, ...(state.activeCartKey === cartKey ? { items } : {}) };
    }),
  removeItem: (productId) => get().removeItemFrom(get().activeCartKey, productId),
  removeItemFrom: (cartKey, productId, diningOrderType) =>
    set((state) => {
      const items = state.carts[cartKey].filter((item) =>
        item.product.id !== productId
        || (diningOrderType !== undefined && item.diningOrderType !== diningOrderType)
      );
      const carts = { ...state.carts, [cartKey]: items };
      return { carts, ...(state.activeCartKey === cartKey ? { items } : {}) };
    }),
  decrementItem: (productId) => get().decrementItemFrom(get().activeCartKey, productId),
  decrementItemFrom: (cartKey, productId, diningOrderType) =>
    set((state) => {
      const items = decrementProduct(state.carts[cartKey], productId, diningOrderType);
      const carts = { ...state.carts, [cartKey]: items };
      return { carts, ...(state.activeCartKey === cartKey ? { items } : {}) };
    }),
  setItemsFor: (cartKey, items) =>
    set((state) => {
      const carts = { ...state.carts, [cartKey]: items };
      return { carts, ...(state.activeCartKey === cartKey ? { items } : {}) };
    }),
  selectCart: (activeCartKey) => set((state) => ({
    activeCartKey,
    items: state.carts[activeCartKey]
  })),
  setDineOrderType: (dineOrderType) => set({ dineOrderType }),
  setDineHeadcount: (dineHeadcount) => set({ dineHeadcount }),
  rotateDraftKey: (cartKey) =>
    set((state) => ({
      draftKeys: { ...state.draftKeys, [cartKey]: crypto.randomUUID() }
    })),
  clearCart: () => get().clearCartFor(get().activeCartKey),
  clearCartFor: (cartKey) =>
    set((state) => {
      const carts = { ...state.carts, [cartKey]: [] };
      return { carts, ...(state.activeCartKey === cartKey ? { items: [] } : {}) };
    })
}));
