export type ToastKind = "success" | "error";

type ToastMessage = {
  message: string;
  kind: ToastKind;
};

export function useToast() {
  return {
    toast(message: string, kind: ToastKind = "success") {
      window.dispatchEvent(new CustomEvent<ToastMessage>("katana-toast", {
        detail: { message, kind }
      }));
    }
  };
}
