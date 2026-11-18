import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Ban,
  CalendarDays,
  Check,
  Bell,
  CheckCircle2,
  Flag,
  ChevronDown,
  Clock3,
  Crown,
  Home as HomeIcon,
  ListFilter,
  LogIn,
  MapPin,
  Menu,
  RefreshCcw,
  Scissors,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Star,
  Store,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import { keepPreviousData } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { startLogin } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { isStaff } from "@shared/permissions";
import { CATEGORY_TILES, illustrationFor, photoSrcSet, photoUrl } from "@/lib/photos";
import { BookingExtras, FavoriteButton, FavoritesPage, FEATURE_ERRORS, GiftCardsPage, HelpPage, LoyaltyPage, OffpeakBadge, RescheduleForm, StaffPicker, TopRatedBadge, type Extras } from "./Features";
import {
  doualaDay,
  formatDayLabel,
  formatDuration,
  formatSlot,
  formatTime,
  formatXaf,
  modeLabel,
  STATUS_LABELS,
  upcomingDays,
  type Booking,
  type Professional,
} from "@/lib/format";

// Le back-office n’est téléchargé que par les administrateurs qui ouvrent /admin.
const AdminPage = lazy(() => import("./Admin"));
const SuperAdminPage = lazy(() => import("./SuperAdmin"));
const ProPage = lazy(() => import("./Pro"));
// Tondeuse 3D (Three.js) : chargée à part pour ne pas alourdir le premier affichage.
const Clipper3D = lazy(() => import("@/components/Clipper3D"));

/** Brouillon conservé sur l’appareil pendant l’aller-retour de connexion. Seuls des identifiants sont gardés : prix et durées sont relus sur le serveur. */
export type BookingDraft = { slug: string; serviceIds: string[]; startsAt: string; mode: "salon" | "domicile"; staffMemberId?: number | null; offpeakPercent?: number };
const DRAFT_KEY = "kofi-booking-draft-v2";
const CITIES = ["Douala", "Yaoundé", "Bafoussam"];

function readDraft(): BookingDraft | null {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (value && typeof value.slug === "string" && Array.isArray(value.serviceIds) && typeof value.startsAt === "string" && (value.mode === "salon" || value.mode === "domicile")) return value;
  } catch { /* brouillon illisible : ignoré */ }
  return null;
}
function writeDraft(draft: BookingDraft | null) {
  try {
    if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else localStorage.removeItem(DRAFT_KEY);
  } catch { /* stockage indisponible (navigation privée) : le brouillon reste en mémoire */ }
}

/** La connexion peut ne pas être configurée (développement local) : on prévient au lieu de planter. */
function safeLogin() {
  try {
    startLogin();
  } catch {
    window.alert("La connexion n’est pas encore configurée sur cet environnement.");
  }
}

function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Suit l’état du réseau pour prévenir l’utilisateur (petits forfaits, coupures fréquentes). */
function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  return online;
}

function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return <div className="kofi-offline" role="status">Vous êtes hors connexion. Les profils déjà consultés restent visibles ; créneaux et réservations reviennent avec le réseau.</div>;
}

const initials = (name: string) => name.split(" ").map((part) => part[0]).join("").slice(0, 2);

function bookingErrorMessage(message: string) {
  const messages: Record<string, string> = {
    SLOT_UNAVAILABLE: "Ce créneau vient d’être pris. Choisissez-en un autre.",
    MODE_UNAVAILABLE: "Ce mode de rendez-vous n’est pas disponible pour ce professionnel.",
    CONFIRMED_BOOKING_PROTECTED: "Une réservation confirmée ne peut pas être modifiée ici.",
    CUSTOMER_DETAILS_INVALID: "Vérifiez votre nom et votre numéro de téléphone.",
    PROFESSIONAL_NOT_FOUND: "Ce professionnel n’est plus disponible.",
    SERVICE_NOT_FOUND: "Une prestation sélectionnée n’est plus disponible.",
    SLOT_IN_PAST: "Ce créneau est déjà passé. Choisissez un horaire à venir.",
    SLOT_OUTSIDE_HOURS: "Ce créneau est en dehors des horaires du professionnel.",
    DURATION_MISMATCH: "Les prestations ont changé. Rechargez le profil puis recomposez votre sélection.",
    TOTAL_MISMATCH: "Les tarifs ont changé. Rechargez le profil puis recomposez votre sélection.",
    ADDRESS_REQUIRED: "Indiquez une adresse complète pour un rendez-vous à domicile.",
    BOOKING_NOT_CANCELLABLE: "Cette réservation ne peut plus être annulée.",
    BOOKING_NOT_FOUND: "Cette réservation est introuvable.",
    ACCOUNT_SUSPENDED: "Votre compte est suspendu. Contactez le support KOFI.",
    PROMO_INVALID: "Ce code promo n’existe pas ou n’est plus actif.",
    PROMO_EXPIRED: "Ce code promo n’est pas valable à cette date.",
    PROMO_MIN_TOTAL: "Le montant de votre sélection est trop faible pour ce code.",
    PROMO_EXHAUSTED: "Ce code promo a atteint son nombre maximal d’utilisations.",
    PROMO_ALREADY_USED: "Vous avez déjà utilisé ce code promo.",
    CANCELLATION_TOO_LATE: "Moins de 24 h avant le rendez-vous : l’annulation se fait directement avec le professionnel.",
    PAYMENTS_DISABLED: "Le paiement en ligne n’est pas encore activé.",
    PAYMENT_NOT_DUE: "Aucun paiement n’est attendu pour cette réservation.",
    PAYMENT_PROVIDER_ERROR: "Le service de paiement ne répond pas. Réessayez dans quelques minutes.",
    REVIEW_INVALID: "Vérifiez votre avis : une note de 1 à 5 et 1 000 caractères au plus.",
    REVIEW_NOT_ALLOWED: "Un avis n’est possible que dans les 30 jours suivant un rendez-vous terminé.",
    REVIEW_EXISTS: "Vous avez déjà laissé un avis pour ce rendez-vous.",
    REPORT_INVALID: "Décrivez le problème en 10 caractères au moins.",
    REPORT_LIMIT: "Vous avez envoyé beaucoup de signalements aujourd’hui. Réessayez demain ou contactez le support.",
    DATABASE_UNAVAILABLE: "Le service est momentanément indisponible. Réessayez dans un instant.",
  };
  return messages[message] || FEATURE_ERRORS[message] || "La demande n’a pas pu être enregistrée. Réessayez dans un instant.";
}

function Logo() {
  return <span className="kofi-logo"><span className="kofi-mark">O</span><span>KOFI</span></span>;
}

/** Type de compte connecté : chaque type a son propre menu et sa propre page « Mon compte ». */
type AccountKind = "guest" | "client" | "pro" | "staff" | "superadmin";

function useAccountKind(): { kind: AccountKind; proSlug: string | null; loading: boolean } {
  const auth = useAuth();
  const role = auth.user?.role;
  const isUser = auth.isAuthenticated && role === "user";
  // Même requête que l’espace pro (cache partagé) : un client devient « pro » dès qu’il a un profil.
  const pro = trpc.pro.me.useQuery(undefined, { enabled: isUser, retry: false, staleTime: 60_000 });
  if (!auth.isAuthenticated) return { kind: "guest", proSlug: null, loading: auth.loading };
  if (role === "superadmin") return { kind: "superadmin", proSlug: null, loading: false };
  if (isStaff(role)) return { kind: "staff", proSlug: null, loading: false };
  return { kind: pro.data ? "pro" : "client", proSlug: pro.data?.slug ?? null, loading: pro.isLoading };
}

const ACCOUNT_LABELS: Record<AccountKind, string> = { guest: "Votre espace KOFI", client: "Espace client", pro: "Espace professionnel", staff: "Équipe KOFI", superadmin: "Super-administration" };

function Header() {
  const [location] = useLocation();
  const auth = useAuth();
  const { kind, proSlug } = useAccountKind();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [location]);
  const firstName = auth.user?.name?.split(" ")[0];
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const active = (href: string) => (location === href || location.startsWith(`${href}/`) ? "is-active" : undefined);
  return (
    <div className={`kofi-topbar ${scrolled ? "is-scrolled" : ""}`}>
    <header className="kofi-container kofi-nav">
      <Link href="/" className="kofi-button ghost" style={{ padding: 0 }} aria-label="Accueil KOFI"><Logo /></Link>
      <nav id="kofi-menu" className={`kofi-navlinks ${menuOpen ? "is-open" : ""}`} aria-label="Navigation principale">
        {kind === "guest" && <>
          <Link href="/recherche" className={active("/recherche")}>Trouver un pro</Link>
          <Link href="/cartes-cadeaux" className={active("/cartes-cadeaux")}>Cartes cadeaux</Link>
          <Link href="/professionnel" className={active("/professionnel")}>Vous êtes pro ?</Link>
        </>}
        {kind === "client" && <>
          <Link href="/recherche" className={active("/recherche")}>Trouver un pro</Link>
          <Link href="/mes-reservations" className={active("/mes-reservations")}>Mes réservations</Link>
          <Link href="/favoris" className={active("/favoris")}>Mes favoris</Link>
          <Link href="/cartes-cadeaux" className={active("/cartes-cadeaux")}>Cartes cadeaux</Link>
          <Link href="/fidelite" className={`kofi-mobile-only ${active("/fidelite") ?? ""}`}>Ma fidélité</Link>
        </>}
        {kind === "pro" && <>
          <Link href="/professionnel" className={active("/professionnel")}>Mon tableau de bord</Link>
          {proSlug && <Link href={`/pro/${proSlug}`} className={active(`/pro/${proSlug}`)}>Mon profil public</Link>}
        </>}
        {kind === "staff" && <>
          <Link href="/admin" className={active("/admin")}>Administration</Link>
          <Link href="/recherche" className={active("/recherche")}>Catalogue public</Link>
        </>}
        {kind === "superadmin" && <>
          <Link href="/superadmin" className={active("/superadmin")}>Super-admin</Link>
          <Link href="/admin" className={active("/admin")}>Back-office</Link>
        </>}
        {(kind === "guest" || kind === "client" || kind === "pro") && <Link href="/aide" className={`kofi-mobile-only ${active("/aide") ?? ""}`}>Aide</Link>}
        <Link href="/connexion" className="kofi-mobile-only">{auth.isAuthenticated ? "Mon compte" : "Se connecter"}</Link>
      </nav>
      <div className="kofi-header-actions">
        {auth.isAuthenticated && <NotificationBell />}
        {auth.isAuthenticated
          ? <Link href="/connexion" className="kofi-button outline small"><UserRound size={15} /> {firstName || "Mon compte"}</Link>
          : <Link href="/connexion" className="kofi-button outline small"><LogIn size={15} /> Se connecter</Link>}
        <button className="kofi-button icon ghost kofi-mobile-menu" onClick={() => setMenuOpen((value) => !value)} aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"} aria-expanded={menuOpen} aria-controls="kofi-menu">{menuOpen ? <X size={21} /> : <Menu size={21} />}</button>
      </div>
    </header>
    </div>
  );
}

