/**
 * Fonctionnalités clients « type Treatwell » : favoris, fidélité, cartes cadeaux, aide,
 * déplacement d’un rendez-vous, et options de réservation (collaborateur, points, carte cadeau).
 */
import { ArrowRight, Award, CalendarDays, Check, CheckCircle2, Copy, Gift, Heart, HelpCircle, LogIn, RefreshCcw, Search, Sparkles, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link } from "wouter";
import { startLogin } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { formatDayLabel, formatSlot, formatTime, formatXaf, upcomingDays, type Booking, type Professional } from "@/lib/format";

export const FEATURE_ERRORS: Record<string, string> = {
  STAFF_NOT_FOUND: "Ce collaborateur n’est plus disponible. Choisissez « Peu importe » ou une autre personne.",
  LOYALTY_INVALID: "Ce nombre de points n’est pas utilisable (paquets de 100, dans la limite de la moitié du prix).",
  GIFT_CARD_INVALID: "Cette carte cadeau n’est pas valable (code inconnu, expirée ou solde épuisé).",
  RESCHEDULE_TOO_LATE: "Trop tard pour déplacer ce rendez-vous : contactez directement le professionnel.",
  PAYMENTS_DISABLED: "Le paiement Mobile Money n’est pas encore activé : l’achat de cartes cadeaux sera bientôt possible.",
  PAYMENT_PROVIDER_ERROR: "Le service de paiement ne répond pas. Réessayez dans quelques minutes.",
  CUSTOMER_DETAILS_INVALID: "Indiquez un numéro Mobile Money camerounais à 9 chiffres.",
  SLOT_UNAVAILABLE: "Ce créneau vient d’être pris. Choisissez-en un autre.",
  SLOT_OUTSIDE_HOURS: "Ce créneau est en dehors des horaires du professionnel.",
  SLOT_IN_PAST: "Ce créneau est déjà passé.",
  BOOKING_NOT_CANCELLABLE: "Ce rendez-vous ne peut plus être modifié.",
};
const errorText = (message: string) => FEATURE_ERRORS[message] ?? "L’action n’a pas pu aboutir. Réessayez dans un instant.";

function login() {
  try { startLogin(); } catch { window.location.href = "/connexion"; }
}

function Loading({ label = "Chargement…" }: { label?: string }) {
  return <div className="kofi-empty" role="status"><RefreshCcw className="kofi-spinner" size={22} /><p>{label}</p></div>;
}

function NeedLogin({ title, text }: { title: string; text: string }) {
  return <div className="kofi-empty" style={{ marginTop: 24 }}><LogIn size={27} /><h3>{title}</h3><p>{text}</p><button className="kofi-button primary small" onClick={login}>Se connecter</button></div>;
}

// ---------------------------------------------------------------------------
// Favoris et badges
// ---------------------------------------------------------------------------

export function FavoriteButton({ slug, label = false }: { slug: string; label?: boolean }) {
  const auth = useAuth();
  const utils = trpc.useUtils();
  const ids = trpc.favorites.ids.useQuery(undefined, { enabled: auth.isAuthenticated, staleTime: 60_000 });
  const toggle = trpc.favorites.toggle.useMutation({
    onMutate: async () => {
      await utils.favorites.ids.cancel();
      const previous = utils.favorites.ids.getData();
      utils.favorites.ids.setData(undefined, (current = []) => (current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug]));
      return { previous };
    },
    onError: (_error, _input, context) => utils.favorites.ids.setData(undefined, context?.previous),
    onSettled: () => { void utils.favorites.invalidate(); },
  });
  const active = Boolean(ids.data?.includes(slug));
  return <button type="button" className={`kofi-fav ${active ? "is-on" : ""} ${label ? "with-label" : ""}`} aria-pressed={active} aria-label={active ? "Retirer des favoris" : "Ajouter aux favoris"} title={active ? "Retirer des favoris" : "Ajouter aux favoris"}
    onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (!auth.isAuthenticated) { login(); return; } toggle.mutate({ slug }); }}>
    <Heart size={label ? 16 : 17} fill={active ? "currentColor" : "none"} />{label && <span>{active ? "Dans mes favoris" : "Ajouter aux favoris"}</span>}
  </button>;
}

export function TopRatedBadge() {
  return <span className="kofi-toprated" title="Note d’au moins 4,5 sur 3 avis vérifiés ou plus"><Award size={12} /> Top Rated</span>;
}

