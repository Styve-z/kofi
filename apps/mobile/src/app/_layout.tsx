import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import superjson from "superjson";
import { AuthProvider } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import { currentToken, loadToken } from "@/lib/session";
import { trpc } from "@/lib/trpc";
import { colors } from "@/theme";

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }));
  const [trpcClient] = useState(() => trpc.createClient({
    links: [httpBatchLink({
      url: `${API_URL}/api/trpc`,
      transformer: superjson,
      // L’app s’identifie avec son jeton (pas de cookie).
      headers: () => { const token = currentToken(); return token ? { Authorization: `Bearer ${token}` } : {}; },
    })],
  }));

  useEffect(() => { loadToken().finally(() => { setReady(true); SplashScreen.hideAsync().catch(() => undefined); }); }, []);
  if (!ready) return null;

  return <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerTintColor: colors.ink, headerStyle: { backgroundColor: colors.sand }, headerShadowVisible: false, contentStyle: { backgroundColor: colors.sand }, headerBackTitle: "Retour" }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="pro/[slug]" options={{ title: "" }} />
          <Stack.Screen name="reservation" options={{ title: "Réservation" }} />
          <Stack.Screen name="confirmation" options={{ title: "Demande envoyée", headerBackVisible: false, gestureEnabled: false }} />
          <Stack.Screen name="auth" options={{ headerShown: false }} />
        </Stack>
      </AuthProvider>
    </QueryClientProvider>
  </trpc.Provider>;
}