function NotificationBell() {
  const unread = trpc.notifications.unreadCount.useQuery(undefined, { refetchInterval: 60_000, refetchOnWindowFocus: true });
  const count = unread.data ?? 0;
  return <Link href="/notifications" className="kofi-button icon ghost kofi-bell" aria-label={count ? `Notifications : ${count} non lue${count > 1 ? "s" : ""}` : "Notifications"}><Bell size={20} />{count > 0 && <span className="kofi-bell-count" aria-hidden="true">{count > 9 ? "9+" : count}</span>}</Link>;
}

function NotificationsPage() {
  const auth = useAuth();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const list = trpc.notifications.list.useQuery(undefined, { enabled: auth.isAuthenticated });
  const markRead = trpc.notifications.markRead.useMutation({ onSuccess: () => { utils.notifications.invalidate(); } });
  if (auth.loading) return <main className="kofi-container kofi-page"><LoadingBlock /></main>;
  if (!auth.isAuthenticated) return <EmptyPage title="Connectez-vous" description="Vos notifications sont liées à votre compte." action="Se connecter" onAction={() => safeLogin()} />;
  const items = list.data ?? [];
  const unread = items.filter((item) => !item.read).length;
  return <main className="kofi-container kofi-page">
    <div className="kofi-dashboard-head"><div><span className="kofi-eyebrow">Votre espace</span><h1>Notifications</h1></div>{unread > 0 && <button className="kofi-button outline small" onClick={() => markRead.mutate({})} disabled={markRead.isPending}><Check size={14} /> Tout marquer comme lu</button>}</div>
    {list.isLoading ? <LoadingBlock /> : list.error ? <ErrorBlock onRetry={() => list.refetch()} /> : !items.length ? <div className="kofi-empty"><Bell size={26} /><h3>Rien de nouveau</h3><p>Vous serez prévenu ici des confirmations, refus et réponses de KOFI.</p></div>
      : <ul className="kofi-notif-list">{items.map((item) => <li key={item.id}><button className={`kofi-notif ${item.read ? "" : "is-unread"}`} onClick={() => { if (!item.read) markRead.mutate({ id: item.id }); if (item.link) setLocation(item.link); }}>
        <span className="kofi-notif-dot" aria-hidden="true" /><span className="kofi-notif-text"><strong>{item.title}</strong>{item.body && <span>{item.body}</span>}<small>{new Date(item.createdAt).toLocaleString("fr-FR", { timeZone: "Africa/Douala", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{item.read ? "" : " · non lue"}</small></span>
      </button></li>)}</ul>}
  </main>;
}

function Stars({ value, size = 15 }: { value: number; size?: number }) {
  return <span className="kofi-stars" role="img" aria-label={`${value} sur 5`}>{[1, 2, 3, 4, 5].map((star) => <Star key={star} size={size} fill={star <= value ? "currentColor" : "none"} aria-hidden="true" />)}</span>;
}

const PAYMENT_BADGES = { paid: ["Payé", "green"], refund_pending: ["Remboursement en cours", "orange"], refunded: ["Remboursé", "gray"] } as const;

/** Paiement Mobile Money d’une réservation confirmée : demande envoyée sur le téléphone, puis attente de la réponse de l’opérateur. */
function PayForm({ booking, testMode, onDone }: { booking: Booking; testMode: boolean; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [operator, setOperator] = useState<"mtn" | "orange">("mtn");
  const [phone, setPhone] = useState(booking.customerPhone.replace(/^\+237/, ""));
  const [paymentId, setPaymentId] = useState<number | null>(null);
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState("");
  const [startedAt, setStartedAt] = useState(0);
  const initiate = trpc.payments.initiate.useMutation({ onSuccess: (result) => { setPaymentId(result.paymentId); setInstructions(result.instructions); setStartedAt(Date.now()); }, onError: (requestError) => setError(bookingErrorMessage(requestError.message)) });
  const status = trpc.payments.status.useQuery({ paymentId: paymentId ?? 0 }, { enabled: Boolean(paymentId), refetchInterval: (query) => (query.state.data?.status === "pending" && Date.now() - startedAt < 180_000 ? 3000 : false) });
  const simulate = trpc.payments.simulate.useMutation({ onSuccess: () => status.refetch() });
  useEffect(() => { if (status.data && status.data.status !== "pending") { utils.booking.mine.invalidate(); utils.notifications.invalidate(); } }, [status.data, utils]);
  const amount = booking.amountDueXaf - booking.amountPaidXaf;
  if (status.data?.status === "succeeded") return <div className="kofi-pay full" role="status"><CheckCircle2 size={18} /> Paiement de {formatXaf(status.data.amountXaf)} confirmé. Merci !<button className="kofi-button outline small" onClick={onDone}>Fermer</button></div>;
  return <div className="kofi-pay full">
    {testMode && <span className="kofi-status orange">Mode test : aucun débit réel</span>}
    {error && <div className="kofi-alert" role="alert"><X size={16} /> {error}</div>}
    {!paymentId || status.data?.status === "failed" ? <form className="kofi-form-grid" onSubmit={(event) => { event.preventDefault(); setError(""); setPaymentId(null); initiate.mutate({ reference: booking.reference, operator, phone }); }}>
      {status.data?.status === "failed" && <div className="kofi-alert" role="alert" style={{ gridColumn: "1 / -1" }}><X size={16} /> Paiement non abouti : {status.data.failureReason ?? "refusé par l’opérateur"}. Vous pouvez réessayer.</div>}
      <fieldset className="kofi-form-group full" style={{ border: 0, padding: 0, margin: 0 }}><legend style={{ fontSize: 12, fontWeight: 800, color: "#556073", marginBottom: 6 }}>Opérateur</legend>
        <div className="kofi-slots">{(["mtn", "orange"] as const).map((item) => <button type="button" key={item} className={`kofi-slot ${operator === item ? "selected" : ""}`} aria-pressed={operator === item} onClick={() => setOperator(item)}>{item === "mtn" ? "MTN MoMo" : "Orange Money"}</button>)}</div>
      </fieldset>
      <div className="kofi-form-group full"><label htmlFor={`pay-${booking.reference}`}>Numéro Mobile Money</label><input id={`pay-${booking.reference}`} value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" autoComplete="tel" /></div>
      <div style={{ display: "flex", gap: 8, gridColumn: "1 / -1", flexWrap: "wrap" }}><button className="kofi-button primary small" type="submit" disabled={initiate.isPending}>{initiate.isPending ? "Envoi…" : `Payer ${formatXaf(amount)}`}</button><button className="kofi-button outline small" type="button" onClick={onDone}>Plus tard</button></div>
    </form> : <div role="status" style={{ display: "grid", gap: 8 }}>
      <strong><RefreshCcw className="kofi-spinner" size={15} /> En attente de votre validation…</strong>
      <span style={{ fontSize: 13 }}>{instructions || "Validez le paiement sur votre téléphone avec votre code secret."}</span>
      {testMode && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button className="kofi-button primary small" disabled={simulate.isPending} onClick={() => simulate.mutate({ paymentId, outcome: "succeeded" })}>Simuler : paiement accepté</button><button className="kofi-button outline small" disabled={simulate.isPending} onClick={() => simulate.mutate({ paymentId, outcome: "failed" })}>Simuler : refus</button></div>}
    </div>}
  </div>;
}

function ReviewForm({ reference, onDone }: { reference: string; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const create = trpc.reviews.create.useMutation({ onSuccess: () => { utils.booking.mine.invalidate(); utils.catalog.invalidate(); onDone(); }, onError: (requestError) => setError(bookingErrorMessage(requestError.message)) });
  return <form className="kofi-form-grid" style={{ gridColumn: "1 / -1", borderTop: "1px solid #e8e5df", paddingTop: 14 }} onSubmit={(event) => { event.preventDefault(); if (!rating) { setError("Choisissez une note de 1 à 5 étoiles."); return; } create.mutate({ reference, rating, comment: comment.trim() || undefined }); }}>
    {error && <div className="kofi-alert" role="alert" style={{ gridColumn: "1 / -1" }}><X size={16} /> {error}</div>}
    <fieldset className="kofi-form-group full" style={{ border: 0, padding: 0, margin: 0 }}><legend style={{ fontSize: 12, fontWeight: 800, color: "#556073", marginBottom: 6 }}>Votre note</legend>
      <div className="kofi-star-pick">{[1, 2, 3, 4, 5].map((star) => <button type="button" key={star} aria-label={`${star} étoile${star > 1 ? "s" : ""}`} aria-pressed={rating === star} onClick={() => setRating(star)} className={star <= rating ? "is-on" : ""}><Star size={26} fill={star <= rating ? "currentColor" : "none"} aria-hidden="true" /></button>)}</div>
    </fieldset>
    <div className="kofi-form-group full"><label htmlFor={`rev-${reference}`}>Votre avis (optionnel, public)</label><textarea id={`rev-${reference}`} value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} placeholder="Qu’avez-vous apprécié ? Seuls votre prénom et votre initiale seront affichés." /></div>
    <div style={{ display: "flex", gap: 8, gridColumn: "1 / -1" }}><button className="kofi-button primary small" type="submit" disabled={create.isPending}>{create.isPending ? "Envoi…" : "Publier mon avis"}</button><button className="kofi-button outline small" type="button" onClick={onDone}>Plus tard</button></div>
  </form>;
}

function PortfolioSection({ slug }: { slug: string }) {
  const photos = trpc.catalog.portfolio.useQuery({ slug });
  if (!photos.data?.length) return null;
  return <section style={{ marginTop: 30 }}><div className="kofi-section-header"><div><span className="kofi-eyebrow">Réalisations</span><h2>Ses vraies réalisations</h2><p>Photos envoyées par le professionnel et vérifiées par KOFI.</p></div></div>
    <div className="kofi-photo-grid">{photos.data.map((photo) => <a key={photo.id} className="kofi-photo" href={photo.url} target="_blank" rel="noreferrer"><img src={photo.thumbUrl} alt={photo.description ?? "Réalisation"} loading="lazy" width={400} height={400} />{photo.description && <figcaption><small>{photo.description}</small></figcaption>}</a>)}</div></section>;
}

function ReviewsSection({ slug }: { slug: string }) {
  const list = trpc.catalog.reviews.useQuery({ slug });
  if (!list.data?.length) return null;
  return <section style={{ marginTop: 30 }}><div className="kofi-section-header"><div><span className="kofi-eyebrow">Avis vérifiés</span><h2>Ce qu’en disent les clients</h2><p>Seuls les clients d’un rendez-vous terminé peuvent laisser un avis.</p></div></div>
    <div className="kofi-results">{list.data.map((review) => <article className="kofi-panel" key={review.id}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}><Stars value={review.rating} /><strong>{review.author}</strong><span style={{ color: "#5d6779", fontSize: 12 }}>{new Date(review.createdAt).toLocaleDateString("fr-FR", { timeZone: "Africa/Douala", month: "long", year: "numeric" })}</span></div>
      {review.comment && <p style={{ margin: "8px 0 0" }}>{review.comment}</p>}
      {review.proReply && <p className="kofi-pro-reply"><strong>Réponse du professionnel :</strong> {review.proReply}</p>}
    </article>)}</div></section>;
}

function Footer() {
  return <footer className="kofi-footer">
    <div className="kofi-container kofi-footer-grid">
      <div className="kofi-footer-brand"><Logo /><p>La réservation beauté simple et transparente au Cameroun : tarifs affichés, vrais créneaux, professionnels vérifiés.</p><span className="kofi-footer-tag"><ShieldCheck size={14} /> Paiement Mobile Money sécurisé</span></div>
      <nav aria-label="Clients"><h4>Clients</h4><Link href="/recherche">Trouver un professionnel</Link><Link href="/recherche?offers=1">Offres heures creuses</Link><Link href="/cartes-cadeaux">Cartes cadeaux</Link><Link href="/fidelite">Programme fidélité</Link><Link href="/mes-reservations">Mes réservations</Link></nav>
      <nav aria-label="Professionnels"><h4>Professionnels</h4><Link href="/professionnel">Espace professionnel</Link><Link href="/professionnel">Publier mes tarifs</Link><Link href="/professionnel">Gérer mon agenda</Link></nav>
      <nav aria-label="Informations"><h4>Informations</h4><Link href="/aide">Aide et questions fréquentes</Link><Link href="/confidentialite">Confidentialité</Link><Link href="/mentions-legales">Mentions légales</Link></nav>
    </div>
    <div className="kofi-container kofi-footer-bottom"><span>© {new Date().getFullYear()} KOFI · Une réservation plus humaine.</span><span>Douala · Yaoundé · Bafoussam · Photos d’illustration : Unsplash</span></div>
  </footer>;
}

/** Fait apparaître en fondu les blocs marqués `kofi-reveal` quand ils entrent à l’écran. */
function useReveal(deps: unknown[]) {
  useEffect(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>(".kofi-reveal:not(.is-in)"));
    if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { items.forEach((item) => item.classList.add("is-in")); return; }
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add("is-in"); observer.unobserve(entry.target); } }), { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function DemoBanner() {
  return <div className="kofi-demo-banner"><span><strong>Mode démonstration.</strong> Les professionnels et disponibilités affichés sont des données de test, pas des prestations réelles.</span><span aria-hidden="true">MVP</span></div>;
}

function LoadingBlock({ label = "Chargement…" }: { label?: string }) {
  return <div className="kofi-loading" role="status"><RefreshCcw className="kofi-spinner" size={22} /> {label}</div>;
}

function ErrorBlock({ message = "Impossible de charger les données. Vérifiez votre connexion.", onRetry }: { message?: string; onRetry?: () => void }) {
  return <div className="kofi-alert" role="alert"><X size={16} /> <span>{message}{onRetry && <> <button className="kofi-link" onClick={onRetry}>Réessayer</button></>}</span></div>;
}

function ProVisual({ professional, compact = false }: { professional: Professional; compact?: boolean }) {
  const photo = illustrationFor(professional.specialties);
  return <div className="kofi-pro-visual has-photo" style={{ background: "#1c2d4f" }}>
    <img className="kofi-pro-photo" src={photoUrl(photo, 640, 400)} srcSet={photoSrcSet(photo, 640, 400)} alt="" loading="lazy" decoding="async" />
    {professional.verified && <span className="kofi-badge"><BadgeCheck size={11} /> Vérifié</span>}
    <span className="kofi-pro-initials" style={{ fontSize: compact ? 34 : undefined }} aria-hidden="true">{initials(professional.name)}</span>
    <span className="kofi-photo-note">Photo d’illustration</span>
  </div>;
}

function ProfessionalCard({ professional }: { professional: Professional }) {
  return <article className="kofi-pro-card">
    <div className="kofi-pro-visual-wrap" style={{ position: "relative" }}><ProVisual professional={professional} /><div className="kofi-card-fav"><FavoriteButton slug={professional.slug} /></div></div>
    <div className="kofi-pro-body">
      <div className="kofi-pro-title"><div><h3>{professional.name}</h3><p>{professional.salon} · {professional.neighborhood}</p></div><span className="kofi-rating">{professional.reviewCount ? <><Star size={14} fill="currentColor" /> {professional.rating.toFixed(1)}</> : "Nouveau"}</span></div>
      {(professional.topRated || professional.offpeakMaxPercent > 0) && <div className="kofi-badges">{professional.topRated && <TopRatedBadge />}<OffpeakBadge percent={professional.offpeakMaxPercent} /></div>}
      <div className="kofi-specialties">{professional.specialties.map((tag) => <span className="kofi-specialty" key={tag}>{tag}</span>)}</div>
      <div className="kofi-card-foot"><span>Dès {formatXaf(professional.priceFrom)} · {modeLabel(professional.mode)}</span><Link href={`/pro/${professional.slug}`} className="kofi-button ghost small">Voir le profil <ArrowRight size={14} /></Link></div>
    </div>
  </article>;
}

function SearchBox({ compact = false }: { compact?: boolean }) {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("Toutes les villes");
  const categories = trpc.catalog.categories.useQuery(undefined, { enabled: !compact, staleTime: 5 * 60_000 });
  const submit = (event?: FormEvent) => { event?.preventDefault(); setLocation(`/recherche?query=${encodeURIComponent(query)}&city=${encodeURIComponent(city)}`); };
  return <div>
    <form className="kofi-search-panel" style={compact ? { boxShadow: "none" } : undefined} onSubmit={submit} role="search">
      <label className="kofi-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Prestation, nom, salon…" aria-label="Rechercher une prestation, un professionnel ou un salon" /></label>
      <label className="kofi-field"><MapPin size={17} /><select value={city} onChange={(event) => setCity(event.target.value)} aria-label="Choisir une ville"><option>Toutes les villes</option>{CITIES.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></label>
      <button className="kofi-button primary" type="submit"><Search size={16} /> Rechercher</button>
    </form>
    {!compact && !!categories.data?.length && <div className="kofi-suggestions" aria-label="Suggestions de recherche">{categories.data.slice(0, 8).map((category) => <button className="kofi-chip" key={category} onClick={() => setLocation(`/recherche?query=${encodeURIComponent(category)}`)}>{category}</button>)}</div>}
  </div>;
}

function HomePage() {
  const [, setLocation] = useLocation();
  const featured = trpc.catalog.search.useQuery({ limit: 3 });
  useReveal([featured.isLoading]);
  return <>
    <section className="kofi-container kofi-hero">
      <div>
        <span className="kofi-eyebrow"><Sparkles size={14} /> La réservation qui vous ressemble</span>
        <h1 className="kofi-title">Trouvez votre <em>main de confiance.</em></h1>
        <p className="kofi-lead">KOFI rend la beauté plus simple au Cameroun : des profils lisibles, des tarifs affichés et des créneaux clairs, sans appels à répétition.</p>
        <div className="kofi-hero-actions"><Link href="/recherche" className="kofi-button primary">Trouver un professionnel <ArrowRight size={16} /></Link><Link href="/professionnel" className="kofi-button ghost">Je suis professionnel</Link></div>
        <p className="kofi-note"><ShieldCheck size={15} /> Données de démonstration signalées. Aucun faux portfolio présenté comme réel.</p>
      </div>
      <div className="kofi-hero-art has-photo" aria-hidden="true"><img className="kofi-hero-photo" src={photoUrl("hero", 1100, 820)} srcSet={photoSrcSet("hero", 1100, 820)} alt="" fetchPriority="high" decoding="async" /><div className="kofi-sun" /><Suspense fallback={null}><Clipper3D className="kofi-clipper-3d" /></Suspense><div className="kofi-art-copy"><h3>Vos cheveux.<br />Vos règles.</h3><p>Réservez au salon ou à domicile, quand c’est le bon moment pour vous.</p></div><div className="kofi-art-card"><strong>Créneaux en temps réel</strong><span>Horaires affichés en heure de Douala</span></div></div>
    </section>
    <section className="kofi-container" style={{ marginTop: -6 }}><SearchBox /></section>
    <section className="kofi-container kofi-categories kofi-reveal" aria-labelledby="kofi-cat-title">
      <div className="kofi-section-header"><div><span className="kofi-eyebrow">Explorer</span><h2 id="kofi-cat-title">Une envie, un savoir-faire.</h2></div></div>
      <div className="kofi-cat-grid">{CATEGORY_TILES.map((tile) => <Link key={tile.key} href={`/recherche?query=${encodeURIComponent(tile.query)}`} className="kofi-cat-tile">
        <img src={photoUrl(tile.key, 420, 520)} srcSet={photoSrcSet(tile.key, 420, 520)} alt="" loading="lazy" decoding="async" />
        <span className="kofi-cat-label">{tile.label} <ArrowRight size={15} /></span>
      </Link>)}</div>
    </section>
    <section className="kofi-container kofi-section kofi-reveal">
      <div className="kofi-section-header"><div><span className="kofi-eyebrow">Pour commencer</span><h2>Le bon geste, au bon endroit.</h2><p>Un aperçu de notre catalogue de test, à explorer comme un vrai parcours.</p></div><button className="kofi-link" onClick={() => setLocation("/recherche")}>Voir tous les profils <ArrowRight size={15} /></button></div>
      {featured.isLoading ? <LoadingBlock label="Chargement des profils…" /> : featured.error ? <ErrorBlock onRetry={() => featured.refetch()} /> : <div className="kofi-grid">{featured.data?.map((professional) => <ProfessionalCard professional={professional} key={professional.slug} />)}</div>}
    </section>
    <section className="kofi-container kofi-steps-section kofi-reveal">
      <div className="kofi-section-header"><div><span className="kofi-eyebrow">Comment ça marche</span><h2>Réservé en trois gestes.</h2><p>Pas d’appels, pas d’attente : vous voyez tout avant de confirmer.</p></div></div>
      <ol className="kofi-steps">
        <li><span className="kofi-step-num">01</span><Search size={22} /><h3>Choisissez votre pro</h3><p>Filtrez par ville, prestation, prix et lieu : au salon ou à domicile.</p></li>
        <li><span className="kofi-step-num">02</span><CalendarDays size={22} /><h3>Prenez un vrai créneau</h3><p>Seuls les horaires réellement libres sont proposés, en heure de Douala.</p></li>
        <li><span className="kofi-step-num">03</span><CheckCircle2 size={22} /><h3>Recevez la confirmation</h3><p>Le professionnel accepte votre demande et vous suivez tout depuis votre compte.</p></li>
      </ol>
    </section>
    <section className="kofi-container kofi-reveal">
      <div className="kofi-pro-cta">
        <div className="kofi-pro-cta-copy">
          <span className="kofi-eyebrow"><Scissors size={14} /> Pour les professionnels</span>
          <h2>Coiffeurs, barbiers, esthéticiennes : remplissez votre agenda.</h2>
          <p>Publiez vos tarifs, vos horaires et vos réalisations. Recevez des demandes claires, acceptez en un geste, suivez vos revenus.</p>
          <ul><li><CheckCircle2 size={16} /> Profil vérifié par l’équipe KOFI</li><li><CheckCircle2 size={16} /> Agenda et congés en ligne</li><li><CheckCircle2 size={16} /> Paiement Mobile Money</li></ul>
          <div className="kofi-hero-actions"><Link href="/professionnel" className="kofi-button primary">Créer mon espace pro <ArrowRight size={16} /></Link></div>
        </div>
        <div className="kofi-pro-cta-art" aria-hidden="true">
          <img className="kofi-pro-cta-photo" src={photoUrl("proCta", 720, 820)} srcSet={photoSrcSet("proCta", 720, 820)} alt="" loading="lazy" decoding="async" />
          <div className="kofi-mock-card"><span className="kofi-mock-dot" /><div><strong>Nouvelle demande</strong><small>Coupe + barbe · Sam. 10:30</small></div><em>8 000 FCFA</em></div>
          <div className="kofi-mock-card"><span className="kofi-mock-dot green" /><div><strong>Rendez-vous confirmé</strong><small>Tresses collées · Dim. 14:00</small></div><em>15 000 FCFA</em></div>
          <div className="kofi-mock-card"><span className="kofi-mock-dot gold" /><div><strong>Nouvel avis ★★★★★</strong><small>« Travail soigné et ponctuel »</small></div></div>
        </div>
      </div>
      <p className="kofi-note" style={{ justifyContent: "center", marginBottom: 70 }}><ShieldCheck size={15} /> Exemple d’interface. Les badges et avis sont liés à de vrais comptes vérifiés.</p>
    </section>
  </>;
}

function SearchPage() {
  const params = new URLSearchParams(useSearch());
  const [query, setQuery] = useState(params.get("query") || "");
  const [city, setCity] = useState(params.get("city") || "Toutes les villes");
  const [mode, setMode] = useState("Tous les modes");
  const [maxPrice, setMaxPrice] = useState(30000);
  const [sort, setSort] = useState<"recommended" | "rating" | "price_asc" | "price_desc" | "newest">("recommended");
  const [when, setWhen] = useState<"any" | "today" | "tomorrow" | "date">(params.get("when") === "today" ? "today" : "any");
  const [date, setDate] = useState(upcomingDays(3)[2]);
  const [minRating, setMinRating] = useState(0);
  const [offersOnly, setOffersOnly] = useState(params.get("offers") === "1");
  const debouncedQuery = useDebounced(query);
  const days = useMemo(() => upcomingDays(14), []);
  const availableOn = when === "today" ? days[0] : when === "tomorrow" ? days[1] : when === "date" ? date : undefined;
  const results = trpc.catalog.search.useQuery(
    { query: debouncedQuery || undefined, city, mode: mode === "Tous les modes" ? undefined : mode, maxPrice, sort, availableOn, minRating: minRating || undefined, offersOnly: offersOnly || undefined },
    { placeholderData: keepPreviousData },
  );
  const sorted = results.data ?? [];
  const reset = () => { setQuery(""); setCity("Toutes les villes"); setMode("Tous les modes"); setMaxPrice(30000); setWhen("any"); setMinRating(0); setOffersOnly(false); };
  return <main className="kofi-container kofi-page">
    <div className="kofi-breadcrumb"><Link href="/" className="kofi-button ghost small"><ArrowLeft size={14} /> Accueil</Link> <span>/ Recherche</span></div>
    <h1 className="kofi-page-title">Trouvez votre prochain rendez-vous.</h1>
    <p className="kofi-page-lead">Affinez les résultats selon votre ville, votre style et votre façon de vous faire coiffer.</p>
    <DemoBanner />
    <div className="kofi-results-layout" style={{ marginTop: 28 }}>
      <aside className="kofi-filter-panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><h3><SlidersHorizontal size={15} style={{ verticalAlign: "-2px" }} /> Filtres</h3><button className="kofi-button ghost small" onClick={reset}>Réinitialiser</button></div>
        <div className="kofi-filter-group"><label className="kofi-filter-label" htmlFor="f-query">Recherche</label><input id="f-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Prestation, nom, quartier…" /></div>
        <div className="kofi-filter-group"><label className="kofi-filter-label" htmlFor="f-city">Ville</label><select id="f-city" value={city} onChange={(event) => setCity(event.target.value)}><option>Toutes les villes</option>{CITIES.map((item) => <option key={item}>{item}</option>)}</select></div>
        <fieldset className="kofi-filter-group" style={{ border: 0, padding: 0, margin: 0 }}><legend className="kofi-filter-label">Mode de prestation</legend><label className="kofi-check"><input type="radio" name="mode" checked={mode === "Tous les modes"} onChange={() => setMode("Tous les modes")} /> Tous les modes</label><label className="kofi-check"><input type="radio" name="mode" checked={mode === "salon"} onChange={() => setMode("salon")} /> En salon</label><label className="kofi-check"><input type="radio" name="mode" checked={mode === "domicile"} onChange={() => setMode("domicile")} /> À domicile</label></fieldset>
        <fieldset className="kofi-filter-group" style={{ border: 0, padding: 0, margin: 0 }}><legend className="kofi-filter-label">Disponibilité</legend>
          <div className="kofi-chips">{([["any", "Peu importe"], ["today", "Aujourd’hui"], ["tomorrow", "Demain"], ["date", "Choisir un jour"]] as const).map(([value, label]) => <button type="button" key={value} className={`kofi-chip ${when === value ? "is-on" : ""}`} aria-pressed={when === value} onClick={() => setWhen(value)}>{label}</button>)}</div>
          {when === "date" && <select value={date} onChange={(event) => setDate(event.target.value)} aria-label="Jour souhaité" style={{ marginTop: 8 }}>{days.map((item) => <option key={item} value={item}>{formatDayLabel(item)}</option>)}</select>}
        </fieldset>
        <fieldset className="kofi-filter-group" style={{ border: 0, padding: 0, margin: 0 }}><legend className="kofi-filter-label">Note minimale</legend>
          <div className="kofi-chips">{([[0, "Toutes"], [4, "4 ★ et +"], [4.5, "4,5 ★ et +"]] as const).map(([value, label]) => <button type="button" key={value} className={`kofi-chip ${minRating === value ? "is-on" : ""}`} aria-pressed={minRating === value} onClick={() => setMinRating(value)}>{label}</button>)}</div>
        </fieldset>
        <label className="kofi-check"><input type="checkbox" checked={offersOnly} onChange={(event) => setOffersOnly(event.target.checked)} /> Offres heures creuses uniquement</label>
        <div className="kofi-filter-group"><label className="kofi-filter-label" htmlFor="f-price">Budget maximum <strong>{formatXaf(maxPrice)}</strong></label><input id="f-price" type="range" min="4000" max="30000" step="1000" value={maxPrice} onChange={(event) => setMaxPrice(Number(event.target.value))} /></div>
      </aside>
      <section aria-busy={results.isFetching}>
        <div className="kofi-results-toolbar"><p aria-live="polite"><strong>{sorted.length}</strong> professionnel{sorted.length > 1 ? "s" : ""} trouvé{sorted.length > 1 ? "s" : ""}</p><label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: "#5d6779" }}><ListFilter size={14} /><span className="sr-only">Trier</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="recommended">Recommandés</option><option value="rating">Meilleures notes</option><option value="price_asc">Prix croissant</option><option value="price_desc">Prix décroissant</option><option value="newest">Nouveaux sur KOFI</option></select></label></div>
        {results.isLoading ? <LoadingBlock label="Recherche en cours…" /> : results.error ? <ErrorBlock onRetry={() => results.refetch()} /> : sorted.length ? <div className="kofi-results">{sorted.map((professional) => <div className="kofi-result-card" key={professional.slug}><div style={{ position: "relative" }}><ProVisual professional={professional} compact /><div className="kofi-card-fav"><FavoriteButton slug={professional.slug} /></div></div><div>{(professional.topRated || professional.offpeakMaxPercent > 0) && <div className="kofi-badges" style={{ marginBottom: 6 }}>{professional.topRated && <TopRatedBadge />}<OffpeakBadge percent={professional.offpeakMaxPercent} /></div>}<h3>{professional.name}</h3><p style={{ margin: "5px 0", color: "#5d6779", fontSize: 13 }}>{professional.salon} · {professional.neighborhood}, {professional.city}</p><span className="kofi-rating">{professional.reviewCount ? <><Star size={13} fill="currentColor" /> {professional.rating.toFixed(1)} · {professional.reviewCount} avis</> : "Nouveau sur KOFI"}</span><div className="kofi-specialties">{professional.specialties.slice(0, 3).map((tag) => <span className="kofi-specialty" key={tag}>{tag}</span>)}</div></div><div className="kofi-card-foot"><span>Dès {formatXaf(professional.priceFrom)}</span><Link href={`/pro/${professional.slug}`} className="kofi-button primary small">Voir <ArrowRight size={14} /></Link></div></div>)}</div> : <div className="kofi-empty"><Search size={26} /><h3>Aucun résultat pour l’instant</h3><p>Essayez une autre ville ou une spécialité plus large. KOFI enrichira ce catalogue au fil des professionnels vérifiés.</p><button className="kofi-button soft small" onClick={reset}>Voir tout le catalogue</button></div>}
      </section>
    </div>
  </main>;
}

function ProfessionalPage({ slug, onBook }: { slug: string; onBook: (draft: BookingDraft) => void }) {
  const professionalQuery = trpc.catalog.professional.useQuery({ slug });
  const professional = professionalQuery.data;
  const days = useMemo(() => upcomingDays(14), []);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [day, setDay] = useState(days[0]);
  const [startsAt, setStartsAt] = useState("");
  const [mode, setMode] = useState<"salon" | "domicile">("salon");
  const [staffMemberId, setStaffMemberId] = useState<number | null>(null);
  useEffect(() => { if (professional?.mode === "domicile") setMode("domicile"); }, [professional?.mode]);
  useEffect(() => setStartsAt(""), [day, selectedIds, staffMemberId]);
  const slots = trpc.catalog.slots.useQuery({ slug, day, serviceIds: selectedIds, staffMemberId }, { enabled: selectedIds.length > 0 && Boolean(professional) });
  if (professionalQuery.isLoading) return <main className="kofi-container kofi-page"><LoadingBlock label="Chargement du profil…" /></main>;
  if (professionalQuery.error) return <main className="kofi-container kofi-page"><ErrorBlock onRetry={() => professionalQuery.refetch()} /></main>;
  if (!professional) return <EmptyPage title="Profil introuvable" description="Ce profil n’existe pas ou n’est plus disponible." action="Retour à la recherche" onAction={() => { window.location.href = "/recherche"; }} />;
  const selected = professional.services.filter((service) => selectedIds.includes(service.id));
  const total = selected.reduce((sum, service) => sum + service.price, 0);
  const duration = selected.reduce((sum, service) => sum + service.duration, 0);
  const offpeak = (startsAt && slots.data?.discounts[startsAt]) || 0;
  const offpeakXaf = offpeak ? Math.floor((total * offpeak) / 100 / 50) * 50 : 0;
  const supportsSalon = professional.mode !== "domicile";
  const supportsHome = professional.mode !== "salon";
  const toggleService = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  return <main className="kofi-container kofi-page">
    <div className="kofi-breadcrumb"><Link href="/recherche" className="kofi-button ghost small"><ArrowLeft size={14} /> Résultats</Link> <span>/ {professional.name}</span></div>
    <div className="kofi-profile-head"><ProVisual professional={professional} /><div><div className="kofi-eyebrow">{professional.verified ? <><BadgeCheck size={14} /> Professionnel vérifié</> : <>Profil en cours de vérification</>}</div><h1>{professional.name}</h1>{(professional.topRated || professional.offpeakMaxPercent > 0) && <div className="kofi-badges" style={{ marginBottom: 10 }}>{professional.topRated && <TopRatedBadge />}<OffpeakBadge percent={professional.offpeakMaxPercent} /></div>}<FavoriteButton slug={professional.slug} label /><p>{professional.bio}</p><div className="kofi-profile-meta"><span><MapPin size={14} /> {professional.salon} · {professional.neighborhood}, {professional.city}</span><span>{professional.reviewCount ? <><Star size={14} fill="currentColor" /> {professional.rating.toFixed(1)} ({professional.reviewCount} avis)</> : "Nouveau sur KOFI"}</span><span>{modeLabel(professional.mode)}</span></div></div></div>
    <DemoBanner />
    <div className="kofi-profile-body">
      <section>
        <div className="kofi-section-header" style={{ marginTop: 25 }}><div><span className="kofi-eyebrow">Choisissez votre formule</span><h2>Prestations</h2><p>Sélectionnez une ou plusieurs prestations pour composer votre rendez-vous.</p></div></div>
        <div className="kofi-service-list">{professional.services.map((service) => { const isSelected = selectedIds.includes(service.id); return <div className={`kofi-service-row ${isSelected ? "selected" : ""}`} key={service.id}><div><strong>{service.name}</strong><small><Clock3 size={13} /> {formatDuration(service.duration)} · {service.category}</small></div><div className="kofi-service-price"><strong>{formatXaf(service.price)}</strong><br /><button className={`kofi-button ${isSelected ? "soft" : "outline"} small`} onClick={() => toggleService(service.id)} aria-pressed={isSelected}>{isSelected ? <><Check size={14} /> Ajoutée</> : "Ajouter"}</button></div></div>; })}</div>
      </section>
      <aside className="kofi-sticky-booking">
        <h3>Votre créneau</h3>
        {!selected.length ? <div className="kofi-alert" style={{ marginTop: 14 }}><Scissors size={17} /> Choisissez au moins une prestation : les créneaux libres s’affichent selon la durée totale.</div> : <>
          <p>Horaires en heure de Douala.</p>
          <label className="kofi-filter-label" htmlFor="slot-day">Jour</label>
          <select id="slot-day" value={day} onChange={(event) => setDay(event.target.value)} style={{ width: "100%", minHeight: 44, marginBottom: 12 }}>{days.map((item) => <option key={item} value={item}>{formatDayLabel(item)}</option>)}</select>
          <StaffPicker staff={professional.staff} value={staffMemberId} onChange={setStaffMemberId} />
          <span className="kofi-filter-label">Heures disponibles</span>
          {slots.isLoading ? <LoadingBlock label="Recherche des créneaux…" /> : slots.error ? <ErrorBlock message={navigator.onLine ? "Impossible de charger les créneaux." : "Les créneaux libres s’affichent seulement avec une connexion : ils changent en temps réel."} onRetry={() => slots.refetch()} /> : slots.data?.startsAt.length ? <div className="kofi-slots" role="group" aria-label="Heures disponibles">{slots.data.startsAt.map((iso) => { const discount = slots.data.discounts[iso]; return <button key={iso} className={`kofi-slot ${startsAt === iso ? "selected" : ""} ${discount ? "has-discount" : ""}`} onClick={() => setStartsAt(iso)} aria-pressed={startsAt === iso} aria-label={discount ? `${formatTime(iso)}, remise de ${discount} %` : undefined}>{formatTime(iso)}{discount ? <em>−{discount}%</em> : null}</button>; })}</div> : <p style={{ fontSize: 13, color: "#5d6779" }}>Aucun créneau libre ce jour-là. Essayez un autre jour.</p>}
          <span className="kofi-filter-label">Mode de rendez-vous</span>
          <div className="kofi-slots">{supportsSalon && <button className={`kofi-slot ${mode === "salon" ? "selected" : ""}`} onClick={() => setMode("salon")} aria-pressed={mode === "salon"}><Store size={13} /> Salon</button>}{supportsHome && <button className={`kofi-slot ${mode === "domicile" ? "selected" : ""}`} onClick={() => setMode("domicile")} aria-pressed={mode === "domicile"}><HomeIcon size={13} /> Domicile</button>}</div>
          <div className="kofi-summary-line"><span>{selected.length} prestation{selected.length > 1 ? "s" : ""}</span><span>{formatDuration(duration)}</span></div>
          {offpeak > 0 && <div className="kofi-summary-line"><span>Heures creuses −{offpeak} %</span><span>−{formatXaf(offpeakXaf)}</span></div>}
          <div className="kofi-summary-line total"><span>Total estimé</span><span>{formatXaf(total - offpeakXaf)}</span></div>
          <button className="kofi-button primary" style={{ width: "100%", marginTop: 14 }} disabled={!startsAt} onClick={() => onBook({ slug: professional.slug, serviceIds: selectedIds, startsAt, mode, staffMemberId, offpeakPercent: offpeak })}>{startsAt ? <>Continuer · {formatSlot(startsAt)} <ArrowRight size={15} /></> : "Choisissez une heure"}</button>
        </>}
      </aside>
    </div>
    <PortfolioSection slug={professional.slug} />
    <ReviewsSection slug={professional.slug} />
  </main>;
}

function BookingPage({ draft, onCreated }: { draft: BookingDraft | null; onCreated: (reference: string) => void }) {
  const [, setLocation] = useLocation();
  const auth = useAuth();
  const utils = trpc.useUtils();
  const professionalQuery = trpc.catalog.professional.useQuery({ slug: draft?.slug ?? "" }, { enabled: Boolean(draft) });
  const createBooking = trpc.booking.create.useMutation({ onSuccess: () => utils.booking.mine.invalidate() });
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [promoInput, setPromoInput] = useState("");
  const paymentConfigBooking = trpc.payments.config.useQuery();
  const [promoCode, setPromoCode] = useState("");
  const promoQuery = trpc.promo.check.useQuery({ code: promoCode, slug: draft?.slug ?? "", serviceIds: draft?.serviceIds ?? [] }, { enabled: Boolean(promoCode && draft && auth.isAuthenticated), retry: false });
  const promo = { data: promoQuery.data?.valid ? promoQuery.data : undefined, refusal: promoQuery.data && !promoQuery.data.valid ? promoQuery.data.reason : promoQuery.error?.message, isFetching: promoQuery.isFetching };
  const [extras, setExtras] = useState<Extras>({ loyaltyPoints: 0, loyaltyDiscountXaf: 0, giftCardCode: "", giftCardXaf: 0 });
  const accountName = auth.user?.name ?? "";
  useEffect(() => { if (accountName) setName((current) => current || accountName); }, [accountName]);
  if (!draft) return <EmptyPage title="Votre réservation vous attend" description="Choisissez d’abord une prestation et un créneau pour continuer." action="Rechercher un professionnel" onAction={() => setLocation("/recherche")} />;
  const backToProfile = <Link href={`/pro/${draft.slug}`} className="kofi-button outline">Choisir un autre créneau</Link>;
  if (auth.loading || professionalQuery.isLoading) return <main className="kofi-container kofi-page"><LoadingBlock label="Préparation de votre demande…" /></main>;
  if (professionalQuery.error) return <main className="kofi-container kofi-page"><ErrorBlock onRetry={() => professionalQuery.refetch()} /></main>;
  const professional = professionalQuery.data;
  const services = professional ? draft.serviceIds.map((id) => professional.services.find((service) => service.id === id)) : [];
  if (!professional || services.some((service) => !service)) return <EmptyPage title="Sélection plus disponible" description="Ce professionnel ou l’une des prestations choisies n’est plus proposé. Recomposez votre rendez-vous." action="Retour à la recherche" onAction={() => { writeDraft(null); setLocation("/recherche"); }} />;
  const chosen = services as NonNullable<(typeof services)[number]>[];
  if (new Date(draft.startsAt).getTime() <= Date.now()) return <main className="kofi-container kofi-page"><div className="kofi-success"><div className="success-icon"><Clock3 size={28} /></div><h1>Ce créneau est passé.</h1><p>Le {formatSlot(draft.startsAt)} n’est plus disponible. Choisissez un nouvel horaire, vos prestations sont conservées.</p><div className="kofi-hero-actions" style={{ justifyContent: "center" }}>{backToProfile}</div></div></main>;
  if (!auth.isAuthenticated) return <main className="kofi-container kofi-page"><div className="kofi-success"><div className="success-icon"><LogIn size={28} /></div><span className="kofi-eyebrow">Compte requis pour confirmer</span><h1>Votre créneau est prêt.</h1><p>Connectez-vous pour enregistrer cette demande dans votre espace sécurisé. Votre sélection est conservée sur cet appareil.</p><div className="kofi-hero-actions" style={{ justifyContent: "center" }}><button className="kofi-button primary" onClick={() => safeLogin()}><LogIn size={16} /> Se connecter pour réserver</button>{backToProfile}</div></div></main>;
  const total = chosen.reduce((sum, service) => sum + service.price, 0);
  const duration = chosen.reduce((sum, service) => sum + service.duration, 0);
  const atHome = draft.mode === "domicile";
  // Estimation affichée (le serveur recalcule tout) : heures creuses → code promo → points → carte cadeau.
  const offpeakXaf = draft.offpeakPercent ? Math.floor((total * draft.offpeakPercent) / 100 / 50) * 50 : 0;
  const afterPromo = total - offpeakXaf - (promo.data?.discountXaf ?? 0);
  const toPay = afterPromo - extras.loyaltyDiscountXaf;
  const staffName = draft.staffMemberId ? professional.staff.find((member) => member.id === draft.staffMemberId)?.name : null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!navigator.onLine) { setError("Vous êtes hors connexion. Votre demande n’a pas été envoyée : réessayez dès que le réseau revient."); return; }
    if (name.trim().length < 2 || phone.replace(/\D/g, "").length < 9) { setError("Indiquez votre nom et un numéro camerounais à 9 chiffres (ex. 6 90 12 34 56)."); return; }
    if (atHome && address.trim().length < 5) { setError("Indiquez l’adresse du rendez-vous à domicile, avec un repère."); return; }
    createBooking.mutate({
      professionalSlug: draft.slug, startsAt: draft.startsAt, durationMinutes: duration, timezone: "Africa/Douala", mode: draft.mode,
      customerName: name.trim(), customerPhone: phone.trim(), address: atHome ? address.trim() : undefined,
      serviceIds: draft.serviceIds, totalXaf: total, notes: notes.trim() || undefined, promoCode: promo.data ? promo.data.code : undefined,
      staffMemberId: draft.staffMemberId ?? null, loyaltyPoints: extras.loyaltyPoints || undefined, giftCardCode: extras.giftCardCode || undefined,
    }, {
      onSuccess: (booking) => onCreated(booking.reference),
      onError: (requestError) => setError(bookingErrorMessage(requestError.message)),
    });
  };
  return <main className="kofi-container kofi-page">
    <div className="kofi-breadcrumb"><Link href={`/pro/${draft.slug}`} className="kofi-button ghost small"><ArrowLeft size={14} /> Modifier</Link> <span>/ Réservation</span></div>
    <h1 className="kofi-page-title">On garde votre créneau.</h1>
    <p className="kofi-page-lead">Encore quelques informations, puis votre demande sera enregistrée dans votre espace avec le statut « en attente ».</p>
    <div className="kofi-booking-layout">
      <form className="kofi-panel" onSubmit={submit} noValidate>
        <h2>Vos coordonnées</h2>
        <p style={{ color: "#5d6779", fontSize: 13, marginTop: -5 }}>Elles servent uniquement à confirmer le rendez-vous avec le professionnel.</p>
        {error && <div className="kofi-alert" role="alert"><X size={16} /> {error}</div>}
        <div className="kofi-form-grid">
          <div className="kofi-form-group"><label htmlFor="name">Nom complet</label><input id="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex. Amina Njoya" autoComplete="name" /></div>
          <div className="kofi-form-group"><label htmlFor="phone">Téléphone</label><input id="phone" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="6 90 12 34 56" inputMode="tel" autoComplete="tel" /></div>
          {atHome && <div className="kofi-form-group full"><label htmlFor="address">Adresse du rendez-vous</label><input id="address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Quartier, rue, repère (ex. près de la pharmacie…)" autoComplete="street-address" /></div>}
          <div className="kofi-form-group full"><label htmlFor="notes">Une précision ? <span style={{ fontWeight: 400 }}>(optionnel)</span></label><textarea id="notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Texture, inspiration, besoin particulier…" maxLength={1000} /></div>
        </div>
        <div className="kofi-form-group" style={{ marginTop: 16 }}>
          <label htmlFor="promo">Code promo <span style={{ fontWeight: 400 }}>(optionnel)</span></label>
          <div style={{ display: "flex", gap: 8 }}><input id="promo" value={promoInput} onChange={(event) => setPromoInput(event.target.value.toUpperCase())} placeholder="Ex. BIENVENUE" autoCapitalize="characters" maxLength={20} style={{ flex: 1 }} /><button type="button" className="kofi-button outline small" disabled={!promoInput.trim() || promo.isFetching} onClick={() => setPromoCode(promoInput.trim())}>{promo.isFetching ? "…" : "Appliquer"}</button></div>
          {promoCode && promo.data && <small style={{ color: "#1c2d4f", fontWeight: 700 }}>{promo.data.label} : −{formatXaf(promo.data.discountXaf)}</small>}
          {promoCode && promo.refusal && <small role="alert" style={{ color: "#8a2c1c", fontWeight: 700 }}>{bookingErrorMessage(promo.refusal)}</small>}
        </div>
        <BookingExtras amountXaf={afterPromo} onChange={setExtras} />
        <div className="kofi-alert" style={{ marginTop: 18, marginBottom: 0 }}><ShieldCheck size={17} /> {paymentConfigBooking.data?.enabled ? `Rien n’est débité maintenant : vous paierez par Mobile Money une fois le rendez-vous accepté par le professionnel${paymentConfigBooking.data.mode === "deposit" ? ` (acompte de ${paymentConfigBooking.data.depositPercent} %)` : ""}. Annulation gratuite jusqu’à ${paymentConfigBooking.data.freeCancelHours} h avant.` : "Aucun paiement en ligne pour l’instant : le règlement se fait avec le professionnel."}</div>
        <button className="kofi-button primary" type="submit" style={{ marginTop: 19 }} disabled={createBooking.isPending}>{createBooking.isPending ? <><RefreshCcw className="kofi-spinner" size={15} /> Envoi…</> : <>Envoyer la demande <ArrowRight size={15} /></>}</button>
        {error && error === bookingErrorMessage("SLOT_UNAVAILABLE") && <div style={{ marginTop: 12 }}>{backToProfile}</div>}
      </form>
      <aside className="kofi-panel">
        <h3>Récapitulatif</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 15, borderBottom: "1px solid #e8e5df" }}><div aria-hidden="true" style={{ width: 47, height: 47, borderRadius: 13, display: "grid", placeItems: "center", color: "#fff", background: professional.accent, fontFamily: "Fraunces, Georgia, serif", fontSize: 20 }}>{initials(professional.name)}</div><div><strong>{professional.name}</strong><p style={{ margin: 3, color: "#5d6779", fontSize: 12 }}>{professional.salon}</p></div></div>
        {chosen.map((service) => <div className="kofi-summary-line" key={service.id}><span>{service.name}</span><span>{formatXaf(service.price)}</span></div>)}
        <div className="kofi-summary-line"><span><Clock3 size={14} style={{ verticalAlign: "-2px" }} /> Durée</span><span>{formatDuration(duration)}</span></div>
        <div className="kofi-summary-line"><span><CalendarDays size={14} style={{ verticalAlign: "-2px" }} /> Créneau</span><span>{formatSlot(draft.startsAt)}</span></div>
        <div className="kofi-summary-line"><span>{atHome ? <HomeIcon size={14} style={{ verticalAlign: "-2px" }} /> : <Store size={14} style={{ verticalAlign: "-2px" }} />} Mode</span><span>{atHome ? "À domicile" : "En salon"}</span></div>
        {staffName && <div className="kofi-summary-line"><span>Avec</span><span>{staffName}</span></div>}
        {offpeakXaf > 0 && <div className="kofi-summary-line"><span>Heures creuses −{draft.offpeakPercent} %</span><span>−{formatXaf(offpeakXaf)}</span></div>}
        {promo.data && <div className="kofi-summary-line"><span>Remise {promo.data.code}</span><span>−{formatXaf(promo.data.discountXaf)}</span></div>}
        {extras.loyaltyDiscountXaf > 0 && <div className="kofi-summary-line"><span>{extras.loyaltyPoints} points fidélité</span><span>−{formatXaf(extras.loyaltyDiscountXaf)}</span></div>}
        <div className="kofi-summary-line total"><span>Total estimé</span><span>{formatXaf(toPay)}</span></div>
        {extras.giftCardXaf > 0 && <><div className="kofi-summary-line"><span>Réglé par carte cadeau</span><span>−{formatXaf(extras.giftCardXaf)}</span></div><div className="kofi-summary-line total"><span>Reste à payer</span><span>{formatXaf(Math.max(0, toPay - extras.giftCardXaf))}</span></div></>}
      </aside>
    </div>
  </main>;
}