export function OffpeakBadge({ percent }: { percent: number }) {
  return percent > 0 ? <span className="kofi-offpeak" title="Remise sur certains créneaux en heures creuses">−{percent} % heures creuses</span> : null;
}

export function FavoritesPage({ renderCard }: { renderCard: (professional: Professional) => ReactNode }) {
  const auth = useAuth();
  const list = trpc.favorites.list.useQuery(undefined, { enabled: auth.isAuthenticated });
  return <main className="kofi-container kofi-page">
    <div className="kofi-dashboard-head"><div><span className="kofi-eyebrow"><Heart size={14} /> Votre espace</span><h1>Mes favoris</h1><p className="kofi-page-lead">Vos professionnels préférés, pour réserver de nouveau en un geste.</p></div></div>
    {auth.loading ? <Loading /> : !auth.isAuthenticated ? <NeedLogin title="Connectez-vous pour voir vos favoris" text="Appuyez sur le cœur d’un profil pour le retrouver ici." /> : list.isLoading ? <Loading /> : list.data?.length ? <div className="kofi-grid">{list.data.map((professional) => <div key={professional.slug}>{renderCard(professional)}</div>)}</div>
      : <div className="kofi-empty" style={{ marginTop: 24 }}><Heart size={27} /><h3>Pas encore de favori</h3><p>Appuyez sur le cœur d’un profil pour le garder sous la main.</p><Link href="/recherche" className="kofi-button primary small"><Search size={14} /> Explorer</Link></div>}
  </main>;
}

// ---------------------------------------------------------------------------
// Fidélité
// ---------------------------------------------------------------------------

export function LoyaltyPage() {
  const auth = useAuth();
  const loyalty = trpc.loyalty.mine.useQuery(undefined, { enabled: auth.isAuthenticated });
  const data = loyalty.data;
  return <main className="kofi-container kofi-page">
    <div className="kofi-dashboard-head"><div><span className="kofi-eyebrow"><Sparkles size={14} /> Programme fidélité</span><h1>Ma fidélité</h1><p className="kofi-page-lead">Chaque rendez-vous terminé vous rapporte des points, à utiliser sur vos prochaines réservations.</p></div></div>
    {auth.loading ? <Loading /> : !auth.isAuthenticated ? <NeedLogin title="Connectez-vous pour voir vos points" text="Vos points sont liés à votre compte KOFI." /> : loyalty.isLoading || !data ? <Loading /> : <>
      <section className="kofi-loyalty-hero">
        <div><span>Votre solde</span><strong>{data.balance.toLocaleString("fr-FR")} points</strong><p>soit {formatXaf(data.valueXaf)} de réduction disponible</p></div>
        <Link href="/recherche" className="kofi-button primary">Réserver <ArrowRight size={16} /></Link>
      </section>
      <ol className="kofi-steps" style={{ marginTop: 18 }}>
        <li><span className="kofi-step-num">01</span><CalendarDays size={22} /><h3>Réservez et venez</h3><p>{data.rules.earnPer === 100 ? "1 point par tranche de 100 FCFA" : ""}, crédité quand le professionnel marque le rendez-vous « terminé ».</p></li>
        <li><span className="kofi-step-num">02</span><Sparkles size={22} /><h3>Cumulez</h3><p>{data.rules.blockPoints} points = {formatXaf(data.rules.blockValueXaf)} de réduction.</p></li>
        <li><span className="kofi-step-num">03</span><CheckCircle2 size={22} /><h3>Utilisez-les</h3><p>À l’étape de réservation, jusqu’à la moitié du prix. Rendus si le rendez-vous est annulé.</p></li>
      </ol>
      <section className="kofi-panel" style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>Historique</h2>
        {data.history.length ? <ul className="kofi-ledger">{data.history.map((row) => <li key={row.id}><div><strong>{row.reason}</strong><small>{new Date(row.createdAt).toLocaleDateString("fr-FR", { timeZone: "Africa/Douala", day: "numeric", month: "long", year: "numeric" })}</small></div><em className={row.points > 0 ? "plus" : "minus"}>{row.points > 0 ? "+" : ""}{row.points}</em></li>)}</ul> : <p style={{ color: "#5d6779", margin: 0 }}>Aucun mouvement pour l’instant : vos premiers points arrivent après votre premier rendez-vous terminé.</p>}
      </section>
    </>}
  </main>;
}

