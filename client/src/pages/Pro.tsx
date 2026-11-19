import type { inferRouterOutputs } from "@trpc/server";
import { Camera, MapPin, Percent, Users } from "lucide-react";
import { ArrowRight, CalendarDays, Check, CheckCircle2, Circle, Clock3, ExternalLink, History, Home as HomeIcon, Image as ImageIcon, Inbox, LayoutDashboard, LogIn, Pencil, Phone, Plus, Scissors, ShieldCheck, Star, Store, Trash2, TrendingUp, UserRound, Wallet, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { AppRouter } from "../../../server/routers";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { addDays, doualaDay, doualaToIso, formatDayLabel, formatDuration, formatSlot, formatTime, formatXaf, modeLabel, STATUS_LABELS, type BookingStatus } from "@/lib/format";
import { Empty, Failed, Loading, ReasonForm } from "./shared";

type Outputs = inferRouterOutputs<AppRouter>["pro"];
type Me = NonNullable<Outputs["me"]>;
type ProBooking = Outputs["bookings"][number];
type ProService = Me["services"][number];
type Tab = "dashboard" | "requests" | "agenda" | "history" | "earnings" | "services" | "team" | "offpeak" | "hours" | "photos" | "reviews" | "profile";
type DayKey = "0" | "1" | "2" | "3" | "4" | "5" | "6";

const ERRORS: Record<string, string> = {
  REASON_REQUIRED: "Indiquez un motif (3 caractères minimum) : il est transmis au client.",
  INVALID_TRANSITION: "Cette action n’est plus possible. La liste a été actualisée.",
  PROFESSIONAL_SUSPENDED: "Votre profil est suspendu : vous ne pouvez pas traiter de demande. Contactez KOFI.",
  ALREADY_PROFESSIONAL: "Ce compte a déjà un profil professionnel.",
  PROFILE_INVALID: "Indiquez au moins votre nom et votre ville.",
  WHATSAPP_INVALID: "Numéro WhatsApp invalide : indiquez un numéro camerounais à 9 chiffres (ex. 6 90 12 34 56).",
  LOCATION_INVALID: "Position hors du Cameroun : relevez-la depuis votre salon.",
  SERVICE_INVALID: "Vérifiez la prestation : durée entre 10 min et 10 h, prix d’au moins 500 FCFA.",
  SERVICE_LIMIT: "Vous avez atteint le nombre maximum de prestations.",
  HOURS_INVALID: "Vérifiez les horaires : l’ouverture doit précéder la fermeture.",
  INVALID_TIME_RANGE: "Vérifiez les dates : la fin doit être après le début, sur 3 mois au plus.",
  BOOKING_NOT_FOUND: "Réservation introuvable.",
};
const errorText = (message: string) => ERRORS[message] ?? "L’action n’a pas pu être enregistrée. Réessayez.";

const DAYS: { key: DayKey; label: string }[] = [
  { key: "1", label: "Lundi" }, { key: "2", label: "Mardi" }, { key: "3", label: "Mercredi" }, { key: "4", label: "Jeudi" },
  { key: "5", label: "Vendredi" }, { key: "6", label: "Samedi" }, { key: "0", label: "Dimanche" },
];
const CITIES = ["Douala", "Yaoundé", "Bafoussam", "Garoua", "Bamenda", "Kribi", "Limbé", "Ngaoundéré", "Bertoua", "Ebolowa", "Maroua"];
const ACTIONS: Record<BookingStatus, { label: string; style: string; needsReason?: boolean; done: string }> = {
  confirmed: { label: "Accepter", style: "primary", done: "Rendez-vous accepté : le client voit « Confirmée »." },
  refused: { label: "Refuser", style: "kofi-danger", needsReason: true, done: "Demande refusée." },
  completed: { label: "Marquer terminé", style: "primary", done: "Rendez-vous marqué terminé." },
  no_show: { label: "Client absent", style: "outline", done: "Absence enregistrée." },
  cancelled: { label: "Annuler", style: "kofi-danger", needsReason: true, done: "Rendez-vous annulé." },
  pending: { label: "", style: "outline", done: "" },
};
const CLOSURE_LABELS = { leave: "Congé", holiday: "Jour férié", blocked: "Indisponible" } as const;

/** « Demain », « du Lun. 23 nov. au Mer. 25 nov. » pour des journées entières ; sinon dates et heures. */
function formatPeriod(startsAt: string, endsAt: string) {
  const wholeDays = formatTime(startsAt) === "00:00" && formatTime(endsAt) === "00:00";
  if (!wholeDays) return `du ${formatSlot(startsAt)} au ${formatSlot(endsAt)}`;
  const first = doualaDay(startsAt);
  const last = addDays(doualaDay(endsAt), -1);
  return first === last ? formatDayLabel(first) : `du ${formatDayLabel(first)} au ${formatDayLabel(last).toLowerCase()}`;
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="kofi-form-group"><span>{label}</span>{children}{hint && <small className="kofi-adm-hint">{hint}</small>}</label>;
}

// ---------------------------------------------------------------------------
// Profil (inscription et modification)
// ---------------------------------------------------------------------------

type ProfileValues = { displayName: string; salonName: string; city: string; neighborhood: string; mode: "salon" | "domicile" | "les deux"; bio: string; specialties: string; whatsapp: string; location: { lat: number; lng: number } | null };

/** Position du salon : relevée par le téléphone (GPS) sur place, jamais devinée. */
function LocationField({ value, onChange }: { value: ProfileValues["location"]; onChange: (location: ProfileValues["location"]) => void }) {
  const [status, setStatus] = useState("");
  const locate = () => {
    if (!("geolocation" in navigator)) { setStatus("Votre appareil ne permet pas de relever la position."); return; }
    setStatus("Recherche de la position…");
    navigator.geolocation.getCurrentPosition(
      (position) => { onChange({ lat: Number(position.coords.latitude.toFixed(6)), lng: Number(position.coords.longitude.toFixed(6)) }); setStatus("Position relevée. Pensez à enregistrer le profil."); },
      () => setStatus("Position indisponible : autorisez la localisation, ou réessayez dehors."),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };
  return <div className="kofi-form-group full">
    <span>Position du salon sur la carte (optionnel)</span>
    <div className="kofi-location-row">
      <button type="button" className="kofi-button outline small" onClick={locate}><MapPin size={14} /> {value ? "Relever à nouveau" : "Utiliser ma position actuelle"}</button>
      {value && <><a className="kofi-link" href={`https://www.openstreetmap.org/?mlat=${value.lat}&mlon=${value.lng}#map=17/${value.lat}/${value.lng}`} target="_blank" rel="noreferrer">Vérifier sur la carte</a><button type="button" className="kofi-link-button" onClick={() => { onChange(null); setStatus("Position retirée. Pensez à enregistrer le profil."); }}>Retirer</button></>}
    </div>
    <small className="kofi-adm-hint" aria-live="polite">{status || "Faites-le depuis votre salon : vos clients verront la carte et l’itinéraire. Inutile si vous travaillez uniquement à domicile."}</small>
  </div>;
}

function ProfileForm({ initial, submitLabel, busy, error, onSubmit }: { initial: ProfileValues; submitLabel: string; busy: boolean; error: string; onSubmit: (values: ProfileValues) => void }) {
  const [values, setValues] = useState(initial);
  const set = <K extends keyof ProfileValues>(key: K) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }));
  return <form className="kofi-panel" onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit(values); }} noValidate>
    {error && <div className="kofi-alert" role="alert"><X size={16} /> {error}</div>}
    <div className="kofi-form-grid">
      <Field label="Votre nom ou nom d’artiste"><input value={values.displayName} onChange={set("displayName")} placeholder="Ex. Aïcha Bello" autoComplete="name" /></Field>
      <Field label="Nom du salon (optionnel)"><input value={values.salonName} onChange={set("salonName")} placeholder="Ex. Studio Aïcha" /></Field>
      <Field label="Ville"><input value={values.city} onChange={set("city")} list="kofi-cities" placeholder="Ex. Douala" /><datalist id="kofi-cities">{CITIES.map((city) => <option key={city} value={city} />)}</datalist></Field>
      <Field label="Quartier (optionnel)"><input value={values.neighborhood} onChange={set("neighborhood")} placeholder="Ex. Bonamoussadi" /></Field>
      <Field label="Où travaillez-vous ?"><select value={values.mode} onChange={set("mode") as never}><option value="salon">En salon</option><option value="domicile">À domicile</option><option value="les deux">Salon et domicile</option></select></Field>
      <Field label="Spécialités" hint="Séparées par des virgules, 8 au plus."><input value={values.specialties} onChange={set("specialties")} placeholder="Tresses, Ongles, Maquillage" /></Field>
      <Field label="Numéro WhatsApp (optionnel)" hint="Affiché sur votre profil : vos clients pourront vous écrire en un geste."><input value={values.whatsapp} onChange={set("whatsapp")} placeholder="6 90 12 34 56" inputMode="tel" autoComplete="tel" /></Field>
      <LocationField value={values.location} onChange={(location) => setValues((current) => ({ ...current, location }))} />
      <div className="kofi-form-group full"><Field label="Présentation (optionnel)"><textarea value={values.bio} onChange={set("bio")} maxLength={1000} placeholder="Votre façon de travailler, votre expérience, ce qui vous distingue…" /></Field></div>
    </div>
    <button className="kofi-button primary" type="submit" style={{ marginTop: 16 }} disabled={busy}>{busy ? "Enregistrement…" : submitLabel}</button>
  </form>;
}

