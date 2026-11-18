import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Button, Card, ErrorBox, Field, Loading, Muted, Notice, Screen, styles, Title } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { errorText, formatDuration, formatSlot, formatXaf } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { colors } from "@/theme";

export default function ReservationScreen() {
  const params = useLocalSearchParams<{ slug: string; services: string; startsAt: string; mode: "salon" | "domicile" }>();
  const serviceIds = String(params.services ?? "").split(",").filter(Boolean);
  const auth = useAuth();
  const utils = trpc.useUtils();
  const pro = trpc.catalog.professional.useQuery({ slug: String(params.slug) });
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [promoInput, setPromoInput] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { if (auth.user?.name) setName((current) => current || auth.user?.name || ""); }, [auth.user?.name]);
  const promo = trpc.promo.check.useQuery({ code: promoCode, slug: String(params.slug), serviceIds }, { enabled: Boolean(promoCode && auth.user), retry: false });
  const create = trpc.booking.create.useMutation({
    onSuccess: (booking) => { utils.booking.mine.invalidate(); router.replace({ pathname: "/confirmation", params: { ref: booking.reference } }); },
    onError: (requestError) => setError(errorText(requestError.message)),
  });

  if (pro.isLoading || auth.loading) return <Screen edges={[]}><Loading /></Screen>;
  if (pro.error || !pro.data) return <Screen edges={[]}><ErrorBox message={errorText(pro.error?.message ?? "PROFESSIONAL_NOT_FOUND")} /></Screen>;
  const chosen = serviceIds.map((id) => pro.data!.services.find((service) => service.id === id));
  if (chosen.some((service) => !service)) return <Screen edges={[]}><ErrorBox message={errorText("SERVICE_NOT_FOUND")} /></Screen>;
  const services = chosen as NonNullable<(typeof chosen)[number]>[];
  const subtotal = services.reduce((sum, service) => sum + service.price, 0);
  const duration = services.reduce((sum, service) => sum + service.duration, 0);
  const atHome = params.mode === "domicile";
  const validPromo = promo.data?.valid ? promo.data : null;

  const summary = <Card>
    <Text style={{ fontWeight: "800", color: colors.ink, fontSize: 16 }}>{pro.data.name}</Text>
    <Muted>{formatSlot(String(params.startsAt))} · {atHome ? "À domicile" : "Au salon"} · {formatDuration(duration)}</Muted>
    {services.map((service) => <View key={service.id} style={[styles.row, { justifyContent: "space-between" }]}><Muted>{service.name}</Muted><Muted>{formatXaf(service.price)}</Muted></View>)}
    {validPromo && <View style={[styles.row, { justifyContent: "space-between" }]}><Text style={{ color: colors.leaf, fontWeight: "700" }}>Remise {validPromo.code}</Text><Text style={{ color: colors.leaf, fontWeight: "700" }}>−{formatXaf(validPromo.discountXaf)}</Text></View>}
    <View style={[styles.row, { justifyContent: "space-between" }]}><Text style={{ fontWeight: "800", color: colors.ink }}>Total estimé</Text><Text style={{ fontWeight: "800", color: colors.ink }}>{formatXaf(validPromo ? validPromo.totalXaf : subtotal)}</Text></View>
  </Card>;

  if (!auth.user) return <Screen edges={[]}>
    <Title>Votre créneau est prêt.</Title>
    {summary}
    <Muted>Connectez-vous pour envoyer la demande. Votre sélection reste ouverte sur cet écran.</Muted>
    {auth.error && <ErrorBox message={errorText(auth.error)} />}
    <Button label="Se connecter" loading={auth.signingIn} onPress={auth.login} />
  </Screen>;

  const submit = () => {
    setError("");
    if (name.trim().length < 2 || phone.replace(/\D/g, "").length < 9) { setError("Indiquez votre nom et un numéro camerounais à 9 chiffres."); return; }
    if (atHome && address.trim().length < 5) { setError("Indiquez l’adresse du rendez-vous à domicile, avec un repère."); return; }
    create.mutate({ professionalSlug: String(params.slug), startsAt: String(params.startsAt), durationMinutes: duration, timezone: "Africa/Douala", mode: atHome ? "domicile" : "salon", customerName: name.trim(), customerPhone: phone.trim(), address: atHome ? address.trim() : undefined, serviceIds, totalXaf: subtotal, notes: notes.trim() || undefined, promoCode: validPromo?.code });
  };

  return <Screen edges={[]}>
    {summary}
    {!!error && <ErrorBox message={error} />}
    <Field label="Nom complet" value={name} onChangeText={setName} placeholder="Ex. Amina Njoya" autoComplete="name" />
    <Field label="Téléphone" value={phone} onChangeText={setPhone} placeholder="6 90 12 34 56" keyboardType="phone-pad" autoComplete="tel" />
    {atHome && <Field label="Adresse du rendez-vous" value={address} onChangeText={setAddress} placeholder="Quartier, rue, repère…" />}
    <Field label="Une précision ? (optionnel)" value={notes} onChangeText={setNotes} multiline maxLength={1000} placeholder="Texture, inspiration, besoin particulier…" />
    <View style={[styles.row, { alignItems: "flex-end" }]}>
      <View style={{ flex: 1 }}><Field label="Code promo (optionnel)" value={promoInput} onChangeText={(value) => setPromoInput(value.toUpperCase())} autoCapitalize="characters" maxLength={20} /></View>
      <Button label="Appliquer" variant="outline" disabled={!promoInput.trim()} loading={promo.isFetching} onPress={() => setPromoCode(promoInput.trim())} />
    </View>
    {promoCode && promo.data && !promo.data.valid && <Text style={{ color: colors.danger, fontWeight: "700" }} accessibilityRole="alert">{errorText(promo.data.reason)}</Text>}
    {validPromo && <Text style={{ color: colors.leaf, fontWeight: "700" }}>{validPromo.label} : −{formatXaf(validPromo.discountXaf)}</Text>}
    <Notice>Aucun paiement n’est débité pour l’instant : le paiement Mobile Money sera activé plus tard.</Notice>
    <Button label="Envoyer la demande" loading={create.isPending} onPress={submit} />
  </Screen>;
}