// ---------------------------------------------------------------------------
// Cartes cadeaux
// ---------------------------------------------------------------------------

const GIFT_PRESETS = [10_000, 20_000, 30_000, 50_000];

function GiftPurchase({ onDone }: { onDone: () => void }) {
  const config = trpc.giftCards.config.useQuery();
  const utils = trpc.useUtils();
  const [amount, setAmount] = useState(20_000);
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");
  const [operator, setOperator] = useState<"mtn" | "orange">("mtn");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [payment, setPayment] = useState<{ id: number; instructions: string; testMode: boolean } | null>(null);
  const purchase = trpc.giftCards.purchase.useMutation({ onSuccess: (result) => setPayment({ id: result.paymentId, instructions: result.instructions, testMode: result.testMode }), onError: (requestError) => setError(errorText(requestError.message)) });
  const status = trpc.giftCards.paymentStatus.useQuery({ paymentId: payment?.id ?? 0 }, { enabled: Boolean(payment), refetchInterval: (query) => (query.state.data?.status === "pending" ? 3000 : false) });
  const simulate = trpc.giftCards.simulate.useMutation({ onSuccess: () => status.refetch() });
  useEffect(() => { if (status.data && status.data.status !== "pending") { void utils.giftCards.mine.invalidate(); void utils.notifications.invalidate(); } }, [status.data, utils]);
  if (config.isLoading) return <Loading />;
  if (!config.data?.enabled) return <div className="kofi-alert" style={{ marginBottom: 0 }}><Gift size={17} /> L’achat de cartes cadeaux sera ouvert dès l’activation du paiement Mobile Money. Les cartes déjà reçues restent utilisables à la réservation.</div>;
  const min = config.data.minXaf; const max = config.data.maxXaf;
  if (status.data?.status === "succeeded") return <div className="kofi-pay full" role="status"><CheckCircle2 size={18} /> Paiement confirmé : votre carte cadeau est prête, son code est affiché ci-dessous.<button className="kofi-button outline small" onClick={() => { setPayment(null); onDone(); }}>Fermer</button></div>;
  if (payment && status.data?.status !== "failed") return <div className="kofi-pay full" role="status">
    {payment.testMode && <span className="kofi-status orange">Mode test : aucun débit réel</span>}
    <strong><RefreshCcw className="kofi-spinner" size={15} /> En attente de votre validation…</strong>
    <span style={{ fontSize: 13 }}>{payment.instructions}</span>
    {payment.testMode && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button className="kofi-button primary small" disabled={simulate.isPending} onClick={() => simulate.mutate({ paymentId: payment.id, outcome: "succeeded" })}>Simuler : paiement accepté</button><button className="kofi-button outline small" disabled={simulate.isPending} onClick={() => simulate.mutate({ paymentId: payment.id, outcome: "failed" })}>Simuler : refus</button></div>}
  </div>;
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError("");
    if (amount < min || amount > max || amount % 500) { setError(`Montant entre ${formatXaf(min)} et ${formatXaf(max)}, par tranche de 500 FCFA.`); return; }
    purchase.mutate({ amountXaf: amount, recipientName: recipient.trim() || undefined, message: message.trim() || undefined, operator, phone });
  };
  return <form className="kofi-gift-form" onSubmit={submit} noValidate>
    {status.data?.status === "failed" && <div className="kofi-alert" role="alert"><X size={16} /> Paiement non abouti : {status.data.failureReason ?? "refusé par l’opérateur"}. Vous pouvez réessayer.</div>}
    {error && <div className="kofi-alert" role="alert"><X size={16} /> {error}</div>}
    <fieldset className="kofi-form-group" style={{ border: 0, padding: 0, margin: 0 }}><legend className="kofi-filter-label">Montant</legend>
      <div className="kofi-slots">{GIFT_PRESETS.map((value) => <button type="button" key={value} className={`kofi-slot ${amount === value ? "selected" : ""}`} aria-pressed={amount === value} onClick={() => setAmount(value)}>{formatXaf(value)}</button>)}</div>
      <input type="number" inputMode="numeric" min={min} max={max} step={500} value={amount} onChange={(event) => setAmount(Number(event.target.value))} aria-label="Autre montant" style={{ marginTop: 8 }} />
    </fieldset>
    <div className="kofi-form-grid">
      <div className="kofi-form-group"><label htmlFor="gift-to">Pour (optionnel)</label><input id="gift-to" value={recipient} onChange={(event) => setRecipient(event.target.value)} maxLength={120} placeholder="Ex. Maman" /></div>
      <div className="kofi-form-group"><label htmlFor="gift-phone">Numéro Mobile Money</label><input id="gift-phone" value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" autoComplete="tel" placeholder="6 90 12 34 56" /></div>
      <div className="kofi-form-group full"><label htmlFor="gift-msg">Message (optionnel)</label><input id="gift-msg" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={300} placeholder="Joyeux anniversaire ! Fais-toi plaisir." /></div>
    </div>
    <fieldset className="kofi-form-group" style={{ border: 0, padding: 0, margin: 0 }}><legend className="kofi-filter-label">Opérateur</legend>
      <div className="kofi-slots">{(["mtn", "orange"] as const).map((item) => <button type="button" key={item} className={`kofi-slot ${operator === item ? "selected" : ""}`} aria-pressed={operator === item} onClick={() => setOperator(item)}>{item === "mtn" ? "MTN MoMo" : "Orange Money"}</button>)}</div>
    </fieldset>
    <button className="kofi-button primary" type="submit" disabled={purchase.isPending}><Gift size={16} /> {purchase.isPending ? "Envoi…" : `Payer ${formatXaf(amount || 0)}`}</button>
    <small style={{ color: "#5d6779" }}>Valable 1 an, utilisable chez tous les professionnels KOFI, en une ou plusieurs fois. Non remboursable.</small>
  </form>;
}

