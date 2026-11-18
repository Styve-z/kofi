import { router, useLocalSearchParams } from "expo-router";
import { Text } from "react-native";
import { Button, Card, Muted, Screen, Title } from "@/components/ui";
import { formatSlot, formatXaf } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { colors } from "@/theme";

export default function ConfirmationScreen() {
  const { ref } = useLocalSearchParams<{ ref: string }>();
  const mine = trpc.booking.mine.useQuery();
  const booking = mine.data?.find((item) => item.reference === ref);
  return <Screen edges={[]}>
    <Title eyebrow="Demande enregistrée">Votre place est posée.</Title>
    <Card>
      {booking ? <><Text style={{ fontWeight: "800", color: colors.ink, fontSize: 16 }}>{booking.professional.name}</Text><Muted>{formatSlot(booking.startsAt)} · {formatXaf(booking.totalXaf)}</Muted></> : null}
      <Muted>Référence {ref}. Votre demande est en attente de confirmation par le professionnel.</Muted>
    </Card>
    <Button label="Voir mes réservations" onPress={() => router.replace("/reservations")} />
    <Button label="Retour à la recherche" variant="ghost" onPress={() => router.replace("/")} />
  </Screen>;
}
