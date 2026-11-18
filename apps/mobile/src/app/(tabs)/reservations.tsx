import { Alert, Platform, Text, View } from "react-native";
import { useState } from "react";
import { Badge, Button, Card, Chip, ErrorBox, Field, Loading, Muted, Screen, StarPicker, Stars, styles, Title } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { errorText, formatSlot, formatXaf, STATUS_LABELS } from "@/lib/format";
import { trpc, type Booking } from "@/lib/trpc";
import { colors } from "@/theme";

function confirm(message: string) {
  if (Platform.OS === "web") return Promise.resolve(globalThis.confirm?.(message) ?? true);
  return new Promise<boolean>((resolve) => Alert.alert("Confirmation", message, [{ text: "Non", style: "cancel", onPress: () => resolve(false) }, { text: "Oui, annuler", style: "destructive", onPress: () => resolve(true) }]));
}

function PayForm({ booking, testMode, onDone }: { booking: Booking; testMode: boolean; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [operator, setOperator] = useState<"mtn" | "orange">("mtn");
  const [phone, setPhone] = useState(booking.customerPhone.replace(/^\+237/, ""));
  const [paymentId, setPaymentId] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const initiate = trpc.payments.initiate.useMutation({ onSuccess: (result) => { setPaymentId(result.paymentId); setStartedAt(Date.now()); } });
  const status = trpc.payments.status.useQuery({ paymentId: paymentId ?? 0 }, { enabled: Boolean(paymentId), refetchInterval: (query) => (query.state.data?.status === "pending" && Date.now() - startedAt < 180_000 ? 3000 : false) });
  const simulate = trpc.payments.simulate.useMutation({ onSuccess: () => status.refetch() });
  const final = status.data && status.data.status !== "pending";
  if (final) void utils.booking.mine.invalidate();
  const amount = booking.amountDueXaf - booking.amountPaidXaf;
  if (status.data?.status === "succeeded") return <View style={{ gap: 8 }}><Text style={{ color: colors.leaf, fontWeight: "800" }}>Paiement de {formatXaf(status.data.amountXaf)} confirmé. Merci !</Text><Button label="Fermer" variant="outline" onPress={onDone} /></View>;
  return <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 }}>
    {testMode && <Badge label="Mode test : aucun débit réel" tone="orange" />}
    {initiate.error && <ErrorBox message={errorText(initiate.error.message)} />}
    {status.data?.status === "failed" && <ErrorBox message={`Paiement non abouti : ${status.data.failureReason ?? "refusé par l’opérateur"}.`} />}
    {!paymentId || status.data?.status === "failed" ? <>
      <View style={styles.wrap}><Chip label="MTN MoMo" selected={operator === "mtn"} onPress={() => setOperator("mtn")} /><Chip label="Orange Money" selected={operator === "orange"} onPress={() => setOperator("orange")} /></View>
      <Field label="Numéro Mobile Money" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Button label={`Payer ${formatXaf(amount)}`} loading={initiate.isPending} onPress={() => { setPaymentId(null); initiate.mutate({ reference: booking.reference, operator, phone }); }} />
      <Button label="Plus tard" variant="ghost" onPress={onDone} />
    </> : <>
      <Text style={{ fontWeight: "800", color: colors.ink }}>En attente de votre validation…</Text>
      <Muted>Validez le paiement sur votre téléphone avec votre code secret.</Muted>
      {testMode && <><Button label="Simuler : paiement accepté" onPress={() => simulate.mutate({ paymentId, outcome: "succeeded" })} /><Button label="Simuler : refus" variant="outline" onPress={() => simulate.mutate({ paymentId, outcome: "failed" })} /></>}
    </>}
  </View>;
}

function ReviewForm({ reference, onDone }: { reference: string; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const create = trpc.reviews.create.useMutation({ onSuccess: () => { utils.booking.mine.invalidate(); onDone(); } });
  return <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 }}>
    <Muted>Votre note</Muted>
    <StarPicker value={rating} onChange={setRating} />
    <Field label="Votre avis (optionnel, public)" value={comment} onChangeText={setComment} multiline maxLength={1000} placeholder="Seuls votre prénom et votre initiale seront affichés." />
    {create.error && <ErrorBox message={errorText(create.error.message)} />}
    <Button label="Publier mon avis" disabled={!rating} loading={create.isPending} onPress={() => create.mutate({ reference, rating, comment: comment.trim() || undefined })} />
    <Button label="Plus tard" variant="ghost" onPress={onDone} />
  </View>;
}

