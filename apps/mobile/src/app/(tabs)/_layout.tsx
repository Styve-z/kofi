import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";
import { useAuth } from "@/lib/auth";
import { trpc } from "@/lib/trpc";
import { colors } from "@/theme";

const icon = (glyph: string) => ({ color }: { color: ColorValue }) => <Text style={{ color, fontSize: 18 }} accessible={false}>{glyph}</Text>;

export default function TabsLayout() {
  const auth = useAuth();
  const unread = trpc.notifications.unreadCount.useQuery(undefined, { enabled: Boolean(auth.user), refetchInterval: 60_000 });
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.mandarinDark, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border }, tabBarLabelStyle: { fontWeight: "700", fontSize: 12 } }}>
    <Tabs.Screen name="index" options={{ title: "Trouver", tabBarIcon: icon("⌕") }} />
    <Tabs.Screen name="reservations" options={{ title: "Réservations", tabBarIcon: icon("▤") }} />
    <Tabs.Screen name="compte" options={{ title: "Compte", tabBarIcon: icon("◎"), tabBarBadge: unread.data ? unread.data : undefined }} />
  </Tabs>;
}