export function GiftCardsPage() {
  const auth = useAuth();
  const mine = trpc.giftCards.mine.useQuery(undefined, { enabled: auth.isAuthenticated });
  const [copied, setCopied] = useState("");
  const copy = (code: string) => { void navigator.clipboard?.writeText(code).then(() => { setCopied(code); setTimeout(() => setCopied(""), 2000); }); };
  const STATUS = { pending_payment: ["Paiement en attente", "orange"], active: ["Active", "green"], cancelled: ["Annulée", "gray"], expired: ["Expirée", "gray"] } as const;
  return <main className="kofi-container kofi-page">
    <section className="kofi-gift-hero">
      <div><span className="kofi-eyebrow"><Gift size={14} /> Carte cadeau KOFI</span><h1>Offrez un moment beauté.</h1><p>Coiffure, barbier, tresses, ongles, soins : la personne choisit son professionnel et son créneau. Réglée par Mobile Money, le code arrive aussitôt.</p></div>
      <div className="kofi-gift-card" aria-hidden="true"><span>KOFI</span><strong>Carte cadeau</strong><em>KDO-••••-••••</em></div>
    </section>
    <div className="kofi-booking-layout" style={{ marginTop: 24 }}>
      <section className="kofi-panel"><h2 style={{ marginTop: 0 }}>Acheter une carte</h2>{auth.loading ? <Loading /> : auth.isAuthenticated ? <GiftPurchase onDone={() => mine.refetch()} /> : <NeedLogin title="Connectez-vous pour offrir une carte" text="La carte et son code sont gardés dans votre compte." />}</section>
      <aside className="kofi-panel"><h3 style={{ marginTop: 0 }}>Mes cartes</h3>
        {!auth.isAuthenticated ? <p style={{ color: "#5d6779" }}>Vos cartes achetées apparaîtront ici.</p> : mine.isLoading ? <Loading /> : mine.data?.length ? <ul className="kofi-ledger">{mine.data.map((card) => <li key={card.id}><div>
          <strong>{formatXaf(card.initialXaf)}{card.recipientName ? ` · pour ${card.recipientName}` : ""}</strong>
          <small>{card.code ? <>Code <code className="kofi-code">{card.code}</code> · solde {formatXaf(card.balanceXaf)}</> : "Le code s’affiche après le paiement"} · jusqu’au {new Date(card.expiresAt).toLocaleDateString("fr-FR")}</small>
          <span className={`kofi-status ${STATUS[card.status][1]}`} style={{ marginTop: 6 }}>{STATUS[card.status][0]}</span>
        </div>{card.code && <button type="button" className="kofi-button outline small" onClick={() => copy(card.code!)}>{copied === card.code ? <><Check size={14} /> Copié</> : <><Copy size={14} /> Copier</>}</button>}</li>)}</ul> : <p style={{ color: "#5d6779" }}>Aucune carte pour l’instant.</p>}
        <p className="kofi-note"><Gift size={14} /> Pour utiliser une carte reçue, saisissez son code à l’étape de réservation.</p>
      </aside>
    </div>
  </main>;
}

