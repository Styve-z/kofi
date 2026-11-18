import { keepPreviousData } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { BadgeCheck, Ban, CalendarDays, Check, ChevronDown, ChevronUp, Flag, LayoutDashboard, Phone, RefreshCcw, ShieldCheck, Star, Tag, Image as ImageIcon, Wallet, UserRound, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Empty, Failed, Loading, Pills, ReasonForm, SearchField, useDebounced } from "./shared";
import type { AppRouter } from "../../../server/routers";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { assignableRoles, can as roleCan, canManageAccount, isStaff, ROLE_LABELS, type Permission, type Role } from "@shared/permissions";
import { doualaDay, doualaToIso, addDays, formatDayLabel, formatDuration, formatSlot, formatXaf, modeLabel, STATUS_LABELS, type BookingStatus } from "@/lib/format";

type Outputs = inferRouterOutputs<AppRouter>["admin"];
type AdminBooking = Outputs["bookings"]["list"]["items"][number];
type AdminPro = Outputs["professionals"]["list"]["items"][number];
type AdminUser = Outputs["users"]["list"][number];
type ProStatus = AdminPro["status"];
type Tab = "overview" | "pros" | "bookings" | "users" | "reports" | "reviews" | "photos" | "payments" | "promos" | "audit";
type StaffReview = Outputs["reviews"]["list"][number];
type AdminReport = Outputs["reports"]["list"]["items"][number];
type ReportStatus = AdminReport["status"];
type AdminPromo = Outputs["promotions"]["list"][number];
type Can = (permission: Permission) => boolean;

const ERRORS: Record<string, string> = {
  REASON_REQUIRED: "Indiquez un motif (3 caractères minimum).",
  INVALID_TRANSITION: "Cette action n’est plus possible : le statut a changé. La liste a été actualisée.",
  CANNOT_SUSPEND_SELF: "Vous ne pouvez pas suspendre votre propre compte.",
  BOOKING_NOT_FOUND: "Réservation introuvable.",
  PROFESSIONAL_NOT_FOUND: "Professionnel introuvable.",
  USER_NOT_FOUND: "Utilisateur introuvable.",
  FORBIDDEN: "Vous n’avez pas les droits nécessaires.",
  CANNOT_CHANGE_OWN_ROLE: "Vous ne pouvez pas modifier votre propre rôle.",
  ROLE_NOT_ALLOWED: "Seul le super-administrateur peut attribuer ce rôle.",
  ACCOUNT_PROTECTED: "Ce compte est protégé : seul le super-administrateur peut le modifier.",
  PROMO_INPUT_INVALID: "Vérifiez le code (3 à 20 lettres ou chiffres), le libellé, la remise (1 à 90 % ou 100 à 100 000 FCFA) et les dates.",
  PROMO_CODE_TAKEN: "Ce code existe déjà.",
  REPORT_NOT_FOUND: "Signalement introuvable.",
  REVIEW_NOT_FOUND: "Avis introuvable.",
  PORTFOLIO_NOT_FOUND: "Photo introuvable.",
};
const errorText = (message: string) => ERRORS[message] ?? (message.includes("permission") ? ERRORS.FORBIDDEN : "L’action n’a pas pu être enregistrée. Réessayez.");

const PRO_STATUS: Record<ProStatus, { label: string; tone: string }> = {
  pending: { label: "En attente", tone: "orange" },
  verified: { label: "Vérifié", tone: "green" },
  suspended: { label: "Suspendu", tone: "red" },
  refused: { label: "Refusé", tone: "gray" },
};
const TRANSITION_BUTTONS: Record<BookingStatus, { label: string; style: "primary" | "outline" | "danger"; needsReason?: boolean }> = {
  confirmed: { label: "Confirmer", style: "primary" },
  completed: { label: "Marquer terminée", style: "primary" },
  no_show: { label: "Client absent", style: "outline" },
  refused: { label: "Refuser", style: "danger", needsReason: true },
  cancelled: { label: "Annuler (litige)", style: "danger", needsReason: true },
  pending: { label: "Remettre en attente", style: "outline" },
};
const REASONS = {
  refuse: ["Pièces incomplètes", "Photos non conformes", "Activité hors périmètre", "Doublon de compte"],
  suspend: ["Rendez-vous non honorés", "Signalements de clients", "Comportement inapproprié", "Fraude suspectée"],
  booking: ["Client injoignable", "Professionnel indisponible", "Litige sur le tarif", "Demande du client"],
};

const shortDate = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Africa/Douala", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// ---------------------------------------------------------------------------

