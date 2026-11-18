import { Ban, Check, Crown, KeyRound, LayoutDashboard, LogIn, RefreshCcw, ShieldCheck, ShieldAlert, UserPlus, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Empty, Failed, Loading, ReasonForm } from "./shared";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { assignableRoles, canManageAccount, ROLE_LABELS, type Role } from "@shared/permissions";
import { TwoFactorLoginStep, TwoFactorSetup, useSecondFactorGate } from "./TwoFactor";

/**
 * Espace super-administrateur (/superadmin).
 * L’interface ne fait que masquer : chaque donnée vient de procédures « superAdminProcedure »
 * qui refusent tout compte dont le rôle n’est pas « superadmin ».
 */

type Tab = "overview" | "team" | "audit";
const PASSWORD_MIN = 12;

const ERRORS: Record<string, string> = {
  EMAIL_TAKEN: "Un compte existe déjà avec cet e-mail.",
  PASSWORD_WEAK: `Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères.`,
  CANNOT_CHANGE_OWN_ROLE: "Vous ne pouvez pas modifier votre propre rôle.",
  CANNOT_SUSPEND_SELF: "Vous ne pouvez pas suspendre votre propre compte.",
  ACCOUNT_PROTECTED: "Ce compte est protégé.",
  ROLE_NOT_ALLOWED: "Ce rôle ne peut pas être attribué ici.",
  REASON_REQUIRED: "Indiquez un motif (3 caractères minimum).",
  INVALID_CREDENTIALS: "E-mail ou mot de passe incorrect.",
  AUTH_RATE_LIMIT: "Trop d’essais. Réessayez dans 15 minutes.",
  ACCOUNT_SUSPENDED: "Ce compte est suspendu.",
};
const errorText = (message: string) => ERRORS[message] ?? "L’action n’a pas pu être enregistrée. Réessayez.";
const shortDate = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Africa/Douala", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Gate({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <main className="kofi-container kofi-page"><div className="kofi-success kofi-sa-gate" style={{ maxWidth: 440 }}><div className="success-icon">{icon}</div><span className="kofi-eyebrow">Super-administration KOFI</span><h1>{title}</h1>{children}</div></main>;
}

/** Connexion dédiée : seuls les identifiants super-administrateur ouvrent cet espace. */
function SuperAdminLogin() {
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const login = trpc.auth.login.useMutation({ onSuccess: async (result) => { setPassword(""); if (result.twoFactor) setChallenge(result.challenge); else await utils.auth.me.invalidate(); } });
  const submit = (event: FormEvent) => { event.preventDefault(); login.mutate({ email, password }); };
  if (challenge) return <Gate icon={<Crown size={28} />} title="Code de sécurité">
    <TwoFactorLoginStep challenge={challenge} onSuccess={() => { setChallenge(null); void utils.auth.me.invalidate(); }} onCancel={() => { setChallenge(null); login.reset(); }} />
  </Gate>;
  return <Gate icon={<Crown size={28} />} title="Accès restreint">
    <p>Réservé au super-administrateur de la plateforme. Toute tentative est limitée et la session expire après 12 heures.</p>
    <form onSubmit={submit} style={{ display: "grid", gap: 14, textAlign: "left", marginTop: 22 }} noValidate>
      <div className="kofi-form-group"><label htmlFor="sa-email">Identifiant (e-mail)</label><input id="sa-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required maxLength={320} /></div>
      <div className="kofi-form-group"><label htmlFor="sa-password">Mot de passe</label><input id="sa-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required maxLength={128} /></div>
      {login.error && <div className="kofi-alert" role="alert" style={{ marginBottom: 0 }}><X size={16} /> {errorText(login.error.message)}</div>}
      <button className="kofi-button primary" type="submit" disabled={login.isPending}><LogIn size={16} /> {login.isPending ? "Vérification…" : "Entrer"}</button>
    </form>
  </Gate>;
}

function OverviewTab() {
  const summary = trpc.superadmin.summary.useQuery();
  if (summary.isLoading) return <Loading />;
  if (summary.error || !summary.data) return <Failed onRetry={() => summary.refetch()} />;
  const data = summary.data;
  const kpis = [
    { label: "Clients", value: data.clients, hint: "Comptes clients inscrits" },
    { label: "Professionnels", value: data.professionals, hint: `${data.verifiedProfessionals} vérifié(s)` },
    { label: "Réservations", value: data.bookings, hint: "Depuis l’ouverture" },
    { label: "Équipe KOFI", value: data.team, hint: `${data.admins} administrateur(s)` },
  ];
  return <div className="kofi-adm-stack">
    <div className="kofi-adm-kpis">{kpis.map((kpi) => <div className="kofi-adm-card" key={kpi.label}><span className="kofi-adm-label">{kpi.label}</span><strong className="kofi-adm-value">{kpi.value}</strong><span className="kofi-adm-hint">{kpi.hint}</span></div>)}</div>
    <section className="kofi-adm-card">
      <h2>Vos pouvoirs</h2>
      <ul className="kofi-sa-list">
        <li><Check size={15} /> Créer, nommer et retirer les administrateurs, modérateurs et agents de support.</li>
        <li><Check size={15} /> Suspendre n’importe quel compte, y compris un administrateur.</li>
        <li><Check size={15} /> Tous les droits du back-office : <a className="kofi-link" href="/admin">ouvrir l’administration</a>.</li>
        <li><ShieldCheck size={15} /> Votre compte ne peut être ni modifié ni suspendu depuis le site.</li>
      </ul>
    </section>
  </div>;
}