// ---------------------------------------------------------------------------
// Aide / FAQ
// ---------------------------------------------------------------------------

const FAQ: { title: string; items: [string, string][] }[] = [
  { title: "Réserver", items: [
    ["Comment réserver un rendez-vous ?", "Cherchez une prestation ou un professionnel, choisissez vos prestations, puis un créneau libre. Connectez-vous pour envoyer la demande : elle est « en attente » jusqu’à ce que le professionnel l’accepte."],
    ["Les créneaux affichés sont-ils vraiment libres ?", "Oui : ils sont calculés en temps réel selon les horaires du professionnel, ses congés, ses rendez-vous déjà pris et la durée de vos prestations. Les horaires sont en heure de Douala."],
    ["Puis-je choisir la personne qui s’occupe de moi ?", "Si le salon a déclaré son équipe, vous pouvez choisir un collaborateur ou laisser « Peu importe » : KOFI attribue alors une personne libre."],
    ["Qu’est-ce que le badge « Top Rated » ?", "Il récompense les professionnels notés au moins 4,5/5 sur au moins 3 avis vérifiés, laissés par de vrais clients après un rendez-vous terminé."],
  ] },
  { title: "Modifier ou annuler", items: [
    ["Comment déplacer mon rendez-vous ?", "Dans « Mes réservations », appuyez sur « Déplacer » et choisissez un nouveau créneau. Le professionnel doit l’accepter de nouveau ; un paiement déjà fait est conservé et le prix reste celui de la réservation d’origine."],
    ["Jusqu’à quand puis-je annuler ou déplacer ?", "Une demande en attente : à tout moment. Un rendez-vous confirmé : jusqu’à 24 h avant (délai indiqué lors de la réservation). Plus tard, contactez directement le professionnel."],
    ["Serai-je remboursé si j’annule ?", "Oui, intégralement sur votre compte Mobile Money si vous annulez dans les délais. La part payée par carte cadeau est recréditée sur la carte et vos points fidélité vous sont rendus."],
  ] },
  { title: "Payer et économiser", items: [
    ["Quand dois-je payer ?", "Rien n’est débité à la demande. Vous payez par MTN MoMo ou Orange Money une fois le rendez-vous accepté (paiement complet ou acompte selon les réglages)."],
    ["Que sont les offres « heures creuses » ?", "Certains professionnels proposent une remise sur des créneaux moins demandés. Les heures concernées affichent « −X % » et la remise est appliquée automatiquement."],
    ["Comment fonctionnent les points fidélité ?", "1 point par tranche de 100 FCFA d’un rendez-vous terminé. 100 points = 500 FCFA de réduction, utilisables jusqu’à la moitié du prix d’une réservation."],
    ["Comment utiliser une carte cadeau ?", "Saisissez son code à l’étape de réservation : le montant est déduit tout de suite. Le solde restant reste utilisable pendant 1 an."],
  ] },
  { title: "Compte et sécurité", items: [
    ["Mes données sont-elles protégées ?", "Votre mot de passe est chiffré et aucune donnée bancaire n’est stockée par KOFI. Vos coordonnées servent uniquement à confirmer le rendez-vous avec le professionnel."],
    ["Un problème avec un rendez-vous ?", "Depuis « Mes réservations », utilisez « Signaler un problème ». L’équipe KOFI traite chaque signalement et vous répond dans votre espace."],
  ] },
];