const toInput = (values: ProfileValues) => ({
  displayName: values.displayName.trim(), salonName: values.salonName.trim() || undefined, city: values.city.trim(), neighborhood: values.neighborhood.trim() || undefined,
  mode: values.mode, bio: values.bio.trim() || undefined, specialties: values.specialties.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 8),
  whatsapp: values.whatsapp.trim(), location: values.location,
});

function Onboarding() {
  const utils = trpc.useUtils();
  const [error, setError] = useState("");
  const register = trpc.pro.register.useMutation({ onSuccess: () => utils.pro.invalidate(), onError: (requestError) => setError(errorText(requestError.message)) });
  const submit = (values: ProfileValues) => {
    setError("");
    if (values.displayName.trim().length < 2 || values.city.trim().length < 2) { setError(ERRORS.PROFILE_INVALID); return; }
    register.mutate(toInput(values));
  };
  return <main className="kofi-container kofi-page">
    <span className="kofi-eyebrow">Espace professionnel</span>
    <h1 className="kofi-page-title">Recevez vos clients sans passer vos journées au téléphone.</h1>
    <p className="kofi-page-lead">Créez votre profil en deux minutes. Ajoutez ensuite vos prestations et vos horaires : l’équipe KOFI vérifie votre profil avant d’afficher le badge « Vérifié ».</p>
    <ol className="kofi-pro-steps"><li><strong>1.</strong> Votre profil</li><li><strong>2.</strong> Vos prestations et horaires</li><li><strong>3.</strong> Validation par KOFI</li></ol>
    <ProfileForm initial={{ displayName: "", salonName: "", city: "", neighborhood: "", mode: "salon", bio: "", specialties: "", whatsapp: "", location: null }} submitLabel="Créer mon profil professionnel" busy={register.isPending} error={error} onSubmit={submit} />
  </main>;
}

// ---------------------------------------------------------------------------
// Demandes et rendez-vous
// ---------------------------------------------------------------------------

function BookingCard({ booking, notify }: { booking: ProBooking; notify: (message: string, isError?: boolean) => void }) {
  const utils = trpc.useUtils();
  const [asking, setAsking] = useState<BookingStatus | null>(null);
  const mutation = trpc.pro.transition.useMutation({
    onSuccess: (result) => { setAsking(null); utils.pro.invalidate(); notify(ACTIONS[result.status].done); },
    onError: (error) => { notify(errorText(error.message), true); if (error.message === "INVALID_TRANSITION") utils.pro.invalidate(); },
  });
  const run = (to: BookingStatus, note?: string) => mutation.mutate({ reference: booking.reference, to, note });
  const status = STATUS_LABELS[booking.status];
  return <article className="kofi-adm-card">
    <div className="kofi-adm-row"><div><h3>{formatSlot(booking.startsAt)} <span className={`kofi-status ${status.tone}`}>{status.label}</span>{booking.paymentStatus === "paid" && <span className="kofi-status green">Payé {formatXaf(booking.amountPaidXaf)}</span>}{booking.paymentStatus === "unpaid" && booking.status === "confirmed" && <span className="kofi-status orange">Paiement attendu</span>}{(booking.paymentStatus === "refund_pending" || booking.paymentStatus === "refunded") && <span className="kofi-status gray">Remboursé au client</span>}</h3><small>{booking.items.map((item) => item.name).join(" + ")} · {formatDuration(booking.durationMinutes)} · {formatXaf(booking.totalXaf)}</small></div></div>
    <dl className="kofi-adm-facts">
      <div><dt>Client</dt><dd>{booking.customerName}</dd></div>
      {booking.staff && <div><dt>Avec</dt><dd>{booking.staff.name}</dd></div>}
      {booking.offpeakDiscountXaf > 0 && <div><dt>Heures creuses</dt><dd>−{booking.offpeakPercent} % (−{formatXaf(booking.offpeakDiscountXaf)})</dd></div>}
      <div><dt>Téléphone</dt><dd><a className="kofi-link" href={`tel:${booking.customerPhone}`}><Phone size={13} /> {booking.customerPhone}</a></dd></div>
      <div><dt>Lieu</dt><dd>{booking.mode === "salon" ? <><Store size={13} /> Au salon</> : <><HomeIcon size={13} /> À domicile</>}</dd></div>
      {booking.address && <div className="wide"><dt>Adresse</dt><dd>{booking.address}</dd></div>}
      {booking.notes && <div className="wide"><dt>Précision du client</dt><dd>{booking.notes}</dd></div>}
    </dl>
    {asking ? <ReasonForm title={asking === "refused" ? "Pourquoi refusez-vous ?" : "Pourquoi annulez-vous ?"} suggestions={["Indisponible à cet horaire", "Prestation non réalisable", "Trop loin pour un déplacement", "Imprévu personnel"]} confirmLabel={ACTIONS[asking].label} busy={mutation.isPending} onCancel={() => setAsking(null)} onConfirm={(note) => run(asking, note)} />
      : booking.allowedTransitions.length > 0 && <div className="kofi-adm-actions">{booking.allowedTransitions.map((to) => <button key={to} className={`kofi-button small ${ACTIONS[to].style}`} disabled={mutation.isPending} onClick={() => ACTIONS[to].needsReason ? setAsking(to) : run(to)}>{to === "confirmed" && <Check size={14} />}{ACTIONS[to].label}</button>)}</div>}
    {booking.status === "confirmed" && !booking.allowedTransitions.includes("completed") && <p className="kofi-adm-hint">« Terminé » et « Client absent » seront proposés à l’heure du rendez-vous.</p>}
  </article>;
}