function ConfirmationPage() {
  const reference = new URLSearchParams(useSearch()).get("ref") || "";
  const mine = trpc.booking.mine.useQuery(undefined, { retry: false });
  const booking = mine.data?.find((item) => item.reference === reference);
  return <main className="kofi-container kofi-page"><div className="kofi-success"><div className="success-icon"><CheckCircle2 size={30} /></div><span className="kofi-eyebrow">Demande enregistrée</span><h1>Votre place est posée.</h1>
    {booking ? <p>{booking.professional.name} · {formatSlot(booking.startsAt)} · {formatXaf(booking.totalXaf)}<br />Référence <strong>{booking.reference}</strong>. Votre demande est <strong>en attente de confirmation</strong> par le professionnel.</p> : <p>Votre demande est maintenant <strong>en attente de confirmation</strong>.{reference && <> Référence <strong>{reference}</strong>.</>}</p>}
    <Link href="/mes-reservations" className="kofi-button primary">Voir mes réservations <ArrowRight size={15} /></Link></div></main>;
}

function ReservationsPage() {
  const auth = useAuth();
  const utils = trpc.useUtils();
  const mine = trpc.booking.mine.useQuery(undefined, { enabled: auth.isAuthenticated });
  const cancel = trpc.booking.cancel.useMutation({ onSuccess: () => utils.booking.mine.invalidate() });
  const [error, setError] = useState("");
  const [reporting, setReporting] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const paymentConfig = trpc.payments.config.useQuery();
  const freeCancelHours = paymentConfig.data?.freeCancelHours ?? 24;
  const myReports = trpc.reports.mine.useQuery(undefined, { enabled: auth.isAuthenticated });
  const header = <div className="kofi-dashboard-head"><div><span className="kofi-eyebrow">Votre espace</span><h1>Mes réservations</h1><p className="kofi-page-lead">Retrouvez vos demandes et leur statut, sur tous vos appareils.</p></div><Link href="/recherche" className="kofi-button primary"><Search size={15} /> Nouvelle réservation</Link></div>;
  if (auth.loading) return <main className="kofi-container kofi-page">{header}<LoadingBlock label="Vérification de votre session…" /></main>;
  if (!auth.isAuthenticated) return <main className="kofi-container kofi-page">{header}<div className="kofi-empty" style={{ marginTop: 24 }}><LogIn size={27} /><h3>Connectez-vous pour voir vos réservations</h3><p>Vos demandes sont enregistrées dans votre compte KOFI.</p><button className="kofi-button primary small" onClick={() => safeLogin()}>Se connecter</button></div></main>;
  const onCancel = (booking: Booking) => {
    if (!window.confirm(booking.amountPaidXaf > 0 ? `Annuler ${booking.reference} ? Vous serez remboursé de ${formatXaf(booking.amountPaidXaf)} sur votre compte Mobile Money.` : `Annuler ${booking.reference} ?`)) return;
    setError("");
    cancel.mutate({ reference: booking.reference }, { onError: (requestError) => setError(bookingErrorMessage(requestError.message)) });
  };
  const list = mine.data ?? [];
  return <main className="kofi-container kofi-page">{header}<DemoBanner />
    {error && <div style={{ marginTop: 16 }}><ErrorBlock message={error} /></div>}
    {notice && <div className="kofi-adm-toast" role="status" style={{ marginTop: 16 }}><CheckCircle2 size={16} /> {notice}</div>}
    {mine.isLoading ? <LoadingBlock label="Chargement de vos réservations…" /> : mine.error ? (mine.error.message === "ACCOUNT_SUSPENDED" ? <ErrorBlock message={bookingErrorMessage("ACCOUNT_SUSPENDED")} /> : <ErrorBlock onRetry={() => mine.refetch()} />) : list.length ? <div className="kofi-results" style={{ marginTop: 24 }}>{list.map((booking) => {
      const status = STATUS_LABELS[booking.status];
      return <article className="kofi-panel" key={booking.reference} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "center" }}>
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><strong>{booking.professional.name}</strong><span className={`kofi-status ${status.tone}`}>{status.label}</span></div>
          <p style={{ color: "#5d6779", fontSize: 13, margin: "7px 0" }}>{formatSlot(booking.startsAt)} · {booking.mode === "salon" ? "En salon" : "À domicile"} · {booking.items.map((item) => item.name).join(" + ")}{booking.staff ? ` · avec ${booking.staff.name}` : ""}</p>
          <span style={{ fontSize: 12, color: "#5d6779" }}>Référence {booking.reference} · {formatXaf(booking.totalXaf)}{booking.discountXaf > 0 && ` (réductions −${formatXaf(booking.discountXaf)} : ${[booking.offpeakDiscountXaf > 0 && `heures creuses −${booking.offpeakPercent} %`, booking.promoCode && `code ${booking.promoCode}`, booking.loyaltyPointsUsed > 0 && `${booking.loyaltyPointsUsed} points`].filter(Boolean).join(", ")})`}{booking.giftCardXaf > 0 && ` · ${formatXaf(booking.giftCardXaf)} par carte cadeau`}</span>
          {booking.paymentStatus in PAYMENT_BADGES && <span className={`kofi-status ${PAYMENT_BADGES[booking.paymentStatus as keyof typeof PAYMENT_BADGES][1]}`} style={{ marginTop: 6 }}>{PAYMENT_BADGES[booking.paymentStatus as keyof typeof PAYMENT_BADGES][0]}{booking.paymentStatus === "paid" ? ` · ${formatXaf(booking.amountPaidXaf)}` : ""}</span>}
          {booking.status === "confirmed" && booking.paymentStatus === "unpaid" && <p style={{ fontSize: 13, margin: "6px 0 0", fontWeight: 700, color: "#8f5129" }}>{booking.amountDueXaf < booking.totalXaf ? `Acompte à régler : ${formatXaf(booking.amountDueXaf - booking.amountPaidXaf)}` : `À régler : ${formatXaf(booking.amountDueXaf - booking.amountPaidXaf)}`}</p>}
          {booking.status === "confirmed" && new Date(booking.startsAt).getTime() - Date.now() < freeCancelHours * 3_600_000 && <p style={{ fontSize: 12, color: "#5d6779", margin: "6px 0 0" }}>Confirmée : moins de {freeCancelHours} h avant, contactez le professionnel pour tout changement.</p>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
          {booking.status === "confirmed" && booking.paymentStatus === "unpaid" && paying !== booking.reference && paymentConfig.data?.enabled && <button className="kofi-button primary small" onClick={() => setPaying(booking.reference)}><WalletCards size={14} /> Payer</button>}
          {booking.canReschedule && moving !== booking.reference && <button className="kofi-button outline small" onClick={() => { setNotice(""); setMoving(booking.reference); }}><CalendarDays size={14} /> Déplacer</button>}
          {(booking.status === "pending" || (booking.status === "confirmed" && new Date(booking.startsAt).getTime() - Date.now() >= freeCancelHours * 3_600_000)) && <button className="kofi-button outline small" disabled={cancel.isPending} onClick={() => onCancel(booking)}><Ban size={14} /> {booking.amountPaidXaf > 0 ? "Annuler (remboursé)" : "Annuler"}</button>}
          {booking.canReview && reviewing !== booking.reference && <button className="kofi-button primary small" onClick={() => setReviewing(booking.reference)}><Star size={14} /> Donner mon avis</button>}
          {booking.review && <span style={{ fontSize: 12, color: "#5d6779", display: "inline-flex", gap: 6, alignItems: "center" }}>Votre note <Stars value={booking.review.rating} size={13} /></span>}
          <button className="kofi-button ghost small" onClick={() => setReporting(reporting === booking.reference ? null : booking.reference)} aria-expanded={reporting === booking.reference}><Flag size={14} /> Signaler un problème</button>
        </div>
        {moving === booking.reference && <RescheduleForm booking={booking} onDone={(message) => { setMoving(null); if (message) setNotice(message); }} />}
        {paying === booking.reference && <PayForm booking={booking} testMode={Boolean(paymentConfig.data?.testMode)} onDone={() => setPaying(null)} />}
        {reviewing === booking.reference && <ReviewForm reference={booking.reference} onDone={() => setReviewing(null)} />}
        {reporting === booking.reference && <ReportForm reference={booking.reference} onDone={() => setReporting(null)} />}
      </article>;
    })}</div> : <div className="kofi-empty" style={{ marginTop: 24 }}><CalendarDays size={27} /><h3>Aucune réservation pour le moment</h3><p>Votre prochain rendez-vous peut commencer par une recherche.</p><Link href="/recherche" className="kofi-button primary small">Explorer les professionnels</Link></div>}
    {!!myReports.data?.length && <section style={{ marginTop: 32 }}>
      <h2 style={{ fontSize: 20 }}>Mes signalements</h2>
      <div className="kofi-results">{myReports.data.map((report) => <article className="kofi-panel" key={report.id}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}><strong>{REPORT_CATEGORIES[report.category]}</strong><span className={`kofi-status ${report.status === "resolved" ? "green" : report.status === "rejected" ? "gray" : "orange"}`}>{REPORT_STATUS[report.status]}</span></div>
        <p style={{ color: "#5d6779", fontSize: 13, margin: "7px 0" }}>{report.booking ? `Réservation ${report.booking.reference} · ` : ""}{new Date(report.createdAt).toLocaleDateString("fr-FR", { timeZone: "Africa/Douala" })} · « {report.message} »</p>
        {report.resolutionNote && <p style={{ fontSize: 13, margin: 0 }}><strong>Réponse de KOFI :</strong> {report.resolutionNote}</p>}
      </article>)}</div>
    </section>}
  </main>;
}