function CreateAccountForm({ notify }: { notify: (message: string, isError?: boolean) => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"support" | "moderator" | "admin">("admin");
  const create = trpc.superadmin.createAccount.useMutation({
    onSuccess: () => { notify(`Compte ${ROLE_LABELS[role]} créé pour ${name}.`); setName(""); setEmail(""); setPassword(""); void utils.superadmin.invalidate(); },
    onError: (error) => notify(error.data?.code === "BAD_REQUEST" ? `Vérifiez les champs (mot de passe : ${PASSWORD_MIN} caractères minimum).` : errorText(error.message), true),
  });
  const submit = (event: FormEvent) => { event.preventDefault(); create.mutate({ name, email, password, role }); };
  return <form className="kofi-adm-card kofi-sa-form" onSubmit={submit}>
    <h2><UserPlus size={18} /> Nouveau compte d’équipe</h2>
    <div className="kofi-sa-grid">
      <div className="kofi-form-group"><label htmlFor="new-name">Nom</label><input id="new-name" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={120} /></div>
      <div className="kofi-form-group"><label htmlFor="new-email">E-mail</label><input id="new-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={320} autoComplete="off" /></div>
      <div className="kofi-form-group"><label htmlFor="new-password">Mot de passe ({PASSWORD_MIN} car. min.)</label><input id="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={PASSWORD_MIN} maxLength={128} autoComplete="new-password" /></div>
      <div className="kofi-form-group"><label htmlFor="new-role">Rôle</label><select id="new-role" value={role} onChange={(event) => setRole(event.target.value as typeof role)} style={{ minHeight: 44 }}><option value="admin">Administrateur</option><option value="moderator">Modérateur</option><option value="support">Support</option></select></div>
    </div>
    <button className="kofi-button primary small" type="submit" disabled={create.isPending || password.length < PASSWORD_MIN}>{create.isPending ? "Création…" : "Créer le compte"}</button>
  </form>;
}

function TeamTab({ notify, selfId }: { notify: (message: string, isError?: boolean) => void; selfId: number }) {
  const utils = trpc.useUtils();
  const team = trpc.superadmin.team.useQuery();
  const [asking, setAsking] = useState<number | null>(null);
  const onError = (error: { message: string }) => notify(errorText(error.message), true);
  const setRole = trpc.superadmin.setRole.useMutation({ onSuccess: (result) => { notify(`Rôle mis à jour : ${ROLE_LABELS[result.role]}.`); void utils.superadmin.invalidate(); }, onError });
  const setStatus = trpc.superadmin.setStatus.useMutation({ onSuccess: (result) => { setAsking(null); notify(result.status === "suspended" ? "Compte suspendu." : "Compte réactivé."); void utils.superadmin.invalidate(); }, onError });
  return <div className="kofi-adm-stack">
    <CreateAccountForm notify={notify} />
    {team.isLoading ? <Loading /> : team.error ? <Failed onRetry={() => team.refetch()} /> : !team.data?.length ? <Empty>Aucun membre d’équipe.</Empty> : <div className="kofi-adm-list">{team.data.map((member) => {
      const active = member.status === "active";
      const editable = member.id !== selfId && canManageAccount("superadmin", member.role);
      return <div className="kofi-adm-card kofi-adm-userrow" key={member.id}>
        <div className="kofi-adm-row"><div><h3>{member.name} <span className={`kofi-adm-badge ${member.role === "superadmin" ? "orange" : active ? "green" : "red"}`}>{member.role === "superadmin" ? "Super-admin" : active ? "Actif" : "Suspendu"}</span></h3><small>{ROLE_LABELS[member.role as Role]}{member.email ? ` · ${member.email}` : ""}</small><small>Créé le {shortDate(member.createdAt)} · dernière connexion {shortDate(member.lastSignedIn)}</small></div>
          {!editable ? <span className="kofi-adm-hint">{member.id === selfId ? "C’est vous" : "Compte protégé"}</span> : <div className="kofi-adm-actions">
            <label className="kofi-adm-role"><span className="sr-only">Rôle de {member.name}</span><select value={member.role} disabled={setRole.isPending} onChange={(event) => { const next = event.target.value as Exclude<Role, "superadmin">; if (window.confirm(`Donner le rôle « ${ROLE_LABELS[next]} » à ${member.name} ?`)) setRole.mutate({ userId: member.id, role: next }); }}>{assignableRoles("superadmin").map((value) => <option key={value} value={value}>{value === "user" ? "Retirer de l’équipe (client)" : ROLE_LABELS[value]}</option>)}</select></label>
            {asking === member.id ? null : active ? <button className="kofi-button kofi-danger small" disabled={setStatus.isPending} onClick={() => setAsking(member.id)}><Ban size={14} /> Suspendre</button> : <button className="kofi-button outline small" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ userId: member.id, status: "active" })}><RefreshCcw size={14} /> Réactiver</button>}
          </div>}
        </div>
        {asking === member.id && <ReasonForm title="Motif de la suspension" suggestions={["Départ de l’équipe", "Accès compromis", "Abus de droits"]} confirmLabel="Suspendre le compte" busy={setStatus.isPending} onCancel={() => setAsking(null)} onConfirm={(reason) => setStatus.mutate({ userId: member.id, status: "suspended", reason })} />}
      </div>;
    })}</div>}
  </div>;
}

