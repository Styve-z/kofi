import ErrorBoundary from "./components/ErrorBoundary";
import KofiApp from "./pages/Kofi";

/** Le client API et le cache de requêtes sont créés une seule fois, dans main.tsx. */
export default function App() {
  return <ErrorBoundary><KofiApp /></ErrorBoundary>;
}