export default function ReservationsScreen() {
  const auth = useAuth();
  const utils = trpc.useUtils();
  const mine = trpc.booking.mine.useQuery(undefined, { enabled: Boolean(auth.user) });
  const cancel = trpc.booking.cancel.useMutation({ onSuccess: () => utils.booking.mine.invalidate() });
  const [error, setError] = useState("");
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const config = trpc.payments.config.useQuery();
  const freeCancelHours = config.data?.freeCancelHours ?? 24;
  const onCancel = async (booking: Booking) => {
    if (!(await confirm(`Annuler la demande ${booking.reference} ?`))) return;
    setError("");
    cancel.mutate({ reference: booking.reference }, { onError: (requestError) => setError(errorText(requestError.message)) });
  };
  if (auth.loading) return <Screen><Loading /></Screen>;
  if (!auth.user) return <Screen><Title eyebrow="Votre espace">Mes réservations</Title><Muted>Connectez-vous pour retrouver vos demandes, sur tous vos appareils.</Muted>{auth.error && <ErrorBox message={errorText(auth.error)} />}<Button label="Se connecter" loading={auth.signingIn} onPress={auth.login} /></Screen>;
  return <Screen>
    <Title eyebrow="Votre espace">Mes réservations</Title>
    {!!error && <ErrorBox message={error} />}
    {mine.isLoading ? <Loading /> : mine.error ? <ErrorBox message={errorText(mine.error.message)} onRetry={() => mine.refetch()} /> : !mine.data?.length ? <Card><Text style={{ fontWeight: "800", color: colors.ink }}>Aucune réservation pour le moment</Text><Muted>Votre prochain rendez-vous commence par une recherche.</Muted></Card>
      : mine.data.map((booking) => { const status = STATUS_LABELS[booking.status]; return <Card key={booking.reference}>
        <View style={[styles.row, { justifyContent: "space-between" }]}><Text style={{ fontWeight: "800", color: colors.ink, fontSize: 16, flexShrink: 1 }}>{booking.professional.name}</Text><Badge label={status.label} tone={status.tone} /></View>
        <Muted>{formatSlot(booking.startsAt)} · {booking.mode === "salon" ? "Au salon" : "À domicile"}</Muted>
        <Muted>{booking.items.map((item) => item.name).join(" + ")}</Muted>
        <Muted style={{ fontSize: 12 }}>Réf. {booking.reference} · {formatXaf(booking.totalXaf)}{booking.discountXaf > 0 ? ` (remise −${formatXaf(booking.discountXaf)})` : ""}</Muted>
        {booking.paymentStatus === "paid" && <Badge label={`Payé · ${formatXaf(booking.amountPaidXaf)}`} tone="green" />}
        {(booking.paymentStatus === "refund_pending" || booking.paymentStatus === "refunded") && <Badge label={booking.paymentStatus === "refunded" ? "Remboursé" : "Remboursement en cours"} tone="gray" />}
        {booking.status === "confirmed" && booking.paymentStatus === "unpaid" && config.data?.enabled && (paying === booking.reference ? <PayForm booking={booking} testMode={Boolean(config.data?.testMode)} onDone={() => setPaying(null)} /> : <Button label={`Payer ${formatXaf(booking.amountDueXaf - booking.amountPaidXaf)}`} onPress={() => setPaying(booking.reference)} />)}
        {booking.status === "confirmed" && new Date(booking.startsAt).getTime() - Date.now() < freeCancelHours * 3_600_000 && <Muted style={{ fontSize: 12 }}>Moins de {freeCancelHours} h avant : pour tout changement, contactez le professionnel.</Muted>}
        {booking.review && <View style={styles.row}><Muted>Votre note</Muted><Stars value={booking.review.rating} /></View>}
        {booking.canReview && (reviewing === booking.reference ? <ReviewForm reference={booking.reference} onDone={() => setReviewing(null)} /> : <Button label="Donner mon avis" onPress={() => setReviewing(booking.reference)} />)}
        {(booking.status === "pending" || (booking.status === "confirmed" && new Date(booking.startsAt).getTime() - Date.now() >= freeCancelHours * 3_600_000)) && <Button label={booking.amountPaidXaf > 0 ? "Annuler (remboursé)" : booking.status === "pending" ? "Annuler la demande" : "Annuler le rendez-vous"} variant="outline" loading={cancel.isPending && cancel.variables?.reference === booking.reference} onPress={() => onCancel(booking)} />}
      </Card>; })}
  </Screen>;
}
