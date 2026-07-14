import axios from "axios";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function getCandidateBaseUrls() {
  const urls = new Set<string>();
  const configured = import.meta.env.VITE_API_URL?.trim();

  if (import.meta.env.PROD && !configured) {
    throw new Error(
      "Missing VITE_API_URL in production. Set VITE_API_URL in Netlify to your Render backend URL."
    );
  }

  if (configured) {
    urls.add(trimTrailingSlash(configured));
  }

  if (import.meta.env.DEV && typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    urls.add(`${protocol}//${window.location.hostname}:5001`);

    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      urls.add("http://localhost:5001");
      urls.add("http://127.0.0.1:5001");
    }
  }

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

  // If the image path is rooted (starts with '/'), treat frontend-hosted
  // images (e.g. '/images/...') as static assets served by the site.
  // Only prefix the backend base URL for uploaded images under '/uploads/'.
  if (imageUrl.startsWith("/")) {
    if (imageUrl.startsWith("/uploads/")) {
      if (!activeBaseUrl) return imageUrl;
      return new URL(imageUrl, `${trimTrailingSlash(activeBaseUrl)}/`).toString();
    }

    return imageUrl;
  }

  if (!activeBaseUrl) {
    return imageUrl;
  }

  return new URL(imageUrl, `${trimTrailingSlash(activeBaseUrl)}/`).toString();
}

if (!activeBaseUrl && import.meta.env.PROD) {
  console.error(
    "Missing VITE_API_URL in production. Set VITE_API_URL in Netlify to your Render backend URL."
  );
}

export const api = axios.create({
  baseURL: activeBaseUrl,
  timeout: 10000,
  withCredentials: true
});

api.interceptors.request.use((config) => {
  if (import.meta.env.PROD && !activeBaseUrl) {
    throw new Error(
      "Missing VITE_API_URL in production. Set VITE_API_URL in Netlify to your Render backend URL."
    );
  }

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