function AuditTab() {
  const log = trpc.superadmin.audit.useQuery({ limit: 300 });
  return <div className="kofi-adm-stack">
    <p className="kofi-adm-sub">Toutes les actions de l’équipe, y compris les vôtres. Le journal ne peut être ni modifié ni effacé.</p>
    {log.isLoading ? <Loading /> : log.error ? <Failed onRetry={() => log.refetch()} /> : !log.data?.length ? <Empty>Aucune action enregistrée.</Empty> : <ol className="kofi-adm-list kofi-adm-audit">{log.data.map((entry) => <li className="kofi-adm-card" key={entry.id}><div><strong>{entry.action}</strong> · {entry.target}{entry.detail && <small>Détail : {entry.detail}</small>}</div><small>{shortDate(entry.createdAt)} · {entry.actor}</small></li>)}</ol>}
  </div>;
}

export default function SuperAdminPage() {
  const auth = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [toast, setToast] = useState<{ message: string; isError: boolean } | null>(null);
  const gate = useSecondFactorGate();
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 4000); return () => clearTimeout(timer); }, [toast]);
  if (auth.loading) return <main className="kofi-container kofi-page"><Loading /></main>;
  if (!auth.isAuthenticated || !auth.user) return <SuperAdminLogin />;
  if (auth.user.role !== "superadmin" || auth.user.status === "suspended") return <Gate icon={<ShieldAlert size={28} />} title="Accès refusé">
    <p>Cet espace est réservé au super-administrateur. Votre compte n’a pas cette autorisation.</p>
    <div className="kofi-hero-actions" style={{ justifyContent: "center" }}><a className="kofi-button primary small" href="/">Retour à l’accueil</a><button className="kofi-button outline small" onClick={() => auth.logout()}>Changer de compte</button></div>
  </Gate>;
  const notify = (message: string, isError = false) => setToast({ message, isError });
  if (gate.loading) return <main className="kofi-container kofi-page"><Loading /></main>;
  if (gate.mustSetup) return <main className="kofi-container kofi-page kofi-adm"><div className="kofi-dashboard-head"><div><span className="kofi-eyebrow"><Crown size={13} /> Super-administration</span><h1>Sécurité du compte</h1></div></div><TwoFactorSetup required onDone={() => window.location.reload()} /></main>;
  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: "overview", label: "Vue d’ensemble", icon: <LayoutDashboard size={15} /> },
    { id: "team", label: "Équipe & accès", icon: <Users size={15} /> },
    { id: "audit", label: "Journal", icon: <KeyRound size={15} /> },
  ];
  const current = tabs.find((item) => item.id === tab) ?? tabs[0];
  return <main className="kofi-container kofi-page kofi-adm kofi-sa">
    <div className="kofi-dashboard-head"><div><span className="kofi-eyebrow"><Crown size={13} /> Super-administration</span><h1>{current.label}</h1></div><div className="kofi-adm-actions"><span className="kofi-status green"><Crown size={14} /> {auth.user.name || "Super-admin"}</span><button className="kofi-button outline small" onClick={() => auth.logout()}>Se déconnecter</button></div></div>
    <nav className="kofi-adm-tabs" aria-label="Sections de la super-administration">{tabs.map((item) => <button key={item.id} type="button" className={`kofi-adm-pill ${current.id === item.id ? "is-on" : ""}`} aria-current={current.id === item.id ? "page" : undefined} onClick={() => setTab(item.id)}>{item.icon} {item.label}</button>)}<a className="kofi-adm-pill" href="/admin"><ShieldCheck size={15} /> Back-office</a></nav>
    <div role="status" aria-live="polite">{toast && <div className={`kofi-adm-toast ${toast.isError ? "is-error" : ""}`}>{toast.isError ? <X size={16} /> : <Check size={16} />} {toast.message}</div>}</div>
    {current.id === "overview" && <OverviewTab />}
    {current.id === "team" && <TeamTab notify={notify} selfId={auth.user.id} />}
    {current.id === "audit" && <AuditTab />}
  </main>;
}
