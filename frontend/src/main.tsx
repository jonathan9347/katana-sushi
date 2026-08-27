import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, useLocation } from "react-router-dom";
import App from "./App";
import { getActiveApiBaseUrl } from "./lib/api";
import "./index.css";

const queryClient = new QueryClient();

function warmAssetConnections() {
  const apiBaseUrl = getActiveApiBaseUrl();
  const head = document.head;

  if (apiBaseUrl) {
    const preconnect = document.createElement("link");
    preconnect.rel = "preconnect";
    preconnect.href = apiBaseUrl;
    preconnect.crossOrigin = "anonymous";
    head.appendChild(preconnect);
  }

  ["/images/Menu-head.png", "/images/sushi2.png", "/images/sushi4.png", "/images/sushi5.png"].forEach((href) => {
    const preload = document.createElement("link");
    preload.rel = "prefetch";
    preload.as = "image";
    preload.href = href;
    head.appendChild(preload);
  });
}

warmAssetConnections();

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);

  return null;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ScrollToTop />
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
