import { trpc } from "@/lib/trpc";
import { COOKIE_NAME, UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, splitLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { startLogin } from "./const";
import "./index.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } });

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  try {
    startLogin();
  } catch {
    // Connexion non configurée sur cet environnement : la page affiche déjà son propre message.
  }
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const authHeaders = () => {
  // Preview auto-login fallback: when the browser blocks iframe cookies
  // (Safari ITP / private browsing / WebView), the runtime mirrors the
  // session into sessionStorage so we can forward it as a Bearer token.
  // The regular OAuth cookie flow keeps working and takes priority server-side.
  try {
    const raw = sessionStorage.getItem("manus-cookie");
    if (raw) {
      const prefix = `${COOKIE_NAME}=`;
      const pair = raw.split(";").find(s => s.trim().startsWith(prefix));
      const token = pair?.trim().slice(prefix.length);
      if (token) return { Authorization: `Bearer ${token}` };
    }
  } catch {
    // sessionStorage unavailable
  }
  return {};
};
const withCredentials: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, { ...(init ?? {}), credentials: "include" });
const batch = () => httpBatchLink({ url: "/api/trpc", transformer: superjson, headers: authHeaders, fetch: withCredentials });

// Le catalogue public part dans des requêtes séparées : le service worker (public/sw.js) peut alors
// les garder pour le mode hors-ligne, sans jamais mettre en cache une réponse liée à la session.
const PUBLIC_CATALOG = new Set(["catalog.search", "catalog.professional", "catalog.categories"]);

const trpcClient = trpc.createClient({
  links: [splitLink({ condition: (op) => op.type === "query" && PUBLIC_CATALOG.has(op.path), true: batch(), false: batch() })],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);

// Mode hors-ligne léger (voir public/sw.js) : uniquement en production, pour ne pas gêner le rechargement à chaud.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => console.warn("[KOFI] Service worker non enregistré", error));
  });
}