function BookingsTab({ scope, notify, empty }: { scope: "pending" | "upcoming" | "past"; notify: (message: string, isError?: boolean) => void; empty: string }) {
  const list = trpc.pro.bookings.useQuery({ scope }, { refetchInterval: scope === "pending" ? 60_000 : false });
  if (list.isLoading) return <Loading />;
  if (list.error) return <Failed onRetry={() => list.refetch()} />;
  if (!list.data?.length) return <Empty>{empty}</Empty>;
  return <div className="kofi-adm-list">{list.data.map((booking) => <BookingCard key={booking.reference} booking={booking} notify={notify} />)}</div>;
}

// ---------------------------------------------------------------------------
// Prestations
// ---------------------------------------------------------------------------

function ServiceForm({ service, onDone, notify }: { service?: ProService; onDone: () => void; notify: (message: string, isError?: boolean) => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(service?.name ?? "");
  const [category, setCategory] = useState(service?.category ?? "");
  const [duration, setDuration] = useState(String(service?.durationMinutes ?? 60));
  const [preparation, setPreparation] = useState(String(service?.preparationMinutes ?? 0));
  const [price, setPrice] = useState(String(service?.priceXaf ?? ""));
  const save = trpc.pro.saveService.useMutation({ onSuccess: () => { utils.pro.invalidate(); utils.catalog.invalidate(); notify(service ? "Prestation modifiée." : "Prestation ajoutée."); onDone(); }, onError: (error) => notify(errorText(error.message), true) });
  const submit = (event: FormEvent) => { event.preventDefault(); save.mutate({ id: service?.id, name: name.trim(), category: category.trim() || undefined, durationMinutes: Number(duration), preparationMinutes: Number(preparation) || 0, priceXaf: Number(price) }); };
  return <form className="kofi-adm-reason" onSubmit={submit}>
    <div className="kofi-form-grid">
      <Field label="Nom de la prestation"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex. Tresses collées" autoFocus /></Field>
      <Field label="Catégorie"><input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Ex. Tresses" /></Field>
      <Field label="Durée (minutes)"><input type="number" inputMode="numeric" min={10} max={600} step={5} value={duration} onChange={(event) => setDuration(event.target.value)} /></Field>
      <Field label="Prix (FCFA)"><input type="number" inputMode="numeric" min={500} step={500} value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Ex. 15000" /></Field>
      <Field label="Temps de préparation (minutes)" hint="Bloqué dans l’agenda après la prestation, sans être facturé."><input type="number" inputMode="numeric" min={0} max={120} step={5} value={preparation} onChange={(event) => setPreparation(event.target.value)} /></Field>
    </div>
    <div className="kofi-adm-actions"><button className="kofi-button primary small" type="submit" disabled={save.isPending || name.trim().length < 2 || !Number(price)}>{save.isPending ? "Enregistrement…" : "Enregistrer"}</button><button className="kofi-button outline small" type="button" onClick={onDone}>Annuler</button></div>
  </form>;
}

function ServicesTab({ me, notify }: { me: Me; notify: (message: string, isError?: boolean) => void }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState<string | "new" | null>(me.services.length ? null : "new");
  const toggle = trpc.pro.setServiceActive.useMutation({ onSuccess: (result) => { utils.pro.invalidate(); utils.catalog.invalidate(); notify(result.active ? "Prestation réactivée." : "Prestation masquée : elle n’est plus réservable."); }, onError: (error) => notify(errorText(error.message), true) });
  return <div className="kofi-adm-stack">
    <p className="kofi-adm-sub">Les clients choisissent parmi vos prestations actives. Masquer une prestation la retire des réservations sans effacer l’historique.</p>
    {editing === "new" ? <ServiceForm onDone={() => setEditing(null)} notify={notify} /> : <button className="kofi-button primary small" style={{ alignSelf: "flex-start" }} onClick={() => setEditing("new")}><Plus size={14} /> Ajouter une prestation</button>}
    {me.services.length === 0 && editing !== "new" && <Empty>Aucune prestation : ajoutez-en au moins une pour apparaître dans la recherche.</Empty>}
    <div className="kofi-adm-list">{me.services.map((service) => editing === service.id ? <ServiceForm key={service.id} service={service} onDone={() => setEditing(null)} notify={notify} /> : <div key={service.id} className="kofi-adm-card" style={service.active ? undefined : { opacity: 0.7 }}>
      <div className="kofi-adm-row"><div><h3>{service.name} {!service.active && <span className="kofi-adm-badge gray">Masquée</span>}</h3><small>{formatDuration(service.durationMinutes)}{service.preparationMinutes ? ` + ${service.preparationMinutes} min de préparation` : ""}{service.category ? ` · ${service.category}` : ""}</small></div><strong>{formatXaf(service.priceXaf)}</strong></div>
      <div className="kofi-adm-actions"><button className="kofi-button outline small" onClick={() => setEditing(service.id)}><Pencil size={14} /> Modifier</button><button className="kofi-button outline small" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: service.id, active: !service.active })}>{service.active ? "Masquer" : "Réactiver"}</button></div>
    </div>)}</div>
  </div>;
}

// ---------------------------------------------------------------------------
// Équipe et heures creuses
// ---------------------------------------------------------------------------

function TeamTab({ notify }: { notify: (message: string, isError?: boolean) => void }) {
  const utils = trpc.useUtils();
  const list = trpc.pro.staff.useQuery();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const refresh = () => { void utils.pro.staff.invalidate(); void utils.catalog.invalidate(); };
  const save = trpc.pro.saveStaff.useMutation({ onSuccess: () => { refresh(); setEditing(null); notify("Équipe mise à jour."); }, onError: () => notify("Indiquez un nom de 2 caractères au moins.", true) });
  const toggle = trpc.pro.setStaffActive.useMutation({ onSuccess: (_result, input) => { refresh(); notify(input.active ? "Collaborateur réactivé." : "Collaborateur retiré : il n’est plus proposé aux clients."); } });
  const open = (id: number | "new", current?: { name: string; title: string | null }) => { setEditing(id); setName(current?.name ?? ""); setTitle(current?.title ?? ""); };
  if (list.isLoading) return <Loading />;
  if (list.error) return <Failed onRetry={() => list.refetch()} />;
  const form = <form className="kofi-adm-reason" onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate({ id: editing === "new" ? undefined : (editing as number), name: name.trim(), title: title.trim() || undefined }); }}>
    <div className="kofi-form-grid"><Field label="Prénom ou nom"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex. Paul" autoFocus maxLength={120} /></Field><Field label="Rôle (optionnel)"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex. Barbier, Coloriste" maxLength={120} /></Field></div>
    <div className="kofi-adm-actions"><button className="kofi-button primary small" type="submit" disabled={save.isPending || name.trim().length < 2}>Enregistrer</button><button className="kofi-button outline small" type="button" onClick={() => setEditing(null)}>Annuler</button></div>
  </form>;
  return <div className="kofi-adm-stack">
    <p className="kofi-adm-sub">Déclarez les personnes qui travaillent avec vous. Chacune a son propre agenda : deux clients peuvent réserver au même moment avec deux personnes différentes, et le client peut choisir avec qui. Sans équipe, votre agenda reste unique.</p>
    {editing === "new" ? form : <button className="kofi-button primary small" style={{ alignSelf: "flex-start" }} onClick={() => open("new")}><Plus size={14} /> Ajouter un collaborateur</button>}
    {!list.data?.length && editing !== "new" && <Empty>Aucun collaborateur : vous travaillez seul(e), avec un seul agenda.</Empty>}
    <div className="kofi-adm-list">{list.data?.map((member) => editing === member.id ? <div key={member.id}>{form}</div> : <div key={member.id} className="kofi-adm-card" style={member.active ? undefined : { opacity: 0.65 }}>
      <div className="kofi-adm-row"><div style={{ display: "flex", gap: 12, alignItems: "center" }}><span className="kofi-pro-avatar" style={{ width: 40, height: 40, fontSize: 15 }} aria-hidden="true">{member.name.slice(0, 1).toUpperCase()}</span><div><h3>{member.name} {!member.active && <span className="kofi-adm-badge gray">Retiré</span>}</h3><small>{member.title || "Collaborateur"}</small></div></div></div>
      <div className="kofi-adm-actions"><button className="kofi-button outline small" onClick={() => open(member.id, member)}><Pencil size={14} /> Modifier</button><button className="kofi-button outline small" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: member.id, active: !member.active })}>{member.active ? "Retirer" : "Réactiver"}</button></div>
    </div>)}</div>
  </div>;
}