export function HelpPage() {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const sections = useMemo(() => FAQ.map((section) => ({ ...section, items: section.items.filter(([question, answer]) => !q || `${question} ${answer}`.toLowerCase().includes(q)) })).filter((section) => section.items.length), [q]);
  return <main className="kofi-container kofi-page">
    <div className="kofi-help-head"><span className="kofi-eyebrow"><HelpCircle size={14} /> Centre d’aide</span><h1 className="kofi-page-title">Comment pouvons-nous vous aider ?</h1>
      <label className="kofi-field kofi-help-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher : annuler, payer, carte cadeau…" aria-label="Rechercher dans l’aide" /></label></div>
    {sections.length ? sections.map((section) => <section key={section.title} className="kofi-faq-section"><h2>{section.title}</h2>{section.items.map(([question, answer]) => <details key={question} className="kofi-faq" open={Boolean(q)}><summary>{question}</summary><p>{answer}</p></details>)}</section>)
      : <div className="kofi-empty"><HelpCircle size={26} /><h3>Aucune réponse trouvée</h3><p>Essayez un autre mot, ou signalez votre problème depuis « Mes réservations ».</p></div>}
    <div className="kofi-panel kofi-help-contact"><div><h3 style={{ margin: 0 }}>Vous n’avez pas trouvé ?</h3><p style={{ margin: "6px 0 0", color: "#5d6779" }}>Écrivez-nous depuis une réservation avec « Signaler un problème » : la réponse arrive dans votre espace.</p></div><Link href="/mes-reservations" className="kofi-button primary">Mes réservations <ArrowRight size={15} /></Link></div>
  </main>;
}

// ---------------------------------------------------------------------------
// Déplacer un rendez-vous
// ---------------------------------------------------------------------------

export function RescheduleForm({ booking, onDone }: { booking: Booking; onDone: (message?: string) => void }) {
  const utils = trpc.useUtils();
  const days = useMemo(() => upcomingDays(14), []);
  const [day, setDay] = useState(days[0]);
  const [startsAt, setStartsAt] = useState("");
  const [error, setError] = useState("");
  const slots = trpc.booking.rescheduleSlots.useQuery({ reference: booking.reference, day }, { retry: false });
  const move = trpc.booking.reschedule.useMutation({
    onSuccess: (result) => { void utils.booking.mine.invalidate(); onDone(`Rendez-vous déplacé au ${formatSlot(result.startsAt)}. Le professionnel doit l’accepter de nouveau.`); },
    onError: (requestError) => { setError(errorText(requestError.message)); void slots.refetch(); },
  });
  useEffect(() => setStartsAt(""), [day]);
  const options = (slots.data?.startsAt ?? []).filter((iso) => iso !== booking.startsAt);
  return <div className="kofi-pay full kofi-reschedule">
    <strong><CalendarDays size={16} /> Choisir un nouveau créneau</strong>
    <small style={{ color: "#5d6779" }}>Actuellement : {formatSlot(booking.startsAt)}{booking.staff ? ` avec ${booking.staff.name}` : ""}. Le prix reste {formatXaf(booking.totalXaf)}.</small>
    {error && <div className="kofi-alert" role="alert" style={{ marginBottom: 0 }}><X size={16} /> {error}</div>}
    <select value={day} onChange={(event) => setDay(event.target.value)} aria-label="Jour" style={{ minHeight: 44 }}>{days.map((item) => <option key={item} value={item}>{formatDayLabel(item)}</option>)}</select>
    {slots.isLoading ? <Loading label="Recherche des créneaux…" /> : slots.error ? <p className="kofi-adm-warn">{errorText(slots.error.message)}</p> : options.length ? <div className="kofi-slots" role="group" aria-label="Nouveaux créneaux">{options.map((iso) => <button type="button" key={iso} className={`kofi-slot ${startsAt === iso ? "selected" : ""}`} aria-pressed={startsAt === iso} onClick={() => setStartsAt(iso)}>{formatTime(iso)}</button>)}</div> : <p style={{ fontSize: 13, color: "#5d6779", margin: 0 }}>Aucun créneau libre ce jour-là.</p>}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button type="button" className="kofi-button primary small" disabled={!startsAt || move.isPending} onClick={() => { setError(""); move.mutate({ reference: booking.reference, startsAt }); }}>{move.isPending ? "Envoi…" : startsAt ? `Déplacer au ${formatSlot(startsAt)}` : "Choisissez une heure"}</button><button type="button" className="kofi-button outline small" onClick={() => onDone()}>Annuler</button></div>
  </div>;
}

// ---------------------------------------------------------------------------
// Options de réservation : collaborateur, points, carte cadeau
// ---------------------------------------------------------------------------

export function StaffPicker({ staff, value, onChange }: { staff: Professional["staff"]; value: number | null; onChange: (id: number | null) => void }) {
  if (!staff.length) return null;
  return <>
    <span className="kofi-filter-label"><Users size={13} style={{ verticalAlign: "-2px" }} /> Avec qui ?</span>
    <div className="kofi-slots kofi-staff" role="group" aria-label="Choisir un collaborateur">
      <button type="button" className={`kofi-slot ${value === null ? "selected" : ""}`} aria-pressed={value === null} onClick={() => onChange(null)}>Peu importe</button>
      {staff.map((member) => <button type="button" key={member.id} className={`kofi-slot ${value === member.id ? "selected" : ""}`} aria-pressed={value === member.id} onClick={() => onChange(member.id)} title={member.title ?? undefined}><span className="kofi-staff-dot" aria-hidden="true">{member.name.slice(0, 1).toUpperCase()}</span>{member.name}</button>)}
    </div>
  </>;
}

