import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { Button, Card, ErrorBox, Loading, Muted, Screen, styles, Title } from "@/components/ui";
import { trpc } from "@/lib/trpc";
import { colors } from "@/theme";
import { useAuth } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import { errorText } from "@/lib/format";

export default function AccountScreen() {
  const auth = useAuth();
  const utils = trpc.useUtils();
  const list = trpc.notifications.list.useQuery({ limit: 20 }, { enabled: Boolean(auth.user) });
  const markRead = trpc.notifications.markRead.useMutation({ onSuccess: () => utils.notifications.invalidate() });
  const unread = list.data?.filter((item) => !item.read).length ?? 0;
  if (auth.loading) return <Screen><Loading /></Screen>;
  return <Screen>
    <Title eyebrow="Compte">{auth.user ? `Bonjour ${auth.user.name ?? ""}`.trim() : "Votre compte KOFI"}</Title>
    {auth.user ? <>
      <Muted>Vous êtes connecté sur ce téléphone. Vos réservations sont les mêmes que sur le site.</Muted>
      <View style={[styles.row, { justifyContent: "space-between", marginTop: 6 }]}><Text style={{ fontSize: 18, fontWeight: "800", color: colors.ink }}>Notifications{unread ? ` (${unread})` : ""}</Text>{unread > 0 && <Pressable accessibilityRole="button" onPress={() => markRead.mutate({})}><Text style={styles.link}>Tout lire</Text></Pressable>}</View>
      {!list.data?.length ? <Muted>Rien de nouveau pour l’instant.</Muted> : list.data.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => { if (!item.read) markRead.mutate({ id: item.id }); if (item.link?.startsWith("/mes-reservations")) router.push("/reservations"); }}>
        <Card style={!item.read ? { borderColor: "#F4B593" } : undefined}><Text style={{ fontWeight: "800", color: colors.ink }}>{!item.read ? "● " : ""}{item.title}</Text>{!!item.body && <Muted>{item.body}</Muted>}</Card>
      </Pressable>)}
      <Button label="Se déconnecter de ce téléphone" variant="outline" onPress={auth.logout} />
    </> : <>
      <Muted>La connexion passe par le site KOFI : aucun mot de passe n’est enregistré dans l’application.</Muted>
      {auth.error && <ErrorBox message={errorText(auth.error)} />}
      <Button label="Se connecter" loading={auth.signingIn} onPress={auth.login} />
    </>}
    <Card>
      <Muted>Vous êtes professionnel de la beauté ? Gérez vos demandes, prestations et horaires depuis l’espace professionnel du site.</Muted>
      <Button label="Ouvrir l’espace professionnel" variant="ghost" onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/professionnel`)} />
    </Card>
  </Screen>;
}