const WEEKDAY_LABELS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

function OffpeakTab({ notify }: { notify: (message: string, isError?: boolean) => void }) {
  const utils = trpc.useUtils();
  const list = trpc.pro.offpeak.useQuery();
  const [dayOfWeek, setDayOfWeek] = useState(2);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("12:00");
  const [percent, setPercent] = useState(20);
  const refresh = () => { void utils.pro.offpeak.invalidate(); void utils.catalog.invalidate(); };
  const add = trpc.pro.addOffpeak.useMutation({ onSuccess: () => { refresh(); notify("Offre ajoutée : les créneaux concernés affichent la remise."); }, onError: () => notify("Vérifiez l’offre : l’heure de début doit précéder la fin, remise de 5 à 50 %.", true) });
  const remove = trpc.pro.removeOffpeak.useMutation({ onSuccess: () => { refresh(); notify("Offre retirée."); } });
  if (list.isLoading) return <Loading />;
  if (list.error) return <Failed onRetry={() => list.refetch()} />;
  return <div className="kofi-adm-stack">
    <p className="kofi-adm-sub">Remplissez vos heures calmes : une remise s’applique automatiquement aux rendez-vous qui commencent dans la tranche choisie. Les clients voient « −X % » sur les créneaux, et votre profil apparaît dans le filtre « Offres heures creuses ».</p>
    <form className="kofi-adm-card" onSubmit={(event: FormEvent) => { event.preventDefault(); add.mutate({ dayOfWeek, startTime, endTime, percent }); }}>
      <h2>Nouvelle offre</h2>
      <div className="kofi-form-grid">
        <Field label="Jour"><select value={dayOfWeek} onChange={(event) => setDayOfWeek(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6, 0].map((day) => <option key={day} value={day}>{WEEKDAY_LABELS[day]}</option>)}</select></Field>
        <Field label="Remise"><select value={percent} onChange={(event) => setPercent(Number(event.target.value))}>{[10, 15, 20, 25, 30, 40, 50].map((value) => <option key={value} value={value}>−{value} %</option>)}</select></Field>
        <Field label="De"><input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></Field>
        <Field label="À"><input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></Field>
      </div>
      <button className="kofi-button primary small" type="submit" disabled={add.isPending || startTime >= endTime}><Plus size={14} /> Ajouter l’offre</button>
    </form>
    {list.data?.length ? <div className="kofi-adm-list">{list.data.map((rule) => <div key={rule.id} className="kofi-adm-card"><div className="kofi-adm-row"><div><h3>{WEEKDAY_LABELS[rule.dayOfWeek]} · {rule.startTime} – {rule.endTime}</h3><small>Rendez-vous commençant dans cette tranche</small></div><span className="kofi-offpeak">−{rule.percent} %</span></div><div className="kofi-adm-actions"><button className="kofi-button outline small" disabled={remove.isPending} onClick={() => remove.mutate({ id: rule.id })}><Trash2 size={14} /> Retirer</button></div></div>)}</div> : <Empty>Aucune offre pour l’instant.</Empty>}
  </div>;
}

// ---------------------------------------------------------------------------
// Horaires et congés
// ---------------------------------------------------------------------------

