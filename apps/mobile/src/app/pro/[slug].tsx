import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Image, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { API_URL } from "@/lib/config";
import { Badge, Button, Card, Chip, ErrorBox, Loading, Muted, Notice, Screen, Stars, styles, Title } from "@/components/ui";
import { errorText, formatDayLabel, formatDuration, formatSlot, formatTime, formatXaf, modeLabel, upcomingDays } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { colors } from "@/theme";

export default function ProfessionalScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const pro = trpc.catalog.professional.useQuery({ slug: String(slug) });
  const days = useMemo(() => upcomingDays(14), []);
  const [selected, setSelected] = useState<string[]>([]);
  const [day, setDay] = useState(days[0]);
  const [startsAt, setStartsAt] = useState("");
  const [mode, setMode] = useState<"salon" | "domicile">("salon");
  useEffect(() => { if (pro.data?.mode === "domicile") setMode("domicile"); }, [pro.data?.mode]);
  useEffect(() => setStartsAt(""), [day, selected]);
  const reviews = trpc.catalog.reviews.useQuery({ slug: String(slug), limit: 10 });
  const photos = trpc.catalog.portfolio.useQuery({ slug: String(slug) });
  const absolute = (url: string) => (url.startsWith("/") ? `${API_URL}${url}` : url);
  const slots = trpc.catalog.slots.useQuery({ slug: String(slug), day, serviceIds: selected }, { enabled: selected.length > 0 && Boolean(pro.data) });

  if (pro.isLoading) return <Screen><Loading /></Screen>;
  if (pro.error) return <Screen><ErrorBox message={errorText(pro.error.message)} onRetry={() => pro.refetch()} /></Screen>;
  if (!pro.data) return <Screen><Title>Profil introuvable</Title><Muted>Ce profil n’existe pas ou n’est plus disponible.</Muted></Screen>;
  const p = pro.data;
  const chosen = p.services.filter((service) => selected.includes(service.id));
  const total = chosen.reduce((sum, service) => sum + service.price, 0);
  const duration = chosen.reduce((sum, service) => sum + service.duration, 0);
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  return <Screen edges={[]}>
    <Stack.Screen options={{ title: p.name }} />
    <View style={styles.row}>
      <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: p.accent, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#fff", fontWeight: "800", fontSize: 24 }}>{p.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</Text></View>
      <View style={{ flex: 1, gap: 4 }}>{p.verified ? <Badge label="Professionnel vérifié" tone="green" /> : <Badge label="En cours de vérification" tone="orange" />}<Text style={{ fontSize: 22, fontWeight: "800", color: colors.ink }}>{p.name}</Text><Muted>{p.salon} · {p.neighborhood ? `${p.neighborhood}, ` : ""}{p.city}</Muted></View>
    </View>
    {!!p.bio && <Muted>{p.bio}</Muted>}
    {!!photos.data?.length && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityLabel="Réalisations vérifiées">
      {photos.data.map((photo) => <Pressable key={photo.id} accessibilityRole="imagebutton" accessibilityLabel={photo.description ?? "Réalisation"} onPress={() => Linking.openURL(absolute(photo.url))}>
        <Image source={{ uri: absolute(photo.thumbUrl) }} style={{ width: 120, height: 120, borderRadius: 12, backgroundColor: "#EFE6DC" }} />
      </Pressable>)}
    </ScrollView>}
    <Muted>{p.reviewCount ? `★ ${p.rating.toFixed(1)} (${p.reviewCount} avis)` : "Nouveau sur KOFI"} · {modeLabel(p.mode)}</Muted>

    <Text style={{ fontSize: 18, fontWeight: "800", color: colors.ink, marginTop: 6 }}>Prestations</Text>
    {p.services.map((service) => { const on = selected.includes(service.id); return <Pressable key={service.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${service.name}, ${formatXaf(service.price)}`} onPress={() => toggle(service.id)}>
      <Card style={[{ flexDirection: "row", alignItems: "center", gap: 12 }, on && { borderColor: colors.leaf, backgroundColor: colors.leafSoft }]}>
        <View style={{ flex: 1 }}><Text style={{ fontWeight: "800", color: colors.ink }}>{service.name}</Text><Muted>{formatDuration(service.duration)} · {service.category}</Muted></View>
        <View style={{ alignItems: "flex-end" }}><Text style={{ fontWeight: "800", color: colors.ink }}>{formatXaf(service.price)}</Text><Text style={{ color: on ? colors.leaf : colors.mandarinDark, fontWeight: "800" }}>{on ? "✓ Ajoutée" : "Ajouter"}</Text></View>
      </Card>
    </Pressable>; })}

    {!selected.length ? <Notice>Choisissez au moins une prestation : les créneaux libres s’affichent selon la durée totale.</Notice> : <>
      <Text style={{ fontSize: 18, fontWeight: "800", color: colors.ink, marginTop: 6 }}>Votre créneau</Text>
      <Muted>Horaires en heure de Douala.</Muted>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{days.map((item) => <Chip key={item} label={formatDayLabel(item)} selected={day === item} onPress={() => setDay(item)} />)}</ScrollView>
      {slots.isLoading ? <Loading label="Recherche des créneaux…" /> : slots.error ? <ErrorBox message={errorText(slots.error.message)} onRetry={() => slots.refetch()} /> : !slots.data?.startsAt.length ? <Muted>Aucun créneau libre ce jour-là. Essayez un autre jour.</Muted>
        : <View style={styles.wrap} accessibilityLabel="Heures disponibles">{slots.data.startsAt.map((iso) => <Chip key={iso} label={formatTime(iso)} selected={startsAt === iso} onPress={() => setStartsAt(iso)} />)}</View>}
      {p.mode === "les deux" && <View style={styles.wrap}><Chip label="Au salon" selected={mode === "salon"} onPress={() => setMode("salon")} /><Chip label="À domicile" selected={mode === "domicile"} onPress={() => setMode("domicile")} /></View>}
      <Card>
        <View style={[styles.row, { justifyContent: "space-between" }]}><Muted>{chosen.length} prestation{chosen.length > 1 ? "s" : ""}</Muted><Muted>{formatDuration(duration)}</Muted></View>
        <View style={[styles.row, { justifyContent: "space-between" }]}><Text style={{ fontWeight: "800", color: colors.ink }}>Total estimé</Text><Text style={{ fontWeight: "800", color: colors.ink }}>{formatXaf(total)}</Text></View>
      </Card>
      <Button label={startsAt ? `Continuer · ${formatSlot(startsAt)}` : "Choisissez une heure"} disabled={!startsAt} onPress={() => router.push({ pathname: "/reservation", params: { slug: p.slug, services: selected.join(","), startsAt, mode } })} />
    </>}
    {!!reviews.data?.length && <>
      <Text style={{ fontSize: 18, fontWeight: "800", color: colors.ink, marginTop: 10 }}>Avis vérifiés</Text>
      {reviews.data.map((review) => <Card key={review.id}>
        <View style={styles.row}><Stars value={review.rating} /><Text style={{ fontWeight: "800", color: colors.ink }}>{review.author}</Text></View>
        {!!review.comment && <Muted>{review.comment}</Muted>}
        {!!review.proReply && <Muted style={{ backgroundColor: "#F3EBE1", padding: 8, borderRadius: 8 }}>Réponse : {review.proReply}</Muted>}
      </Card>)}
    </>}
  </Screen>;
}