export type Extras = { loyaltyPoints: number; loyaltyDiscountXaf: number; giftCardCode: string; giftCardXaf: number };

/** Points fidélité et carte cadeau à l’étape de réservation (le serveur revérifie tout). */
export function BookingExtras({ amountXaf, onChange }: { amountXaf: number; onChange: (extras: Extras) => void }) {
  const loyalty = trpc.loyalty.mine.useQuery();
  const [points, setPoints] = useState(0);
  const [codeInput, setCodeInput] = useState("");
  const [code, setCode] = useState("");
  const card = trpc.giftCards.check.useQuery({ code }, { enabled: code.length >= 4, retry: false });
  const rules = loyalty.data?.rules;
  const balance = loyalty.data?.balance ?? 0;
  const maxPoints = rules ? Math.max(0, Math.min(Math.floor((amountXaf * 0.5) / rules.blockValueXaf) * rules.blockPoints, Math.floor(balance / rules.blockPoints) * rules.blockPoints)) : 0;
  const usedPoints = Math.min(points, maxPoints);
  const loyaltyDiscount = rules ? (usedPoints / rules.blockPoints) * rules.blockValueXaf : 0;
  const giftXaf = card.data?.valid ? Math.min(card.data.balanceXaf, amountXaf - loyaltyDiscount) : 0;
  useEffect(() => { onChange({ loyaltyPoints: usedPoints, loyaltyDiscountXaf: loyaltyDiscount, giftCardCode: card.data?.valid ? code : "", giftCardXaf: giftXaf }); }, [usedPoints, loyaltyDiscount, giftXaf, code, card.data?.valid]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="kofi-extras">
    {rules && balance >= rules.blockPoints && <div className="kofi-form-group"><label htmlFor="pts"><Sparkles size={13} style={{ verticalAlign: "-2px" }} /> Points fidélité <span style={{ fontWeight: 400 }}>({balance} disponibles)</span></label>
      {maxPoints >= rules.blockPoints ? <select id="pts" value={usedPoints} onChange={(event) => setPoints(Number(event.target.value))}><option value={0}>Ne pas utiliser</option>{Array.from({ length: maxPoints / rules.blockPoints }, (_, index) => (index + 1) * rules.blockPoints).map((value) => <option key={value} value={value}>{value} points = −{formatXaf((value / rules.blockPoints) * rules.blockValueXaf)}</option>)}</select> : <small style={{ color: "#5d6779" }}>Montant trop faible pour utiliser vos points sur cette réservation.</small>}
    </div>}
    <div className="kofi-form-group"><label htmlFor="gift"><Gift size={13} style={{ verticalAlign: "-2px" }} /> Carte cadeau <span style={{ fontWeight: 400 }}>(optionnel)</span></label>
      <div style={{ display: "flex", gap: 8 }}><input id="gift" value={codeInput} onChange={(event) => setCodeInput(event.target.value.toUpperCase())} placeholder="KDO-XXXX-XXXX" autoCapitalize="characters" maxLength={24} style={{ flex: 1 }} />{code ? <button type="button" className="kofi-button outline small" onClick={() => { setCode(""); setCodeInput(""); }}>Retirer</button> : <button type="button" className="kofi-button outline small" disabled={codeInput.trim().length < 4} onClick={() => setCode(codeInput.trim())}>Appliquer</button>}</div>
      {code && card.isFetching && <small>Vérification…</small>}
      {code && card.data?.valid && <small style={{ color: "#1c2d4f", fontWeight: 700 }}>Carte valable : {formatXaf(giftXaf)} réglés avec la carte (solde {formatXaf(card.data.balanceXaf)}).</small>}
      {code && (card.error || (card.data && !card.data.valid)) && <small role="alert" style={{ color: "#8a2c1c", fontWeight: 700 }}>{FEATURE_ERRORS.GIFT_CARD_INVALID}</small>}
    </div>
  </div>;
}