function HoursTab({ me, notify }: { me: Me; notify: (message: string, isError?: boolean) => void }) {
  const utils = trpc.useUtils();
  const initial = Object.fromEntries(DAYS.map(({ key }) => [key, { on: Boolean(me.weeklyHours[key]), open: me.weeklyHours[key]?.open ?? "09:00", close: me.weeklyHours[key]?.close ?? "18:00" }])) as Record<DayKey, { on: boolean; open: string; close: string }>;
  const [hours, setHours] = useState(initial);
  const save = trpc.pro.setWeeklyHours.useMutation({
    onSuccess: (result) => { utils.pro.invalidate(); utils.catalog.invalidate(); notify(result.bookingsOutsideHours ? `Horaires enregistrés. Attention : ${result.bookingsOutsideHours} rendez-vous déjà pris tombe(nt) hors des nouveaux horaires, ils restent valables.` : "Horaires enregistrés : vos créneaux sont à jour.", result.bookingsOutsideHours > 0); },
    onError: (error) => notify(errorText(error.message), true),
  });
  const invalid = DAYS.some(({ key }) => hours[key].on && hours[key].open >= hours[key].close);
  const submit = () => save.mutate(Object.fromEntries(DAYS.filter(({ key }) => hours[key].on).map(({ key }) => [key, { open: hours[key].open, close: hours[key].close }])));
  const update = (key: DayKey, patch: Partial<{ on: boolean; open: string; close: string }>) => setHours((current) => ({ ...current, [key]: { ...current[key], ...patch } }));

  const closures = trpc.pro.closures.useQuery();
  const today = doualaDay();
  const [from, setFrom] = useState(addDays(today, 1));
  const [to, setTo] = useState(addDays(today, 1));
  const [kind, setKind] = useState<"leave" | "holiday" | "blocked">("leave");
  const [allDay, setAllDay] = useState(true);
  const [fromTime, setFromTime] = useState("12:00");
  const [toTime, setToTime] = useState("14:00");
  const [note, setNote] = useState("");
  const add = trpc.pro.addClosure.useMutation({
    onSuccess: (result) => { utils.pro.invalidate(); utils.catalog.invalidate(); setNote(""); notify(result.affectedBookings.length ? `Indisponibilité ajoutée. ${result.affectedBookings.length} rendez-vous déjà pris sur cette période : pensez à les annuler ou à prévenir les clients.` : "Indisponibilité ajoutée : ces horaires ne sont plus réservables.", result.affectedBookings.length > 0); },
    onError: (error) => notify(errorText(error.message), true),
  });
  const remove = trpc.pro.removeClosure.useMutation({ onSuccess: () => { utils.pro.invalidate(); utils.catalog.invalidate(); notify("Indisponibilité retirée."); }, onError: (error) => notify(errorText(error.message), true) });
  const addClosure = (event: FormEvent) => {
    event.preventDefault();
    const startsAt = doualaToIso(from, allDay ? "00:00" : fromTime);
    const endsAt = allDay ? doualaToIso(addDays(to, 1), "00:00") : doualaToIso(to, toTime);
    add.mutate({ startsAt, endsAt, status: kind, note: note.trim() || undefined });
  };

  return <div className="kofi-adm-stack">
    <section className="kofi-adm-card">
      <h2>Horaires habituels</h2>
      <p className="kofi-adm-hint">Heure de Douala. Les clients ne voient que les créneaux libres dans ces horaires, sur les 60 prochains jours.</p>
      <div className="kofi-pro-hours">{DAYS.map(({ key, label }) => <div key={key} className={`kofi-pro-hourrow ${hours[key].on ? "" : "is-off"}`}>
        <label className="kofi-check"><input type="checkbox" checked={hours[key].on} onChange={(event) => update(key, { on: event.target.checked })} /> {label}</label>
        {hours[key].on ? <span className="kofi-pro-times"><input type="time" aria-label={`${label} : ouverture`} value={hours[key].open} onChange={(event) => update(key, { open: event.target.value })} /> – <input type="time" aria-label={`${label} : fermeture`} value={hours[key].close} onChange={(event) => update(key, { close: event.target.value })} /></span> : <span className="kofi-adm-hint">Fermé</span>}
      </div>)}</div>
      {invalid && <p className="kofi-adm-warn">L’heure d’ouverture doit précéder l’heure de fermeture.</p>}
      <button className="kofi-button primary small" style={{ alignSelf: "flex-start" }} disabled={save.isPending || invalid} onClick={submit}>{save.isPending ? "Enregistrement…" : "Enregistrer les horaires"}</button>
    </section>
    <section className="kofi-adm-card">
      <h2>Congés et indisponibilités</h2>
      <form className="kofi-adm-stack" onSubmit={addClosure}>
        <div className="kofi-form-grid">
          <Field label="Type"><select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="leave">Congé</option><option value="holiday">Jour férié</option><option value="blocked">Indisponible (ponctuel)</option></select></Field>
          <label className="kofi-check" style={{ alignSelf: "end", minHeight: 44 }}><input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} /> Journée(s) entière(s)</label>
          <Field label="Du"><input type="date" min={today} value={from} onChange={(event) => { setFrom(event.target.value); if (event.target.value > to) setTo(event.target.value); }} /></Field>
          <Field label="Au"><input type="date" min={from} value={to} onChange={(event) => setTo(event.target.value)} /></Field>
          {!allDay && <><Field label="De"><input type="time" value={fromTime} onChange={(event) => setFromTime(event.target.value)} /></Field><Field label="À"><input type="time" value={toTime} onChange={(event) => setToTime(event.target.value)} /></Field></>}
          <div className="kofi-form-group full"><Field label="Note (optionnel)"><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ex. Formation, voyage…" maxLength={255} /></Field></div>
        </div>
        <button className="kofi-button outline small" type="submit" style={{ alignSelf: "flex-start" }} disabled={add.isPending}><CalendarDays size={14} /> Ajouter l’indisponibilité</button>
      </form>
      {closures.isLoading ? <Loading /> : closures.error ? <Failed onRetry={() => closures.refetch()} /> : closures.data?.length ? <ul className="kofi-adm-list">{closures.data.map((closure) => <li key={closure.id} className="kofi-adm-row kofi-pro-closure"><div><strong>{CLOSURE_LABELS[closure.status as keyof typeof CLOSURE_LABELS]}</strong> · {formatPeriod(closure.startsAt, closure.endsAt)}{closure.note && <small>{closure.note}</small>}</div><button className="kofi-button outline small" aria-label="Retirer cette indisponibilité" disabled={remove.isPending} onClick={() => remove.mutate({ id: closure.id })}><Trash2 size={14} /> Retirer</button></li>)}</ul> : <p className="kofi-adm-hint">Aucune indisponibilité à venir.</p>}
    </section>
  </div>;
}

const PHOTO_ERRORS: Record<string, string> = {
  IMAGE_INVALID: "Ce fichier n’est pas une photo exploitable (JPEG, PNG, WebP ou HEIC, 300 px minimum).",
  IMAGE_TOO_LARGE: "Photo trop lourde (8 Mo au plus).",
  PORTFOLIO_LIMIT: "Vous avez atteint 12 photos : retirez-en une pour en ajouter une autre.",
  STORAGE_UNAVAILABLE: "L’envoi de photos n’est pas encore activé sur KOFI.",
  UNAUTHORIZED: "Votre session a expiré : reconnectez-vous.",
};

/** Réduit la photo dans le navigateur avant l’envoi (1600 px, JPEG) : moins de data consommée. Le serveur la retraite ensuite. */
async function shrinkForUpload(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", 0.85));
  } catch {
    return file;
  }
}

function PhotosTab({ notify }: { notify: (message: string, isError?: boolean) => void }) {
  const utils = trpc.useUtils();
  const list = trpc.pro.portfolio.useQuery();
  const remove = trpc.pro.removePhoto.useMutation({ onSuccess: () => { utils.pro.portfolio.invalidate(); notify("Photo retirée."); }, onError: (error) => notify(errorText(error.message), true) });
  const [description, setDescription] = useState("");
  const [uploading, setUploading] = useState("");
  // Plusieurs photos d’un coup (galerie) ou une photo prise sur le moment (appareil photo du téléphone).
  // Chaque photo est réduite sur le téléphone avant l’envoi, puis envoyée l’une après l’autre.
  const upload = async (picked: FileList | null, room: number) => {
    const files = [...(picked ?? [])].slice(0, Math.max(0, room));
    if (!files.length) return;
    const caption = description.trim();
    let sent = 0;
    let failure = "";
    try {
      for (const [index, file] of files.entries()) {
        setUploading(files.length > 1 ? `Envoi ${index + 1}/${files.length}…` : "Envoi en cours…");
        const body = await shrinkForUpload(file);
        const response = await fetch("/api/uploads/portfolio", { method: "POST", credentials: "include", headers: { "Content-Type": body.type || "application/octet-stream", ...(caption ? { "X-Description": encodeURIComponent(caption) } : {}) }, body });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) { failure = PHOTO_ERRORS[result.error] ?? "L’envoi a échoué. Réessayez."; break; }
        sent++;
      }
    } catch {
      failure = "L’envoi a échoué : vérifiez votre connexion.";
    } finally {
      setUploading("");
    }
    if (sent) { setDescription(""); utils.pro.portfolio.invalidate(); }
    if (failure) notify(sent ? `${sent} photo(s) envoyée(s), puis : ${failure}` : failure, true);
    else notify(sent > 1 ? `${sent} photos envoyées : elles seront visibles après validation par KOFI.` : "Photo envoyée : elle sera visible après validation par KOFI.");
  };
  if (list.isLoading) return <Loading />;
  if (list.error) return <Failed onRetry={() => list.refetch()} />;
  const items = list.data?.items ?? [];
  const full = items.length >= (list.data?.max ?? 12);
  const badge = { pending: ["En validation", "orange"], approved: ["Publiée", "green"], rejected: ["Refusée", "red"], removed: ["Retirée", "gray"] } as const;
  return <div className="kofi-adm-stack">
    <p className="kofi-adm-sub">Montrez vos vraies réalisations ({items.length}/{list.data?.max ?? 12}). Chaque photo est vérifiée par KOFI avant d’apparaître sur votre profil. Les informations cachées de la photo (dont la position GPS) sont supprimées.</p>
    {!full && <div className="kofi-adm-reason">
      <label><span>Légende (optionnel)</span><input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} placeholder="Ex. Tresses collées, 3 h" /></label>
      <div className="kofi-upload-actions">
        <label className="kofi-button primary small kofi-upload" aria-disabled={Boolean(uploading)}><input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={Boolean(uploading)} onChange={(event) => { void upload(event.target.files, (list.data?.max ?? 12) - items.length); event.target.value = ""; }} /><ImageIcon size={14} /> {uploading || "Choisir des photos"}</label>
        <label className="kofi-button outline small kofi-upload" aria-disabled={Boolean(uploading)}><input type="file" accept="image/*" capture="environment" disabled={Boolean(uploading)} onChange={(event) => { void upload(event.target.files, (list.data?.max ?? 12) - items.length); event.target.value = ""; }} /><Camera size={14} /> Prendre une photo</label>
      </div>
    </div>}
    {!items.length ? <Empty>Aucune photo pour l’instant.</Empty> : <div className="kofi-photo-grid">{items.map((item) => <figure key={item.id} className="kofi-photo">
      <img src={item.thumbUrl} alt={item.description ?? "Réalisation"} loading="lazy" width={400} height={400} />
      <figcaption><span className={`kofi-adm-badge ${badge[item.status][1]}`}>{badge[item.status][0]}</span>{item.description && <small>{item.description}</small>}{item.moderationNote && item.status === "rejected" && <small>Motif : {item.moderationNote}</small>}
        <button className="kofi-button outline small" disabled={remove.isPending} onClick={() => { if (window.confirm("Retirer cette photo ?")) remove.mutate({ id: item.id }); }}><Trash2 size={13} /> Retirer</button></figcaption>
    </figure>)}</div>}
  </div>;
}

