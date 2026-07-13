export function useToast() {
  return {
    toast(message: string) {
      window.alert(message);
    }
  };
}
