import axios from "axios";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function getCandidateBaseUrls() {
  const urls = new Set<string>();
  const configured = import.meta.env.VITE_API_URL;

  if (configured) {
    urls.add(trimTrailingSlash(configured));
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    urls.add(`${protocol}//${window.location.hostname}:5001`);

    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      urls.add("http://localhost:5001");
      urls.add("http://127.0.0.1:5001");
    }
  }

  urls.add("http://localhost:5001");

  return Array.from(urls);
}

const apiBaseUrls = getCandidateBaseUrls();
let activeBaseUrl = apiBaseUrls[0];

export function resolveImageUrl(imageUrl?: string | null) {
  if (!imageUrl) {
    return null;
  }

  if (/^(data:|blob:|https?:\/\/|\/\/)/i.test(imageUrl)) {
    return imageUrl;
  }

  const baseUrl = activeBaseUrl || apiBaseUrls[0] || "http://localhost:5001";
  return new URL(imageUrl, `${trimTrailingSlash(baseUrl)}/`).toString();
}

export const api = axios.create({
  baseURL: activeBaseUrl,
  timeout: 10000,
  withCredentials: true
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("katana_token");

  config.baseURL = activeBaseUrl;

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    const config = axios.isAxiosError(error) ? error.config : undefined;
    const method = config?.method?.toUpperCase() ?? "GET";
    const isPaymentRequest =
      config?.url === "/api/payments/create-intent" ||
      config?.url === "/api/payments/verify";
    const canRetryOnNextBaseUrl =
      axios.isAxiosError(error) &&
      !error.response &&
      config &&
      (method === "GET" || config.url === "/api/auth/login" || isPaymentRequest);

    if (canRetryOnNextBaseUrl) {
      const currentIndex = apiBaseUrls.indexOf(activeBaseUrl);
      const nextBaseUrl = apiBaseUrls[currentIndex + 1];

      if (nextBaseUrl) {
        activeBaseUrl = nextBaseUrl;
        config.baseURL = nextBaseUrl;
        return api.request(config);
      }
    }

    if (status === 401 && window.location.pathname !== "/staff/login") {
      localStorage.removeItem("katana_token");
      localStorage.removeItem("katana_role");
      localStorage.removeItem("katana_user");
      window.location.href = "/staff/login";
    }

    return Promise.reject(error);
  }
);