function EarningsTab() {
  const earnings = trpc.pro.earnings.useQuery();
  if (earnings.isLoading) return <Loading />;
  if (earnings.error || !earnings.data) return <Failed onRetry={() => earnings.refetch()} />;
  const data = earnings.data;
  if (!data.enabled && !data.collectedXaf) return <Empty>Le paiement en ligne n’est pas encore activé : vos clients vous règlent directement.</Empty>;
  const rows = [["Encaissé par KOFI (rendez-vous terminés)", data.collectedXaf], [`Commission KOFI (${data.commissionPercent} %)`, -data.commissionXaf], ["Votre part", data.netXaf], ["Déjà reversé", -data.paidOutXaf]] as const;
  return <div className="kofi-adm-stack">
    <div className="kofi-adm-card"><span className="kofi-adm-label">Solde à recevoir</span><strong className="kofi-adm-value">{formatXaf(data.balanceXaf)}</strong><span className="kofi-adm-hint">Reversé par KOFI sur votre compte Mobile Money.</span></div>
    <div className="kofi-adm-card">{rows.map(([label, value]) => <div key={label} className="kofi-adm-row"><span>{label}</span><strong>{value < 0 ? `− ${formatXaf(-value)}` : formatXaf(value)}</strong></div>)}</div>
    {!!data.payouts.length && <div className="kofi-adm-card"><h2>Reversements</h2>{data.payouts.map((payout) => <div key={payout.id} className="kofi-adm-row"><span>{new Date(payout.createdAt).toLocaleDateString("fr-FR", { timeZone: "Africa/Douala" })}{payout.note ? ` · ${payout.note}` : ""}</span><strong>{formatXaf(payout.amountXaf)}</strong></div>)}</div>}
    <p className="kofi-adm-hint">La commission est calculée sur le montant réellement payé, une fois le rendez-vous marqué « terminé ». Un rendez-vous annulé est remboursé au client et n’entre pas dans votre solde.</p>
  </div>;
}

function ReviewsTab({ notify }: { notify: (message: string, isError?: boolean) => void }) {
  const utils = trpc.useUtils();
  const list = trpc.pro.reviews.useQuery();
  const [replying, setReplying] = useState<number | null>(null);
  const [reply, setReply] = useState("");
  const send = trpc.pro.replyReview.useMutation({ onSuccess: () => { setReplying(null); setReply(""); utils.pro.reviews.invalidate(); notify("Réponse publiée sous l’avis."); }, onError: (error) => notify(error.message === "REVIEW_ALREADY_ANSWERED" ? "Vous avez déjà répondu à cet avis." : errorText(error.message), true) });
  if (list.isLoading) return <Loading />;
  if (list.error) return <Failed onRetry={() => list.refetch()} />;
  if (!list.data?.length) return <Empty>Pas encore d’avis. Vos clients pourront noter leur rendez-vous une fois que vous l’aurez marqué « terminé ».</Empty>;
  return <div className="kofi-adm-stack">
    <p className="kofi-adm-sub">Avis vérifiés, publics sur votre profil. Vous pouvez répondre une fois à chaque avis, poliment : la réponse est publique.</p>
    <div className="kofi-adm-list">{list.data.map((review) => <article className="kofi-adm-card" key={review.id}>
      <div className="kofi-adm-row"><div><h3>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)} <span className="sr-only">{review.rating} sur 5</span></h3><small>{review.author} · {new Date(review.createdAt).toLocaleDateString("fr-FR", { timeZone: "Africa/Douala" })}{review.bookingReference ? ` · réf. ${review.bookingReference}` : ""}</small></div>{review.status === "hidden" && <span className="kofi-adm-badge gray">Masqué par KOFI</span>}</div>
      {review.comment && <p style={{ margin: 0 }}>« {review.comment} »</p>}
      {review.proReply ? <p className="kofi-adm-note">Votre réponse : {review.proReply}</p> : replying === review.id ? <form className="kofi-adm-reason" onSubmit={(event: FormEvent) => { event.preventDefault(); send.mutate({ id: review.id, reply }); }}>
        <label><span>Votre réponse publique</span><input value={reply} onChange={(event) => setReply(event.target.value)} maxLength={1000} autoFocus placeholder="Merci pour votre visite…" /></label>
        <div className="kofi-adm-actions"><button className="kofi-button primary small" type="submit" disabled={send.isPending || reply.trim().length < 2}>Publier</button><button className="kofi-button outline small" type="button" onClick={() => setReplying(null)}>Annuler</button></div>
      </form> : <div className="kofi-adm-actions"><button className="kofi-button outline small" onClick={() => { setReplying(review.id); setReply(""); }}>Répondre</button></div>}
    </article>)}</div>
  </div>;
}

// ---------------------------------------------------------------------------