const REPORT_CATEGORIES = { no_show_pro: "Professionnel absent", quality: "Qualité de la prestation", price: "Prix différent de l’annonce", behavior: "Comportement", safety: "Sécurité", other: "Autre" } as const;
const REPORT_STATUS = { open: "Envoyé", in_progress: "En cours de traitement", resolved: "Résolu", rejected: "Classé" } as const;

function ReportForm({ reference, onDone }: { reference: string; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [category, setCategory] = useState<keyof typeof REPORT_CATEGORIES>("quality");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const create = trpc.reports.create.useMutation({ onSuccess: () => { utils.reports.mine.invalidate(); onDone(); }, onError: (requestError) => setError(bookingErrorMessage(requestError.message)) });
  const submit = (event: FormEvent) => { event.preventDefault(); setError(""); if (message.trim().length < 10) { setError(bookingErrorMessage("REPORT_INVALID")); return; } create.mutate({ bookingReference: reference, category, message: message.trim() }); };
  return <form onSubmit={submit} className="kofi-form-grid" style={{ gridColumn: "1 / -1", borderTop: "1px solid #e8e5df", paddingTop: 14 }}>
    {error && <div className="kofi-alert full" role="alert" style={{ gridColumn: "1 / -1" }}><X size={16} /> {error}</div>}
    <div className="kofi-form-group"><label htmlFor={`cat-${reference}`}>Type de problème</label><select id={`cat-${reference}`} value={category} onChange={(event) => setCategory(event.target.value as keyof typeof REPORT_CATEGORIES)}>{Object.entries(REPORT_CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    <div className="kofi-form-group full"><label htmlFor={`msg-${reference}`}>Que s’est-il passé ?</label><textarea id={`msg-${reference}`} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} placeholder="Décrivez la situation : l’équipe KOFI vous répondra ici." /></div>
    <div style={{ display: "flex", gap: 8, gridColumn: "1 / -1" }}><button className="kofi-button primary small" type="submit" disabled={create.isPending}>{create.isPending ? "Envoi…" : "Envoyer le signalement"}</button><button className="kofi-button outline small" type="button" onClick={onDone}>Annuler</button></div>
  </form>;
}

const APP_LOGIN_KEY = "kofi-app-login";

/** Connexion de l’application mobile : l’app ouvre cette page, l’utilisateur confirme, l’app reçoit un code à usage unique. */
function AppLoginPage() {
  const auth = useAuth();
  const params = new URLSearchParams(useSearch());
  const challenge = params.get("challenge") ?? "";
  const redirect = params.get("redirect") ?? "kofi://auth";
  const valid = /^[A-Za-z0-9_-]{43}$/.test(challenge) && /^(kofi|exp):\/\//.test(redirect);
  const createCode = trpc.mobile.createLoginCode.useMutation({ onSuccess: (result) => { try { sessionStorage.removeItem(APP_LOGIN_KEY); } catch { /* ignoré */ } window.location.href = result.redirectUrl; } });
  const box = (children: ReactNode) => <main className="kofi-container kofi-page"><div className="kofi-success"><div className="success-icon"><Smartphone size={28} /></div><span className="kofi-eyebrow">Application KOFI</span>{children}</div></main>;
  if (!valid) return box(<><h1>Lien incomplet</h1><p>Rouvrez la connexion depuis l’application KOFI.</p></>);
  if (auth.loading) return box(<LoadingBlock label="Vérification de votre session…" />);
  if (!auth.isAuthenticated) return box(<><h1>Connectez-vous pour continuer</h1><p>Après la connexion, vous reviendrez ici pour ouvrir l’application.</p><button className="kofi-button primary" onClick={() => { try { sessionStorage.setItem(APP_LOGIN_KEY, `/connexion-app?${params.toString()}`); } catch { /* ignoré */ } safeLogin(); }}><LogIn size={16} /> Se connecter</button></>);
  return box(<><h1>Connecter l’application</h1><p>L’application KOFI de ce téléphone pourra réserver et suivre vos rendez-vous au nom de <strong>{auth.user?.name || "votre compte"}</strong>.</p>
    {createCode.error && <div className="kofi-alert" role="alert"><X size={16} /> La connexion a échoué. Rouvrez-la depuis l’application.</div>}
    <button className="kofi-button primary" disabled={createCode.isPending} onClick={() => createCode.mutate({ challenge, redirect })}>{createCode.isPending ? "Ouverture…" : "Ouvrir l’application KOFI"}</button>
    <p className="kofi-note" style={{ justifyContent: "center" }}><ShieldCheck size={15} /> Le code transmis ne sert qu’une fois et expire au bout de 5 minutes.</p></>);
}

const AUTH_ERRORS: Record<string, string> = {
  INVALID_CREDENTIALS: "E-mail ou mot de passe incorrect.",
  EMAIL_TAKEN: "Un compte existe déjà avec cet e-mail. Connectez-vous plutôt.",
  PASSWORD_WEAK: "Le mot de passe doit contenir au moins 8 caractères.",
  AUTH_RATE_LIMIT: "Trop d’essais. Patientez 15 minutes avant de réessayer.",
  ACCOUNT_SUSPENDED: "Ce compte est suspendu. Contactez l’équipe KOFI.",
};

function authErrorMessage(error: { message: string; data?: { code?: string } | null } | null) {
  if (!error) return null;
  if (AUTH_ERRORS[error.message]) return AUTH_ERRORS[error.message];
  if (error.data?.code === "BAD_REQUEST") return "Vérifiez les champs : nom (2 caractères min.), e-mail valide, mot de passe de 8 caractères min.";
  return "La connexion a échoué. Réessayez dans un instant.";
}

/** Chemin interne où revenir après connexion (jamais un autre site). */
function loginRedirectTarget() {
  const target = new URLSearchParams(window.location.search).get("redirect");
  return target && target.startsWith("/") && !target.startsWith("//") && !target.startsWith("/connexion") ? target : "/";
}

const ACCOUNT_INTROS: Record<AccountKind, string> = {
  guest: "",
  client: "Retrouvez vos rendez-vous, vos salons favoris, vos points de fidélité et vos cartes cadeaux.",
  pro: "Gérez vos demandes, votre agenda, vos prestations et votre équipe depuis votre tableau de bord.",
  staff: "Vous êtes connecté avec un compte de l’équipe KOFI.",
  superadmin: "Vous avez tous les droits sur la plateforme.",
};

function LoginPage() {
  const auth = useAuth();
  const account = useAccountKind();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const onSuccess = async (result: { success: true; home?: string | null }) => { setPassword(""); await utils.auth.me.invalidate(); setLocation(result?.home ?? loginRedirectTarget()); };
  const login = trpc.auth.login.useMutation({ onSuccess });
  const register = trpc.auth.register.useMutation({ onSuccess });
  const pending = login.isPending || register.isPending;
  const error = authErrorMessage(mode === "login" ? login.error : register.error);
  const manusConfigured = Boolean(window.__MANUS_CONFIG__?.oauthPortalUrl && window.__MANUS_CONFIG__?.projectId);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === "login") login.mutate({ email, password });
    else register.mutate({ name, email, password });
  };
  const switchMode = (next: "login" | "register") => { setMode(next); login.reset(); register.reset(); };

  if (auth.isAuthenticated) return <main className="kofi-container kofi-page"><div className="kofi-success"><div className="success-icon"><UserRound size={28} /></div><span className="kofi-eyebrow">{ACCOUNT_LABELS[account.kind]}</span><h1>{`Bonjour ${auth.user?.name || ""}`}</h1><p>{ACCOUNT_INTROS[account.kind]}</p>
    <div className="kofi-account-links">
      {account.kind === "client" && <>
        <Link href="/mes-reservations"><CalendarDays size={18} /><span>Mes réservations</span></Link>
        <Link href="/favoris"><Star size={18} /><span>Mes favoris</span></Link>
        <Link href="/fidelite"><Sparkles size={18} /><span>Ma fidélité</span></Link>
        <Link href="/cartes-cadeaux"><WalletCards size={18} /><span>Cartes cadeaux</span></Link>
      </>}
      {account.kind === "pro" && <>
        <Link href="/professionnel"><CalendarDays size={18} /><span>Mon tableau de bord</span></Link>
        {account.proSlug && <Link href={`/pro/${account.proSlug}`}><Store size={18} /><span>Mon profil public</span></Link>}
        <Link href="/notifications"><Bell size={18} /><span>Notifications</span></Link>
        <Link href="/aide"><ShieldCheck size={18} /><span>Aide</span></Link>
      </>}
      {account.kind === "staff" && <>
        <Link href="/admin"><ShieldCheck size={18} /><span>Administration</span></Link>
        <Link href="/notifications"><Bell size={18} /><span>Notifications</span></Link>
      </>}
      {account.kind === "superadmin" && <>
        <Link href="/superadmin"><Crown size={18} /><span>Super-administration</span></Link>
        <Link href="/admin"><ShieldCheck size={18} /><span>Back-office</span></Link>
      </>}
    </div>
    <div className="kofi-hero-actions" style={{ justifyContent: "center" }}><button className="kofi-button outline" onClick={() => auth.logout()}>Se déconnecter</button></div></div></main>;

  return <main className="kofi-container kofi-page"><div className="kofi-success" style={{ maxWidth: 440 }}>
    <div className="success-icon"><UserRound size={28} /></div>
    <span className="kofi-eyebrow">Votre espace KOFI</span>
    <h1>{mode === "login" ? "Connexion" : "Créer un compte"}</h1>
    <p>{mode === "login" ? "Retrouvez vos réservations et votre espace professionnel." : "Quelques secondes suffisent pour réserver et suivre vos rendez-vous."}</p>
    {auth.error && <div className="kofi-alert" style={{ textAlign: "left" }}><X size={16} /> Impossible de vérifier la session. Réessayez dans un instant.</div>}
    <form onSubmit={submit} style={{ display: "grid", gap: 14, textAlign: "left", marginTop: 22 }} noValidate>
      {mode === "register" && <div className="kofi-form-group"><label htmlFor="auth-name">Nom complet</label><input id="auth-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required minLength={2} maxLength={120} /></div>}
      <div className="kofi-form-group"><label htmlFor="auth-email">E-mail</label><input id="auth-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" required maxLength={320} /></div>
      <div className="kofi-form-group"><label htmlFor="auth-password">Mot de passe{mode === "register" ? " (8 caractères min.)" : ""}</label><input id="auth-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 8 : 1} maxLength={128} /></div>
      {error && <div className="kofi-alert" role="alert" style={{ marginBottom: 0 }}><X size={16} /> {error}</div>}
      <button className="kofi-button primary" type="submit" disabled={pending}><LogIn size={16} /> {pending ? "Patientez…" : mode === "login" ? "Se connecter" : "Créer mon compte"}</button>
    </form>
    <p style={{ marginTop: 18 }}>{mode === "login" ? <>Pas encore de compte ? <button type="button" className="kofi-link-button" onClick={() => switchMode("register")}>Créer un compte</button></> : <>Déjà inscrit ? <button type="button" className="kofi-link-button" onClick={() => switchMode("login")}>Se connecter</button></>}</p>
    {manusConfigured && <button type="button" className="kofi-button outline" onClick={() => safeLogin()}>Continuer avec Manus</button>}
    <p className="kofi-note" style={{ justifyContent: "center" }}><ShieldCheck size={15} /> Mot de passe chiffré, aucune donnée bancaire stockée ici.</p>
  </div></main>;
}

function EmptyPage({ title, description, action, onAction }: { title: string; description: string; action?: string; onAction?: () => void }) {
  return <main className="kofi-container kofi-page"><div className="kofi-empty" style={{ margin: "90px auto", maxWidth: 520 }}><Scissors size={28} /><h2>{title}</h2><p>{description}</p>{action && onAction && <button className="kofi-button primary small" onClick={onAction}>{action}</button>}</div></main>;
}

function LegalPage({ privacy = false }: { privacy?: boolean }) {
  return <main className="kofi-container kofi-page"><h1 className="kofi-page-title">{privacy ? "Politique de confidentialité" : "Mentions légales"}</h1><div className="kofi-panel" style={{ maxWidth: 800, lineHeight: 1.7, color: "#556073" }}><p><strong>KOFI est en phase de test.</strong> Cette page constitue une structure de contenu à faire valider juridiquement avant toute ouverture au public.</p><h3>Données et usage</h3><p>KOFI est conçu pour traiter les coordonnées nécessaires à une demande de réservation, le profil professionnel, les disponibilités, l’historique de statut et les preuves d’action utiles au support. Les données ne doivent être conservées que pour une finalité documentée.</p><h3>Services externes</h3><p>Le paiement, les notifications, la cartographie et le stockage d’images seront activés séparément après configuration des prestataires et validation des conditions applicables.</p><h3>Contact</h3><p>Une adresse de contact opérationnelle et les informations de l’éditeur devront être ajoutées avant publication commerciale.</p></div></main>;
}

export default function KofiApp() {
  const [location, setLocation] = useLocation();
  const [draft, setDraft] = useState<BookingDraft | null>(readDraft);
  useEffect(() => { window.scrollTo(0, 0); }, [location]);
  // Retour de connexion lancé depuis l’application mobile : on reprend la page /connexion-app.
  const auth = useAuth();
  useEffect(() => {
    if (!auth.isAuthenticated) return;
    try {
      const pending = sessionStorage.getItem(APP_LOGIN_KEY);
      if (pending && !location.startsWith("/connexion-app")) setLocation(pending);
    } catch { /* stockage indisponible */ }
  }, [auth.isAuthenticated, location, setLocation]);
  const page = location.split("?")[0];
  let content: ReactNode;
  if (page === "/") content = <HomePage />;
  else if (page === "/recherche") content = <SearchPage />;
  else if (page.startsWith("/pro/")) content = <ProfessionalPage slug={decodeURIComponent(page.replace("/pro/", ""))} onBook={(next) => { setDraft(next); writeDraft(next); setLocation("/reservation"); }} />;
  else if (page === "/reservation") content = <BookingPage draft={draft} onCreated={(reference) => { setDraft(null); writeDraft(null); setLocation(`/reservation/confirmee?ref=${encodeURIComponent(reference)}`); }} />;
  else if (page === "/reservation/confirmee") content = <ConfirmationPage />;
  else if (page === "/mes-reservations") content = <ReservationsPage />;
  else if (page === "/professionnel") content = <Suspense fallback={<main className="kofi-container kofi-page"><LoadingBlock /></main>}><ProPage /></Suspense>;
  else if (page === "/admin") content = <Suspense fallback={<main className="kofi-container kofi-page"><LoadingBlock /></main>}><AdminPage /></Suspense>;
  else if (page === "/superadmin") content = <Suspense fallback={<main className="kofi-container kofi-page"><LoadingBlock /></main>}><SuperAdminPage /></Suspense>;
  else if (page === "/connexion") content = <LoginPage />;
  else if (page === "/connexion-app") content = <AppLoginPage />;
  else if (page === "/notifications") content = <NotificationsPage />;
  else if (page === "/favoris") content = <FavoritesPage renderCard={(professional) => <ProfessionalCard professional={professional} />} />;
  else if (page === "/fidelite") content = <LoyaltyPage />;
  else if (page === "/cartes-cadeaux") content = <GiftCardsPage />;
  else if (page === "/aide") content = <HelpPage />;
  else if (page === "/confidentialite") content = <LegalPage privacy />;
  else if (page === "/mentions-legales") content = <LegalPage />;
  else content = <EmptyPage title="Page introuvable" description="Cette page n’existe pas. Revenez à l’accueil pour poursuivre votre parcours." action="Retour à l’accueil" onAction={() => setLocation("/")} />;
  return <div className="kofi-shell"><Header /><OfflineBanner />{content}<Footer /></div>;
}