function OverviewTab({ go }: { go: (tab: Tab) => void }) {
  const overview = trpc.admin.overview.useQuery(undefined, { refetchInterval: 60_000 });
  if (overview.isLoading) return <Loading />;
  if (overview.error || !overview.data) return <Failed onRetry={() => overview.refetch()} />;
  const data = overview.data;
  const max = Math.max(1, ...data.perDay.map((day) => day.count));
  const kpis = [
    { label: "Rendez-vous aujourd’hui", value: String(data.bookingsToday), hint: `${data.bookingsTodayPending} en attente de confirmation` },
    { label: "Taux de confirmation (7 j)", value: data.confirmationRate === null ? "—" : `${data.confirmationRate} %`, hint: `${data.keptCount} sur ${data.decidedCount} demandes traitées` },
    { label: "Volume réservé (7 j)", value: formatXaf(data.bookedVolumeXaf), hint: "Confirmées et terminées · hors paiement" },
    { label: "Annulations (7 j)", value: String(data.cancellations), hint: `${data.noShows} client(s) absent(s)` },
    { label: "Professionnels à valider", value: String(data.professionalsPending), hint: "Demandes d’inscription", action: data.professionalsPending ? () => go("pros") : undefined },
    { label: "Signalements ouverts", value: String(data.reportsOpen), hint: "Envoyés ou en cours de traitement", action: data.reportsOpen ? () => go("reports") : undefined },
    { label: "Utilisateurs actifs", value: String(data.usersActive), hint: `${data.newUsersWeek} nouveau(x) en 7 j · ${data.usersSuspended} suspendu(s)` },
  ];
  return <div className="kofi-adm-stack">
    <p className="kofi-adm-sub">Du {formatDayLabel(data.week.from)} au {formatDayLabel(data.week.to).toLowerCase()} · heure de Douala · actualisé chaque minute</p>
    <div className="kofi-adm-kpis">{kpis.map((kpi) => <div className="kofi-adm-card" key={kpi.label}><span className="kofi-adm-label">{kpi.label}</span><strong className="kofi-adm-value">{kpi.value}</strong><span className="kofi-adm-hint">{kpi.hint}</span>{kpi.action && <button className="kofi-button outline small" onClick={kpi.action}>Ouvrir</button>}</div>)}</div>
    <div className="kofi-adm-two">
      <section className="kofi-adm-card">
        <h2>Rendez-vous par jour</h2>
        <p className="kofi-adm-hint">Toutes demandes confondues, y compris annulées</p>
        <div className="kofi-adm-chart" role="img" aria-label={`Rendez-vous par jour : ${data.perDay.map((day) => `${formatDayLabel(day.day)} ${day.count}`).join(", ")}`}>
          {data.perDay.map((day) => <div key={day.day} className="kofi-adm-bar" aria-hidden="true"><span>{day.count}</span><i style={{ height: `${Math.max(4, Math.round((day.count / max) * 130))}px`, background: day.day === data.today ? "#b8733f" : "#1c2d4f" }} /><small>{new Date(`${day.day}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", weekday: "short", day: "numeric" })}</small></div>)}
        </div>
      </section>
      <section className="kofi-adm-card">
        <h2>Professionnels les plus réservés</h2>
        <p className="kofi-adm-hint">Sur 7 jours, hors annulations</p>
        {data.topProfessionals.length ? <ol className="kofi-adm-top">{data.topProfessionals.map((pro, index) => <li key={pro.slug}><span className="kofi-adm-rank">{index + 1}</span><div><strong>{pro.name}</strong><small>{pro.city}</small></div><div className="kofi-adm-right"><strong>{pro.count} rdv</strong><small>{formatXaf(pro.volumeXaf)}</small></div></li>)}</ol> : <Empty>Aucun rendez-vous sur la période.</Empty>}
      </section>
    </div>
    <section className="kofi-adm-card">
      <h2>À traiter</h2>
      <div className="kofi-adm-actions"><button className="kofi-button outline small" onClick={() => go("bookings")}>{data.bookingsPendingUpcoming} réservation(s) à venir en attente</button><button className="kofi-button outline small" onClick={() => go("pros")}>{data.professionalsPending} professionnel(s) à valider</button><button className="kofi-button outline small" onClick={() => go("reports")}>{data.reportsOpen} signalement(s) ouvert(s)</button><button className="kofi-button outline small" onClick={() => go("audit")}>Dernières actions</button></div>
    </section>
  </div>;
}

function ProsTab({ notify, can }: { notify: (message: string, isError?: boolean) => void; can: Can }) {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<ProStatus | "all">("pending");
  const [query, setQuery] = useState("");
  const [reasonFor, setReasonFor] = useState<{ slug: string; action: "refuse" | "suspend" } | null>(null);
  const debounced = useDebounced(query);
  const list = trpc.admin.professionals.list.useQuery({ status: status === "all" ? undefined : status, query: debounced || undefined }, { placeholderData: keepPreviousData });
  const mutation = trpc.admin.professionals.setStatus.useMutation({
    onSuccess: () => { setReasonFor(null); utils.admin.invalidate(); },
    onError: (error) => { notify(errorText(error.message), true); if (error.message === "INVALID_TRANSITION") utils.admin.professionals.invalidate(); },
  });
  const act = (pro: AdminPro, action: "validate" | "refuse" | "suspend" | "reactivate", reason?: string) => mutation.mutate({ slug: pro.slug, action, reason }, {
    onSuccess: () => notify({ validate: `${pro.name} est validé(e) : le badge « Vérifié » est visible.`, refuse: `Inscription de ${pro.name} refusée.`, suspend: `${pro.name} est suspendu(e) et n’apparaît plus dans la recherche.`, reactivate: `${pro.name} est réactivé(e).` }[action]),
  });
  const counts = list.data?.counts;
  return <div className="kofi-adm-stack">
    <p className="kofi-adm-sub">Validez les inscriptions avant que le badge « Vérifié » n’apparaisse aux clients. Les profils suspendus ou refusés sont masqués de la recherche.</p>
    <SearchField value={query} onChange={setQuery} placeholder="Nom, salon, ville ou quartier" />
    <Pills label="Filtrer par statut" value={status} onChange={setStatus} options={[{ value: "pending", label: "En attente", count: counts?.pending }, { value: "verified", label: "Vérifiés", count: counts?.verified }, { value: "suspended", label: "Suspendus", count: counts?.suspended }, { value: "refused", label: "Refusés", count: counts?.refused }, { value: "all", label: "Tous" }]} />
    {list.isLoading ? <Loading /> : list.error ? <Failed onRetry={() => list.refetch()} /> : !list.data?.items.length ? <Empty>Aucun professionnel dans cette catégorie.</Empty> : <div className="kofi-adm-grid">{list.data.items.map((pro) => {
      const badge = PRO_STATUS[pro.status];
      const asking = reasonFor?.slug === pro.slug ? reasonFor.action : null;
      return <article className="kofi-adm-card" key={pro.slug}>
        <div className="kofi-adm-row"><div><h3>{pro.name}</h3><small>{pro.salon} · {pro.city}{pro.neighborhood ? `, ${pro.neighborhood}` : ""}</small></div><span className={`kofi-adm-badge ${badge.tone}`}>{badge.label}</span></div>
        <p className="kofi-adm-hint">{modeLabel(pro.mode)} · {pro.servicesCount} prestation(s) · {pro.bookingsCount} réservation(s) · inscrit le {new Date(pro.createdAt).toLocaleDateString("fr-FR", { timeZone: "Africa/Douala" })}</p>
        {pro.servicesCount === 0 && pro.status === "pending" && <p className="kofi-adm-warn">Aucune prestation active : le profil n’apparaîtra pas dans la recherche.</p>}
        {pro.note && <p className="kofi-adm-note">Motif : {pro.note}</p>}
        <a className="kofi-link" href={`/pro/${pro.slug}`} target="_blank" rel="noreferrer">Voir le profil public</a>
        {!can("professionals.manage") ? null : asking ? <ReasonForm title={asking === "refuse" ? "Motif du refus" : "Motif de la suspension"} suggestions={REASONS[asking]} confirmLabel={asking === "refuse" ? "Refuser l’inscription" : "Suspendre"} busy={mutation.isPending} onCancel={() => setReasonFor(null)} onConfirm={(reason) => act(pro, asking, reason)} /> : <div className="kofi-adm-actions">
          {(pro.status === "pending" || pro.status === "refused") && <button className="kofi-button primary small" disabled={mutation.isPending} onClick={() => act(pro, "validate")}><BadgeCheck size={14} /> Valider</button>}
          {pro.status === "pending" && <button className="kofi-button kofi-danger small" disabled={mutation.isPending} onClick={() => setReasonFor({ slug: pro.slug, action: "refuse" })}><X size={14} /> Refuser</button>}
          {(pro.status === "verified" || pro.status === "pending") && <button className="kofi-button kofi-danger small" disabled={mutation.isPending} onClick={() => setReasonFor({ slug: pro.slug, action: "suspend" })}><Ban size={14} /> Suspendre</button>}
          {pro.status === "suspended" && <button className="kofi-button outline small" disabled={mutation.isPending} onClick={() => act(pro, "reactivate")}><RefreshCcw size={14} /> Réactiver</button>}
        </div>}
      </article>;
    })}</div>}
  </div>;
}

function BookingDetail({ booking, notify, can }: { booking: AdminBooking; notify: (message: string, isError?: boolean) => void; can: Can }) {
  const utils = trpc.useUtils();
  const [asking, setAsking] = useState<BookingStatus | null>(null);
  const mutation = trpc.admin.bookings.transition.useMutation({
    onSuccess: (result) => { setAsking(null); utils.admin.invalidate(); notify(`${result.reference} : ${STATUS_LABELS[result.status].label.toLowerCase()}.`); },
    onError: (error) => { notify(errorText(error.message), true); if (error.message === "INVALID_TRANSITION") utils.admin.bookings.invalidate(); },
  });
  const run = (to: BookingStatus, note?: string) => mutation.mutate({ reference: booking.reference, to, note });
  return <div className="kofi-adm-detail">
    <dl className="kofi-adm-facts">
      <div><dt>Téléphone client</dt><dd><a className="kofi-link" href={`tel:${booking.customerPhone}`}><Phone size={13} /> {booking.customerPhone}</a></dd></div>
      <div><dt>Mode</dt><dd>{booking.mode === "salon" ? "En salon" : "À domicile"}</dd></div>
      <div><dt>Durée</dt><dd>{formatDuration(booking.durationMinutes)}</dd></div>
      <div><dt>Montant</dt><dd>{formatXaf(booking.totalXaf)}{booking.discountXaf > 0 && ` (remise ${booking.promoCode ?? ""} −${formatXaf(booking.discountXaf)})`}</dd></div>
      <div><dt>Paiement</dt><dd>Non connecté</dd></div>
      {booking.address && <div className="wide"><dt>Adresse</dt><dd>{booking.address}</dd></div>}
      {booking.notes && <div className="wide"><dt>Précision du client</dt><dd>{booking.notes}</dd></div>}
      <div className="wide"><dt>Prestations</dt><dd>{booking.items.map((item) => `${item.name} (${formatXaf(item.priceXaf)})`).join(" + ")}</dd></div>
    </dl>
    <h4>Historique</h4>
    <ol className="kofi-adm-events">{booking.events.map((event, index) => <li key={index}><span>{shortDate(event.createdAt)}</span> {STATUS_LABELS[event.toStatus as BookingStatus]?.label ?? event.toStatus}{event.note ? ` — ${event.note}` : ""}</li>)}</ol>
    {!can("bookings.manage") ? <p className="kofi-adm-hint">Consultation seule pour votre rôle.</p> : asking ? <ReasonForm title={asking === "refused" ? "Motif du refus" : "Motif de l’annulation"} suggestions={REASONS.booking} confirmLabel={TRANSITION_BUTTONS[asking].label} busy={mutation.isPending} onCancel={() => setAsking(null)} onConfirm={(note) => run(asking, note)} />
      : booking.allowedTransitions.length ? <div className="kofi-adm-actions">{booking.allowedTransitions.map((to) => { const button = TRANSITION_BUTTONS[to]; return <button key={to} className={`kofi-button small ${button.style === "danger" ? "kofi-danger" : button.style}`} disabled={mutation.isPending} onClick={() => button.needsReason ? setAsking(to) : run(to)}>{button.label}</button>; })}</div>
      : <p className="kofi-adm-hint">Réservation clôturée : aucune action possible.</p>}
  </div>;
}

function BookingsTab({ notify, can }: { notify: (message: string, isError?: boolean) => void; can: Can }) {
  const [status, setStatus] = useState<BookingStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const debounced = useDebounced(query);
  const list = trpc.admin.bookings.list.useQuery({ status: status === "all" ? undefined : status, query: debounced || undefined }, { placeholderData: keepPreviousData });
  const counts = list.data?.counts;
  const option = (value: BookingStatus, label: string) => ({ value, label, count: counts?.[value] });
  return <div className="kofi-adm-stack">
    <p className="kofi-adm-sub">Touchez une réservation pour voir son historique et intervenir en cas de litige. Les 100 plus récentes par date de rendez-vous.</p>
    <SearchField value={query} onChange={setQuery} placeholder="Référence, client, téléphone ou professionnel" />
    <Pills label="Filtrer par statut" value={status} onChange={(value) => { setStatus(value); setOpen(null); }} options={[{ value: "all", label: "Toutes" }, option("pending", "En attente"), option("confirmed", "Confirmées"), option("completed", "Terminées"), option("cancelled", "Annulées"), option("refused", "Refusées"), option("no_show", "Absences")]} />
    {list.isLoading ? <Loading /> : list.error ? <Failed onRetry={() => list.refetch()} /> : !list.data?.items.length ? <Empty>Aucune réservation ne correspond.</Empty> : <div className="kofi-adm-list">{list.data.items.map((booking) => {
      const isOpen = open === booking.reference;
      const badge = STATUS_LABELS[booking.status];
      return <div key={booking.reference} className={`kofi-adm-item ${isOpen ? "is-open" : ""}`}>
        <button type="button" className="kofi-adm-itemhead" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : booking.reference)}>
          <span className="kofi-adm-itemmain"><span className="kofi-adm-ref">{booking.reference} <span className={`kofi-status ${badge.tone}`}>{badge.label}</span></span><strong>{booking.customerName} → {booking.professional.name}</strong><small>{booking.items.map((item) => item.name).join(" + ")} · {booking.professional.city}</small></span>
          <span className="kofi-adm-right"><strong>{formatSlot(booking.startsAt)}</strong><small>{formatXaf(booking.totalXaf)}</small>{isOpen ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}</span>
        </button>
        {isOpen && <BookingDetail booking={booking} notify={notify} can={can} />}
      </div>;
    })}</div>}
  </div>;
}

function UsersTab({ notify, selfId, can, actorRole }: { notify: (message: string, isError?: boolean) => void; selfId: number; can: Can; actorRole: Role }) {
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"user" | "staff" | "all">("all");
  const [asking, setAsking] = useState<number | null>(null);
  const debounced = useDebounced(query);
  const list = trpc.admin.users.list.useQuery({ query: debounced || undefined, role: role === "all" ? undefined : role }, { placeholderData: keepPreviousData });
  const mutation = trpc.admin.users.setStatus.useMutation({ onSuccess: () => { setAsking(null); utils.admin.invalidate(); }, onError: (error) => notify(errorText(error.message), true) });
  const roleMutation = trpc.admin.users.setRole.useMutation({ onSuccess: (result) => { utils.admin.invalidate(); notify(`Rôle mis à jour : ${ROLE_LABELS[result.role]}.`); }, onError: (error) => notify(errorText(error.message), true) });
  const setStatus = (user: AdminUser, status: "active" | "suspended", reason?: string) => mutation.mutate({ userId: user.id, status, reason }, { onSuccess: () => notify(status === "suspended" ? `${user.name} est suspendu(e) : plus aucune action possible avec ce compte.` : `${user.name} est réactivé(e).`) });
  return <div className="kofi-adm-stack">
    <p className="kofi-adm-sub">Un compte suspendu ne peut plus réserver ni accéder à son espace. Le téléphone affiché est le dernier saisi sur une réservation.</p>
    <SearchField value={query} onChange={setQuery} placeholder="Nom, e-mail ou téléphone" />
    <Pills label="Filtrer par rôle" value={role} onChange={setRole} options={[{ value: "all", label: "Tous" }, { value: "user", label: "Clients" }, { value: "staff", label: "Équipe KOFI" }]} />
    {list.isLoading ? <Loading /> : list.error ? <Failed onRetry={() => list.refetch()} /> : !list.data?.length ? <Empty>Aucun utilisateur trouvé.</Empty> : <div className="kofi-adm-list">{list.data.map((user) => {
      const active = user.status === "active";
      return <div className="kofi-adm-card kofi-adm-userrow" key={user.id}>
        <div className="kofi-adm-row"><div><h3>{user.name} <span className={`kofi-adm-badge ${active ? "green" : "red"}`}>{active ? "Actif" : "Suspendu"}</span></h3><small>{ROLE_LABELS[user.role as Role]}{user.email ? ` · ${user.email}` : ""}{user.lastPhone ? ` · ${user.lastPhone}` : ""}</small><small>{user.bookingsCount} réservation(s) · dernière connexion {shortDate(user.lastSignedIn)}</small></div>
          {user.id === selfId ? <span className="kofi-adm-hint">C’est vous</span> : !canManageAccount(actorRole, user.role) ? <span className="kofi-adm-hint">Compte protégé</span> : <div className="kofi-adm-actions">{can("users.roles") && <label className="kofi-adm-role"><span className="sr-only">Rôle de {user.name}</span><select value={user.role} disabled={roleMutation.isPending} onChange={(event) => { const next = event.target.value as Exclude<Role, "superadmin">; if (window.confirm(`Donner le rôle « ${ROLE_LABELS[next]} » à ${user.name} ?`)) roleMutation.mutate({ userId: user.id, role: next }); }}>{assignableRoles(actorRole).map((value) => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}</select></label>}{!can("users.suspend") || asking === user.id ? null : active ? <button className="kofi-button kofi-danger small" disabled={mutation.isPending} onClick={() => setAsking(user.id)}><Ban size={14} /> Suspendre</button> : <button className="kofi-button outline small" disabled={mutation.isPending} onClick={() => setStatus(user, "active")}><RefreshCcw size={14} /> Réactiver</button>}</div>}
        </div>
        {asking === user.id && <ReasonForm title="Motif de la suspension" suggestions={["Fraude suspectée", "Rendez-vous non honorés", "Comportement inapproprié", "Demande de l’utilisateur"]} confirmLabel="Suspendre le compte" busy={mutation.isPending} onCancel={() => setAsking(null)} onConfirm={(reason) => setStatus(user, "suspended", reason)} />}
      </div>;
    })}</div>}
  </div>;
}

function AuditTab() {
  const log = trpc.admin.audit.useQuery({ limit: 200 });
  return <div className="kofi-adm-stack">
    <p className="kofi-adm-sub">Chaque action d’un administrateur est enregistrée et ne peut être ni modifiée ni supprimée depuis KOFI.</p>
    {log.isLoading ? <Loading /> : log.error ? <Failed onRetry={() => log.refetch()} /> : !log.data?.length ? <Empty>Aucune action enregistrée pour l’instant.</Empty> : <ol className="kofi-adm-list kofi-adm-audit">{log.data.map((entry) => <li className="kofi-adm-card" key={entry.id}><div><strong>{entry.action}</strong> · {entry.target}{entry.detail && <small>Motif : {entry.detail}</small>}</div><small>{shortDate(entry.createdAt)} · {entry.actor}</small></li>)}</ol>}
  </div>;
}

const REPORT_CATEGORIES: Record<AdminReport["category"], string> = { no_show_pro: "Professionnel absent", quality: "Qualité de la prestation", price: "Prix différent de l’annonce", behavior: "Comportement", safety: "Sécurité", other: "Autre" };
const REPORT_STATUS: Record<ReportStatus, { label: string; tone: string }> = { open: { label: "Nouveau", tone: "orange" }, in_progress: { label: "En cours", tone: "orange" }, resolved: { label: "Résolu", tone: "green" }, rejected: { label: "Classé", tone: "gray" } };

function ReportsTab({ notify, can }: { notify: (message: string, isError?: boolean) => void; can: Can }) {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<ReportStatus | "all">("open");
  const [asking, setAsking] = useState<{ id: number; to: "resolved" | "rejected" } | null>(null);
  const list = trpc.admin.reports.list.useQuery({ status: status === "all" ? undefined : status }, { placeholderData: keepPreviousData });
  const mutation = trpc.admin.reports.update.useMutation({
    onSuccess: (result) => { setAsking(null); utils.admin.invalidate(); notify(`Signalement n° ${result.id} : ${REPORT_STATUS[result.status].label.toLowerCase()}.`); },
    onError: (error) => { notify(errorText(error.message), true); utils.admin.reports.invalidate(); },
  });
  const counts = list.data?.counts;
  return <div className="kofi-adm-stack">
    <p className="kofi-adm-sub">Problèmes signalés par les clients. Pour clôturer, écrivez une réponse : le client la voit dans « Mes réservations ».</p>
    <Pills label="Filtrer par statut" value={status} onChange={setStatus} options={[{ value: "open", label: "Nouveaux", count: counts?.open }, { value: "in_progress", label: "En cours", count: counts?.in_progress }, { value: "resolved", label: "Résolus", count: counts?.resolved }, { value: "rejected", label: "Classés", count: counts?.rejected }, { value: "all", label: "Tous" }]} />
    {list.isLoading ? <Loading /> : list.error ? <Failed onRetry={() => list.refetch()} /> : !list.data?.items.length ? <Empty>Aucun signalement dans cette catégorie.</Empty> : <div className="kofi-adm-list">{list.data.items.map((report) => {
      const badge = REPORT_STATUS[report.status];
      const closed = report.status === "resolved" || report.status === "rejected";
      return <article className="kofi-adm-card" key={report.id}>
        <div className="kofi-adm-row"><div><h3>{REPORT_CATEGORIES[report.category]} <span className={`kofi-adm-badge ${badge.tone}`}>{badge.label}</span></h3><small>N° {report.id} · {report.reporter} · {shortDate(report.createdAt)}{report.professional ? ` · concerne ${report.professional.name}` : ""}{report.booking ? ` · réservation ${report.booking.reference}` : ""}</small></div></div>
        <p style={{ margin: 0, whiteSpace: "pre-line" }}>« {report.message} »</p>
        {report.resolutionNote && <p className="kofi-adm-note">Réponse{report.handledBy ? ` de ${report.handledBy}` : ""} : {report.resolutionNote}</p>}
        {!can("reports.manage") ? null : asking?.id === report.id ? <ReasonForm title={asking.to === "resolved" ? "Réponse au client (résolution)" : "Réponse au client (classement)"} suggestions={asking.to === "resolved" ? ["Le professionnel a été averti.", "Rendez-vous annulé sans frais.", "Le profil a été suspendu."] : ["Informations insuffisantes.", "Hors du périmètre de KOFI.", "Doublon d’un autre signalement."]} confirmLabel={asking.to === "resolved" ? "Marquer résolu" : "Classer sans suite"} busy={mutation.isPending} onCancel={() => setAsking(null)} onConfirm={(note) => mutation.mutate({ id: report.id, status: asking.to, note })} />
          : <div className="kofi-adm-actions">
            {report.status === "open" && <button className="kofi-button primary small" disabled={mutation.isPending} onClick={() => mutation.mutate({ id: report.id, status: "in_progress" })}>Prendre en charge</button>}
            {!closed && <button className="kofi-button outline small" disabled={mutation.isPending} onClick={() => setAsking({ id: report.id, to: "resolved" })}><Check size={14} /> Résoudre</button>}
            {!closed && <button className="kofi-button kofi-danger small" disabled={mutation.isPending} onClick={() => setAsking({ id: report.id, to: "rejected" })}>Classer sans suite</button>}
            {closed && <button className="kofi-button outline small" disabled={mutation.isPending} onClick={() => mutation.mutate({ id: report.id, status: "open" })}>Rouvrir</button>}
          </div>}
      </article>;
    })}</div>}
  </div>;
}

const PROMO_STATE: Record<AdminPromo["state"], { label: string; tone: string }> = { active: { label: "Actif", tone: "green" }, scheduled: { label: "Programmé", tone: "orange" }, expired: { label: "Expiré", tone: "gray" }, exhausted: { label: "Épuisé", tone: "gray" }, disabled: { label: "Désactivé", tone: "red" } };

function PromoForm({ notify, onDone }: { notify: (message: string, isError?: boolean) => void; onDone: () => void }) {
  const utils = trpc.useUtils();
  const today = doualaDay();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState<"percentage" | "fixed">("percentage");
  const [value, setValue] = useState("10");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 30));
  const [maxUses, setMaxUses] = useState("");
  const [onePerCustomer, setOnePerCustomer] = useState(true);
  const [minSubtotal, setMinSubtotal] = useState("0");
  const create = trpc.admin.promotions.create.useMutation({ onSuccess: (result) => { utils.admin.invalidate(); notify(`Code ${result.code} créé.`); onDone(); }, onError: (error) => notify(errorText(error.message), true) });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({ code, label, discountType: type, discountValue: Number(value), startsAt: doualaToIso(from, "00:00"), endsAt: doualaToIso(to, "23:59"), maxUses: maxUses ? Number(maxUses) : null, onePerCustomer, minSubtotalXaf: Number(minSubtotal) || 0 });
  };
  const field = (text: string, input: ReactNode) => <label className="kofi-form-group"><span>{text}</span>{input}</label>;
  return <form className="kofi-adm-reason" onSubmit={submit}>
    <div className="kofi-form-grid">
      {field("Code", <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))} placeholder="BIENVENUE" maxLength={20} autoFocus />)}
      {field("Libellé (vu par le client)", <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Offre de bienvenue" maxLength={180} />)}
      {field("Type de remise", <select value={type} onChange={(event) => { setType(event.target.value as typeof type); setValue(event.target.value === "percentage" ? "10" : "1000"); }}><option value="percentage">Pourcentage</option><option value="fixed">Montant fixe (FCFA)</option></select>)}
      {field(type === "percentage" ? "Remise (%)" : "Remise (FCFA)", <input type="number" inputMode="numeric" value={value} onChange={(event) => setValue(event.target.value)} min={type === "percentage" ? 1 : 100} max={type === "percentage" ? 90 : 100000} />)}
      {field("Valable du", <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />)}
      {field("Au (inclus)", <input type="date" min={from} value={to} onChange={(event) => setTo(event.target.value)} />)}
      {field("Utilisations maximum (vide = illimité)", <input type="number" inputMode="numeric" min={1} value={maxUses} onChange={(event) => setMaxUses(event.target.value)} />)}
      {field("Montant minimum (FCFA)", <input type="number" inputMode="numeric" min={0} step={500} value={minSubtotal} onChange={(event) => setMinSubtotal(event.target.value)} />)}
    </div>
    <label className="kofi-check"><input type="checkbox" checked={onePerCustomer} onChange={(event) => setOnePerCustomer(event.target.checked)} /> Une seule utilisation par client</label>
    <div className="kofi-adm-actions"><button type="submit" className="kofi-button primary small" disabled={create.isPending || code.length < 3 || label.trim().length < 3}>{create.isPending ? "Création…" : "Créer le code"}</button><button type="button" className="kofi-button outline small" onClick={onDone}>Annuler</button></div>
  </form>;
}

function PromosTab({ notify, can }: { notify: (message: string, isError?: boolean) => void; can: Can }) {
  const utils = trpc.useUtils();
  const [creating, setCreating] = useState(false);
  const list = trpc.admin.promotions.list.useQuery();
  const toggle = trpc.admin.promotions.setEnabled.useMutation({ onSuccess: (result) => { utils.admin.invalidate(); notify(result.enabled ? "Code activé." : "Code désactivé : il n’est plus accepté."); }, onError: (error) => notify(errorText(error.message), true) });
  return <div className="kofi-adm-stack">
    <p className="kofi-adm-sub">La remise est appliquée au moment de la demande de réservation. Une réservation annulée ou refusée libère l’utilisation du code.</p>
    {can("promotions.manage") && (creating ? <PromoForm notify={notify} onDone={() => setCreating(false)} /> : <button className="kofi-button primary small" style={{ alignSelf: "flex-start" }} onClick={() => setCreating(true)}>Nouveau code promo</button>)}
    {list.isLoading ? <Loading /> : list.error ? <Failed onRetry={() => list.refetch()} /> : !list.data?.length ? <Empty>Aucun code promo pour l’instant.</Empty> : <div className="kofi-adm-grid">{list.data.map((promo) => {
      const state = PROMO_STATE[promo.state];
      return <article className="kofi-adm-card" key={promo.id}>
        <div className="kofi-adm-row"><div><h3><span className="kofi-adm-ref" style={{ fontSize: 15 }}>{promo.code}</span> <span className={`kofi-adm-badge ${state.tone}`}>{state.label}</span></h3><small>{promo.label}</small></div><strong>{promo.discountType === "percentage" ? `−${promo.discountValue} %` : `−${formatXaf(promo.discountValue)}`}</strong></div>
        <p className="kofi-adm-hint">Du {new Date(promo.startsAt).toLocaleDateString("fr-FR", { timeZone: "Africa/Douala" })} au {new Date(promo.endsAt).toLocaleDateString("fr-FR", { timeZone: "Africa/Douala" })}{promo.minSubtotalXaf ? ` · dès ${formatXaf(promo.minSubtotalXaf)}` : ""}{promo.onePerCustomer ? " · 1 fois par client" : ""}</p>
        <p className="kofi-adm-hint"><strong>{promo.uses}</strong>{promo.maxUses ? ` / ${promo.maxUses}` : ""} utilisation(s) · {formatXaf(promo.discountGivenXaf)} de remises accordées</p>
        {can("promotions.manage") && <div className="kofi-adm-actions"><button className={`kofi-button small ${promo.enabled ? "kofi-danger" : "outline"}`} disabled={toggle.isPending} onClick={() => toggle.mutate({ id: promo.id, enabled: !promo.enabled })}>{promo.enabled ? "Désactiver" : "Réactiver"}</button></div>}
      </article>;
    })}</div>}
  </div>;
}

function ReviewsTab({ notify, can }: { notify: (message: string, isError?: boolean) => void; can: Can }) {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<StaffReview["status"] | "all">("all");
  const [asking, setAsking] = useState<number | null>(null);
  const list = trpc.admin.reviews.list.useQuery({ status: status === "all" ? undefined : status }, { placeholderData: keepPreviousData });
  const mutation = trpc.admin.reviews.setStatus.useMutation({ onSuccess: (result) => { setAsking(null); utils.admin.invalidate(); notify(result.status === "hidden" ? "Avis masqué : la note du professionnel est recalculée." : "Avis réaffiché."); }, onError: (error) => notify(errorText(error.message), true) });
  return <div className="kofi-adm-stack">
    <p className="kofi-adm-sub">Avis vérifiés laissés après un rendez-vous terminé. Masquez seulement un avis injurieux, hors sujet ou contenant des données personnelles.</p>
    <Pills label="Filtrer" value={status} onChange={setStatus} options={[{ value: "all", label: "Tous" }, { value: "visible", label: "Visibles" }, { value: "hidden", label: "Masqués" }]} />
    {list.isLoading ? <Loading /> : list.error ? <Failed onRetry={() => list.refetch()} /> : !list.data?.length ? <Empty>Aucun avis.</Empty> : <div className="kofi-adm-list">{list.data.map((review) => <article className="kofi-adm-card" key={review.id}>
      <div className="kofi-adm-row"><div><h3>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)} <span className="sr-only">{review.rating} sur 5</span> {review.status === "hidden" && <span className="kofi-adm-badge gray">Masqué</span>}</h3><small>{review.author} → {review.professional?.name ?? "—"} · {shortDate(review.createdAt)}{review.bookingReference ? ` · ${review.bookingReference}` : ""}</small></div></div>
      {review.comment && <p style={{ margin: 0 }}>« {review.comment} »</p>}
      {review.proReply && <p className="kofi-adm-note">Réponse du pro : {review.proReply}</p>}
      {review.moderationNote && <p className="kofi-adm-hint">Motif de masquage : {review.moderationNote}</p>}
      {can("reviews.manage") && (asking === review.id ? <ReasonForm title="Motif du masquage" suggestions={["Propos injurieux", "Hors sujet", "Données personnelles"]} confirmLabel="Masquer l’avis" busy={mutation.isPending} onCancel={() => setAsking(null)} onConfirm={(note) => mutation.mutate({ id: review.id, status: "hidden", note })} />
        : <div className="kofi-adm-actions">{review.status === "visible" ? <button className="kofi-button kofi-danger small" onClick={() => setAsking(review.id)}>Masquer</button> : <button className="kofi-button outline small" disabled={mutation.isPending} onClick={() => mutation.mutate({ id: review.id, status: "visible" })}>Réafficher</button>}</div>)}
    </article>)}</div>}
  </div>;
}

function PhotosTab({ notify, can }: { notify: (message: string, isError?: boolean) => void; can: Can }) {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [asking, setAsking] = useState<number | null>(null);
  const list = trpc.admin.portfolio.list.useQuery({ status }, { placeholderData: keepPreviousData });
  const mutation = trpc.admin.portfolio.moderate.useMutation({ onSuccess: (result) => { setAsking(null); utils.admin.invalidate(); notify(result.status === "approved" ? "Photo publiée sur le profil." : "Photo refusée : le professionnel est prévenu."); }, onError: (error) => notify(errorText(error.message), true) });
  return <div className="kofi-adm-stack">
    <p className="kofi-adm-sub">Vérifiez que la photo montre une vraie réalisation du professionnel, sans visage d’enfant reconnaissable ni contenu inapproprié.</p>
    <Pills label="Filtrer" value={status} onChange={(value) => setStatus(value === "all" ? "pending" : value)} options={[{ value: "pending", label: "À valider", count: list.data?.pending }, { value: "approved", label: "Publiées" }, { value: "rejected", label: "Refusées" }]} />
    {list.isLoading ? <Loading /> : list.error ? <Failed onRetry={() => list.refetch()} /> : !list.data?.items.length ? <Empty>Aucune photo dans cette catégorie.</Empty> : <div className="kofi-photo-grid">{list.data.items.map((item) => <figure key={item.id} className="kofi-photo">
      <a href={item.url} target="_blank" rel="noreferrer"><img src={item.thumbUrl} alt={item.description ?? "Photo à vérifier"} loading="lazy" width={400} height={400} /></a>
      <figcaption><strong>{item.professional?.name ?? "—"}</strong>{item.description && <small>{item.description}</small>}{item.moderationNote && <small>Motif : {item.moderationNote}</small>}
        {can("portfolio.moderate") && (asking === item.id ? <ReasonForm title="Motif du refus" suggestions={["Photo floue", "Pas une réalisation", "Visage d’enfant reconnaissable", "Contenu inapproprié"]} confirmLabel="Refuser" busy={mutation.isPending} onCancel={() => setAsking(null)} onConfirm={(note) => mutation.mutate({ id: item.id, status: "rejected", note })} />
          : <div className="kofi-adm-actions">{item.status !== "approved" && <button className="kofi-button primary small" disabled={mutation.isPending} onClick={() => mutation.mutate({ id: item.id, status: "approved" })}>Publier</button>}{item.status !== "rejected" && <button className="kofi-button kofi-danger small" onClick={() => setAsking(item.id)}>Refuser</button>}</div>)}
      </figcaption>
    </figure>)}</div>}
  </div>;
}

function PaymentsTab({ notify, can }: { notify: (message: string, isError?: boolean) => void; can: Can }) {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<"pending" | "succeeded" | "failed" | "all">("all");
  const [payout, setPayout] = useState<{ slug: string; max: number } | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const list = trpc.admin.payments.list.useQuery({ status: status === "all" ? undefined : status }, { placeholderData: keepPreviousData });
  const record = trpc.admin.payments.recordPayout.useMutation({ onSuccess: () => { setPayout(null); setAmount(""); setNote(""); utils.admin.invalidate(); notify("Reversement enregistré : le professionnel est prévenu."); }, onError: (error) => notify(error.message === "PAYOUT_INVALID" ? "Montant invalide ou supérieur au solde." : errorText(error.message), true) });
  const simulate = trpc.admin.payments.simulate.useMutation({ onSuccess: (result) => { utils.admin.invalidate(); notify(result.status === "succeeded" ? "Opération confirmée (simulation)." : "Opération refusée (simulation)."); }, onError: (error) => notify(errorText(error.message), true) });
  if (list.isLoading) return <Loading />;
  if (list.error || !list.data) return <Failed onRetry={() => list.refetch()} />;
  const { settings, totals, items, balances } = list.data;
  const STATUS = { pending: ["En attente", "orange"], succeeded: ["Réussi", "green"], failed: ["Échoué", "red"] } as const;
  return <div className="kofi-adm-stack">
    {!settings.enabled ? <p className="kofi-adm-warn">Paiement en ligne désactivé (aucun prestataire configuré). Voir documentation/integrations.md.</p> : settings.testMode ? <p className="kofi-adm-warn">Mode test : aucune somme réelle n’est débitée.</p> : null}
    <p className="kofi-adm-sub">{settings.mode === "deposit" ? `Acompte de ${settings.depositPercent} %` : "Paiement complet"} après acceptation par le pro · annulation gratuite jusqu’à {settings.freeCancelHours} h avant · commission {settings.commissionPercent} %.</p>
    <div className="kofi-adm-kpis">
      <div className="kofi-adm-card"><span className="kofi-adm-label">Encaissé</span><strong className="kofi-adm-value">{formatXaf(totals.collectedXaf)}</strong></div>
      <div className="kofi-adm-card"><span className="kofi-adm-label">Remboursé</span><strong className="kofi-adm-value">{formatXaf(totals.refundedXaf)}</strong><span className="kofi-adm-hint">{totals.refundsPending} remboursement(s) en cours</span></div>
      <div className="kofi-adm-card"><span className="kofi-adm-label">Remboursements en échec</span><strong className="kofi-adm-value">{totals.refundsFailed}</strong><span className="kofi-adm-hint">À traiter avec le prestataire</span></div>
    </div>
    <section className="kofi-adm-card"><h2>Soldes des professionnels</h2>
      {!balances.length ? <p className="kofi-adm-hint">Aucun rendez-vous payé et terminé pour l’instant.</p> : balances.map((row) => <div key={row.professionalId} style={{ borderTop: "1px solid #ebe8e2", paddingTop: 8, display: "grid", gap: 6 }}>
        <div className="kofi-adm-row"><div><strong>{row.professional?.name ?? "—"}</strong><small>{row.completedPaid} rdv · encaissé {formatXaf(row.collectedXaf)} · commission {formatXaf(row.commissionXaf)} · déjà reversé {formatXaf(row.paidOutXaf)}</small></div><strong>{formatXaf(row.balanceXaf)}</strong></div>
        {can("payments.manage") && row.balanceXaf > 0 && row.professional && (payout?.slug === row.professional.slug ? <form className="kofi-adm-reason" onSubmit={(event: FormEvent) => { event.preventDefault(); record.mutate({ slug: row.professional!.slug, amountXaf: Number(amount), note: note.trim() || undefined }); }}>
          <label><span>Montant reversé (FCFA)</span><input type="number" inputMode="numeric" min={1} max={payout.max} value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus /></label>
          <label><span>Référence du virement (optionnel)</span><input value={note} onChange={(event) => setNote(event.target.value)} maxLength={255} placeholder="Ex. MoMo n° 1234567" /></label>
          <div className="kofi-adm-actions"><button className="kofi-button primary small" type="submit" disabled={record.isPending || !Number(amount)}>Enregistrer le reversement</button><button className="kofi-button outline small" type="button" onClick={() => setPayout(null)}>Annuler</button></div>
        </form> : <div className="kofi-adm-actions"><button className="kofi-button outline small" onClick={() => { setPayout({ slug: row.professional!.slug, max: row.balanceXaf }); setAmount(String(row.balanceXaf)); }}>Enregistrer un reversement</button></div>)}
      </div>)}
    </section>
    <Pills label="Filtrer les opérations" value={status} onChange={setStatus} options={[{ value: "all", label: "Toutes" }, { value: "pending", label: "En attente" }, { value: "succeeded", label: "Réussies" }, { value: "failed", label: "Échouées" }]} />
    {!items.length ? <Empty>Aucune opération.</Empty> : <div className="kofi-adm-list">{items.map((item) => <div key={item.id} className="kofi-adm-card"><div className="kofi-adm-row"><div><h3>{item.kind === "refund" ? "Remboursement" : "Paiement"} · {formatXaf(item.amountXaf)} <span className={`kofi-adm-badge ${STATUS[item.status][1]}`}>{STATUS[item.status][0]}</span></h3><small>{item.reference} · {item.customerName} → {item.professional} · {item.operator === "orange" ? "Orange Money" : item.operator === "mtn" ? "MTN MoMo" : "—"} · {shortDate(item.createdAt)}</small><small>{item.provider} · {item.providerReference}{item.failureReason ? ` · ${item.failureReason}` : ""}</small></div>
      {settings.testMode && item.status === "pending" && can("payments.manage") && <div className="kofi-adm-actions"><button className="kofi-button primary small" disabled={simulate.isPending} onClick={() => simulate.mutate({ paymentId: item.id, outcome: "succeeded" })}>Simuler : réussi</button><button className="kofi-button outline small" disabled={simulate.isPending} onClick={() => simulate.mutate({ paymentId: item.id, outcome: "failed" })}>Simuler : échec</button></div>}
    </div></div>)}</div>}
  </div>;
}

export default function AdminPage() {
  const auth = useAuth();
  const allowed = isStaff(auth.user?.role) && auth.user?.status !== "suspended";
  const [tab, setTabState] = useState<Tab>("overview");
  const [toast, setToast] = useState<{ message: string; isError: boolean } | null>(null);
  const utils = trpc.useUtils();
  // Chaque changement d’onglet recharge les données : l’équipe voit toujours l’état à jour.
  const setTab = (next: Tab) => { setTabState(next); void utils.admin.invalidate(); };
  const pending = trpc.admin.overview.useQuery(undefined, { enabled: allowed });
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 4000); return () => clearTimeout(timer); }, [toast]);
  if (auth.loading) return <main className="kofi-container kofi-page"><Loading /></main>;
  if (!auth.isAuthenticated) return <main className="kofi-container kofi-page"><div className="kofi-empty" style={{ margin: "90px auto", maxWidth: 520 }}><ShieldCheck size={28} /><h2>Accès réservé à l’équipe KOFI</h2><p>Connectez-vous avec un compte de l’équipe pour ouvrir le back-office.</p><a className="kofi-button primary small" href="/connexion">Se connecter</a></div></main>;
  if (!allowed || !auth.user) return <main className="kofi-container kofi-page"><div className="kofi-empty" style={{ margin: "90px auto", maxWidth: 520 }}><ShieldCheck size={28} /><h2>Accès refusé</h2><p>Votre compte ne fait pas partie de l’équipe KOFI.</p><a className="kofi-button primary small" href="/">Retour à l’accueil</a></div></main>;
  const role = auth.user.role as Role;
  // Les permissions affichées viennent des mêmes règles que le serveur ; chaque appel est de toute façon revérifié côté serveur.
  const can: Can = (permission) => roleCan(role, permission);
  const notify = (message: string, isError = false) => setToast({ message, isError });
  const tabs: { id: Tab; label: string; icon: ReactNode; badge?: number; permission: Permission }[] = [
    { id: "overview", label: "Vue d’ensemble", icon: <LayoutDashboard size={15} />, permission: "overview.read" },
    { id: "pros", label: "Professionnels", icon: <BadgeCheck size={15} />, badge: pending.data?.professionalsPending, permission: "professionals.read" },
    { id: "bookings", label: "Réservations", icon: <CalendarDays size={15} />, permission: "bookings.read" },
    { id: "reports", label: "Signalements", icon: <Flag size={15} />, badge: pending.data?.reportsOpen, permission: "reports.read" },
    { id: "reviews", label: "Avis", icon: <Star size={15} />, permission: "reviews.read" },
    { id: "photos", label: "Photos", icon: <ImageIcon size={15} />, permission: "portfolio.read" },
    { id: "payments", label: "Paiements", icon: <Wallet size={15} />, permission: "payments.read" },
    { id: "users", label: "Utilisateurs", icon: <Users size={15} />, permission: "users.read" },
    { id: "promos", label: "Codes promo", icon: <Tag size={15} />, permission: "promotions.read" },
    { id: "audit", label: "Journal d’audit", icon: <ShieldCheck size={15} />, permission: "audit.read" },
  ];
  const visible = tabs.filter((item) => can(item.permission));
  const current = visible.find((item) => item.id === tab) ?? visible[0];
  return <main className="kofi-container kofi-page kofi-adm">
    <div className="kofi-dashboard-head"><div><span className="kofi-eyebrow">Administration KOFI</span><h1>{current.label}</h1></div><span className="kofi-status green"><UserRound size={14} /> {auth.user.name || "Équipe"} · {ROLE_LABELS[role]}</span></div>
    <nav className="kofi-adm-tabs" aria-label="Sections de l’administration">{visible.map((item) => <button key={item.id} type="button" className={`kofi-adm-pill ${current.id === item.id ? "is-on" : ""}`} aria-current={current.id === item.id ? "page" : undefined} onClick={() => setTab(item.id)}>{item.icon} {item.label}{!!item.badge && <span className="kofi-adm-count">{item.badge}</span>}</button>)}</nav>
    <div role="status" aria-live="polite">{toast && <div className={`kofi-adm-toast ${toast.isError ? "is-error" : ""}`}>{toast.isError ? <X size={16} /> : <Check size={16} />} {toast.message}</div>}</div>
    {current.id === "overview" && <OverviewTab go={setTab} />}
    {current.id === "pros" && <ProsTab notify={notify} can={can} />}
    {current.id === "bookings" && <BookingsTab notify={notify} can={can} />}
    {current.id === "reports" && <ReportsTab notify={notify} can={can} />}
    {current.id === "users" && <UsersTab notify={notify} selfId={auth.user.id} can={can} actorRole={role} />}
    {current.id === "reviews" && <ReviewsTab notify={notify} can={can} />}
    {current.id === "photos" && <PhotosTab notify={notify} can={can} />}
    {current.id === "payments" && <PaymentsTab notify={notify} can={can} />}
    {current.id === "promos" && <PromosTab notify={notify} can={can} />}
    {current.id === "audit" && <AuditTab />}
  </main>;
}