export default function ProPage() {
  const auth = useAuth();
  const me = trpc.pro.me.useQuery(undefined, { enabled: auth.isAuthenticated, retry: false });
  const overview = trpc.pro.overview.useQuery(undefined, { enabled: Boolean(me.data), refetchInterval: 60_000 });
  const [tab, setTabState] = useState<Tab>("dashboard");
  const [toast, setToast] = useState<{ message: string; isError: boolean } | null>(null);
  const [profileError, setProfileError] = useState("");
  const utils = trpc.useUtils();
  const setTab = (next: Tab) => { setTabState(next); void utils.pro.invalidate(); };
  const updateProfile = trpc.pro.updateProfile.useMutation({ onSuccess: (result) => { utils.pro.invalidate(); utils.catalog.invalidate(); setToast({ message: result.status === "pending" ? "Profil mis à jour et renvoyé pour validation." : "Profil mis à jour.", isError: false }); }, onError: (error) => setProfileError(errorText(error.message)) });
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 6000); return () => clearTimeout(timer); }, [toast]);
  const notify = (message: string, isError = false) => setToast({ message, isError });

  if (auth.loading || (auth.isAuthenticated && me.isLoading)) return <main className="kofi-container kofi-page"><Loading /></main>;
  if (!auth.isAuthenticated) return <main className="kofi-container kofi-page"><div className="kofi-empty" style={{ margin: "70px auto", maxWidth: 560 }}><Scissors size={28} /><h2>Vous êtes professionnel de la beauté ?</h2><p>Coiffure, ongles, maquillage, barbier, esthétique : connectez-vous pour créer votre profil, publier vos tarifs et recevoir des demandes de rendez-vous.</p><button className="kofi-button primary small" onClick={() => { try { startLogin(); } catch { window.alert("La connexion n’est pas encore configurée sur cet environnement."); } }}><LogIn size={15} /> Se connecter</button></div></main>;
  if (me.error) return <main className="kofi-container kofi-page"><Failed onRetry={() => me.refetch()} /></main>;
  // Les comptes de l’équipe KOFI n’ont pas d’espace pro : ils gèrent les salons depuis l’administration.
  if (!me.data && auth.user?.role !== "user") return <main className="kofi-container kofi-page"><div className="kofi-empty" style={{ margin: "70px auto", maxWidth: 560 }}><Scissors size={28} /><h2>Espace réservé aux professionnels</h2><p>Votre compte fait partie de l’équipe KOFI : les salons se gèrent depuis l’administration.</p><a className="kofi-button primary small" href={auth.user?.role === "superadmin" ? "/superadmin" : "/admin"}>Ouvrir mon espace</a></div></main>;
  if (!me.data) return <Onboarding />;

  const profile = me.data;
  const stats = overview.data;
  const banner = profile.status === "pending" ? { tone: "orange", text: "Profil en cours de vérification par KOFI. Vous pouvez déjà recevoir des demandes ; le badge « Vérifié » apparaîtra après validation." }
    : profile.status === "refused" ? { tone: "red", text: `Inscription refusée${profile.statusNote ? ` : ${profile.statusNote}` : ""}. Corrigez votre profil (onglet Profil) pour le renvoyer en validation. Votre profil est masqué en attendant.` }
      : profile.status === "suspended" ? { tone: "red", text: `Profil suspendu${profile.statusNote ? ` : ${profile.statusNote}` : ""}. Il n’apparaît plus dans la recherche. Contactez KOFI.` }
        : null;
  const todo = [!profile.services.some((service) => service.active) && "ajoutez au moins une prestation", !Object.keys(profile.weeklyHours).length && "indiquez vos horaires"].filter(Boolean) as string[];
  const tabs: { id: Tab; label: string; icon: LucideIcon; badge?: number; group: string }[] = [
    { id: "dashboard", label: "Tableau de bord", icon: LayoutDashboard, group: "Activité" },
    { id: "requests", label: "Demandes", icon: Inbox, badge: stats?.pendingRequests, group: "Activité" },
    { id: "agenda", label: "Agenda", icon: CalendarDays, group: "Activité" },
    { id: "history", label: "Historique", icon: History, group: "Activité" },
    { id: "earnings", label: "Revenus", icon: Wallet, group: "Activité" },
    { id: "services", label: "Prestations", icon: Scissors, group: "Mon salon" },
    { id: "team", label: "Équipe", icon: Users, group: "Mon salon" },
    { id: "offpeak", label: "Heures creuses", icon: Percent, group: "Mon salon" },
    { id: "hours", label: "Horaires et congés", icon: Clock3, group: "Mon salon" },
    { id: "photos", label: "Photos", icon: ImageIcon, group: "Mon salon" },
    { id: "reviews", label: "Avis", icon: Star, group: "Mon salon" },
    { id: "profile", label: "Profil", icon: UserRound, group: "Mon salon" },
  ];
  const current = tabs.find((item) => item.id === tab) ?? tabs[0];
  const publicVisible = profile.status !== "refused" && profile.status !== "suspended" && profile.services.some((service) => service.active);
  const initials = profile.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");
  const statusBadge = profile.status === "verified" ? <span className="kofi-status green"><ShieldCheck size={14} /> Vérifié</span> : <span className="kofi-status orange"><UserRound size={14} /> {profile.status === "pending" ? "En vérification" : profile.status === "refused" ? "Refusé" : "Suspendu"}</span>;
  return <main className="kofi-container kofi-page kofi-adm kofi-pro-shell">
    <aside className="kofi-pro-side" aria-label="Menu de l’espace professionnel">
      <div className="kofi-pro-id"><span className="kofi-pro-avatar" aria-hidden="true">{initials || "K"}</span><div><strong>{profile.displayName}</strong><small>{profile.salonName || modeLabel(profile.mode)} · {profile.city}</small></div></div>
      <div className="kofi-pro-id-status">{statusBadge}</div>
      <nav className="kofi-pro-nav">{["Activité", "Mon salon"].map((group) => <div key={group} className="kofi-pro-navgroup"><span className="kofi-pro-navlabel">{group}</span>{tabs.filter((item) => item.group === group).map((item) => <button key={item.id} type="button" className={`kofi-pro-navitem ${tab === item.id ? "is-on" : ""}`} aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}><item.icon size={17} aria-hidden="true" /><span>{item.label}</span>{!!item.badge && <em className="kofi-adm-count">{item.badge}</em>}</button>)}</div>)}</nav>
      {publicVisible && <a className="kofi-pro-public" href={`/pro/${profile.slug}`} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Voir mon profil public</a>}
    </aside>
    <section className="kofi-pro-main">
      <header className="kofi-pro-head"><div><span className="kofi-eyebrow">Espace professionnel</span><h1>{current.label}</h1></div>{tab !== "dashboard" && <button type="button" className="kofi-button outline small" onClick={() => setTab("dashboard")}><LayoutDashboard size={15} /> Tableau de bord</button>}</header>
      {banner && <p className={`kofi-adm-${banner.tone === "orange" ? "warn" : "note"}`} style={{ marginBottom: 14 }}>{banner.text}</p>}
      <div role="status" aria-live="polite">{toast && <div className={`kofi-adm-toast ${toast.isError ? "is-error" : ""}`}>{toast.isError ? <X size={16} /> : <Check size={16} />} {toast.message}</div>}</div>
      {tab === "dashboard" && <DashboardTab me={profile} stats={stats} todo={todo} go={setTab} />}
    {tab === "requests" && <BookingsTab scope="pending" notify={notify} empty="Aucune demande en attente. Les nouvelles demandes apparaissent ici." />}
    {tab === "agenda" && <BookingsTab scope="upcoming" notify={notify} empty="Aucun rendez-vous confirmé à venir." />}
    {tab === "history" && <BookingsTab scope="past" notify={notify} empty="Pas encore d’historique." />}
    {tab === "services" && <ServicesTab me={profile} notify={notify} />}
    {tab === "team" && <TeamTab notify={notify} />}
    {tab === "offpeak" && <OffpeakTab notify={notify} />}
    {tab === "reviews" && <ReviewsTab notify={notify} />}
    {tab === "earnings" && <EarningsTab />}
    {tab === "photos" && <PhotosTab notify={notify} />}
    {tab === "hours" && <HoursTab key={JSON.stringify(profile.weeklyHours)} me={profile} notify={notify} />}
    {tab === "profile" && <ProfileForm key={profile.slug} initial={{ displayName: profile.displayName, salonName: profile.salonName, city: profile.city, neighborhood: profile.neighborhood, mode: profile.mode, bio: profile.bio, specialties: profile.specialties.join(", "), whatsapp: profile.whatsapp.replace(/^\+237/, ""), location: profile.location }} submitLabel={profile.status === "refused" ? "Enregistrer et renvoyer en validation" : "Enregistrer le profil"} busy={updateProfile.isPending} error={profileError} onSubmit={(values) => { setProfileError(""); updateProfile.mutate(toInput(values)); }} />}
    <p className="kofi-adm-hint" style={{ marginTop: 28 }}><Clock3 size={13} /> Tous les horaires sont en heure de Douala. Paiements : voir l’onglet Revenus.</p>
    </section>
  </main>;
}

// ---------------------------------------------------------------------------
// Tableau de bord
// ---------------------------------------------------------------------------

type Stats = Outputs["overview"] | undefined;

function DashboardTab({ me, stats, todo, go }: { me: Me; stats: Stats; todo: string[]; go: (tab: Tab) => void }) {
  const upcoming = trpc.pro.bookings.useQuery({ scope: "upcoming" });
  const photos = trpc.pro.portfolio.useQuery();
  const hour = Number(new Intl.DateTimeFormat("fr-FR", { hour: "numeric", hour12: false, timeZone: "Africa/Douala" }).format(new Date()));
  const hello = hour < 18 ? "Bonjour" : "Bonsoir";
  const firstName = me.displayName.split(/\s+/)[0] ?? me.displayName;
  const today = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Douala" }).format(new Date());

  const kpis: { label: string; value: ReactNode; icon: LucideIcon; tone: string; tab?: Tab; hint?: string }[] = [
    { label: "Demandes à traiter", value: stats?.pendingRequests ?? "—", icon: Inbox, tone: "orange", tab: "requests", hint: stats?.pendingRequests ? "À accepter ou refuser" : "Tout est à jour" },
    { label: "Rendez-vous aujourd’hui", value: stats?.appointmentsToday ?? "—", icon: CalendarDays, tone: "green", tab: "agenda" },
    { label: "Confirmés sur 7 jours", value: stats?.confirmedNext7Days ?? "—", icon: CheckCircle2, tone: "blue", tab: "agenda" },
    { label: "Chiffre du mois", value: stats ? formatXaf(stats.revenueThisMonthXaf) : "—", icon: TrendingUp, tone: "dark", tab: "earnings", hint: stats ? `${stats.completedThisMonth} rendez-vous terminés` : undefined },
    { label: "Note des clients", value: stats ? (stats.reviewCount ? `${stats.rating.toFixed(1)} ★` : "—") : "—", icon: Star, tone: "gold", tab: "reviews", hint: stats?.reviewCount ? `${stats.reviewCount} avis vérifiés` : "Pas encore d’avis" },
  ];

  const checklist = [
    { done: true, label: "Créer votre profil", tab: "profile" as Tab },
    { done: me.services.some((service) => service.active), label: "Ajouter vos prestations et tarifs", tab: "services" as Tab },
    { done: Object.keys(me.weeklyHours).length > 0, label: "Indiquer vos horaires d’ouverture", tab: "hours" as Tab },
    { done: (photos.data?.items.length ?? 0) > 0, label: "Montrer vos réalisations en photo", tab: "photos" as Tab },
    { done: me.status === "verified", label: "Obtenir le badge « Vérifié » KOFI", tab: "profile" as Tab },
  ];
  const doneCount = checklist.filter((item) => item.done).length;
  const progress = Math.round((doneCount / checklist.length) * 100);
  const next = upcoming.data?.slice(0, 5) ?? [];

  return <div className="kofi-pro-dash">
    <section className="kofi-pro-hello">
      <div><p className="kofi-pro-date">{today}</p><h2>{hello} {firstName} 👋</h2><p>{stats?.pendingRequests ? `Vous avez ${stats.pendingRequests} demande${stats.pendingRequests > 1 ? "s" : ""} en attente de réponse.` : todo.length ? `Pour être réservable : ${todo.join(" et ")}.` : "Votre agenda est à jour. Bonne journée !"}</p></div>
      {stats?.pendingRequests ? <button type="button" className="kofi-button primary" onClick={() => go("requests")}>Traiter les demandes <ArrowRight size={16} /></button> : <button type="button" className="kofi-button primary" onClick={() => go("agenda")}>Voir mon agenda <ArrowRight size={16} /></button>}
    </section>

    <div className="kofi-pro-kpigrid">{kpis.map((kpi) => <button type="button" key={kpi.label} className={`kofi-pro-kpi tone-${kpi.tone}`} onClick={() => kpi.tab && go(kpi.tab)}>
      <span className="kofi-pro-kpi-icon"><kpi.icon size={18} aria-hidden="true" /></span>
      <span className="kofi-pro-kpi-label">{kpi.label}</span>
      <strong className="kofi-pro-kpi-value">{kpi.value}</strong>
      {kpi.hint && <small>{kpi.hint}</small>}
    </button>)}</div>

    <div className="kofi-pro-cols">
      <section className="kofi-adm-card kofi-pro-panel">
        <div className="kofi-pro-panelhead"><h2>Prochains rendez-vous</h2><button type="button" className="kofi-link-button" onClick={() => go("agenda")}>Tout l’agenda</button></div>
        {upcoming.isLoading ? <Loading /> : upcoming.error ? <Failed onRetry={() => upcoming.refetch()} /> : next.length ? <ol className="kofi-pro-timeline">{next.map((booking) => <li key={booking.reference}>
          <time dateTime={booking.startsAt}><strong>{formatTime(booking.startsAt)}</strong><span>{formatDayLabel(doualaDay(booking.startsAt))}</span></time>
          <div><strong>{booking.customerName}</strong><small>{booking.items.map((item) => item.name).join(" + ")} · {formatDuration(booking.durationMinutes)}</small></div>
          <span className="kofi-pro-amount">{formatXaf(booking.totalXaf)}</span>
        </li>)}</ol> : <div className="kofi-pro-emptyline"><CalendarDays size={20} /> Aucun rendez-vous confirmé à venir.</div>}
      </section>

      <section className="kofi-adm-card kofi-pro-panel">
        <div className="kofi-pro-panelhead"><h2>Démarrage</h2><span className="kofi-pro-progress-label">{doneCount}/{checklist.length}</span></div>
        <div className="kofi-pro-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Profil complété"><i style={{ width: `${progress}%` }} /></div>
        <ul className="kofi-pro-checklist">{checklist.map((item) => <li key={item.label} className={item.done ? "is-done" : ""}><button type="button" onClick={() => go(item.tab)}>{item.done ? <CheckCircle2 size={18} aria-hidden="true" /> : <Circle size={18} aria-hidden="true" />}<span>{item.label}</span>{!item.done && <ArrowRight size={14} aria-hidden="true" />}</button></li>)}</ul>
      </section>
    </div>
  </div>;
}
