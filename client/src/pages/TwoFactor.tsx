import { Check, Copy, KeyRound, ShieldCheck, Smartphone, X } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { trpc } from "@/lib/trpc";

/** Double vérification : saisie du code à la connexion et activation depuis le compte. */

const ERRORS: Record<string, string> = {
  TWO_FACTOR_INVALID: "Code incorrect. Vérifiez l’heure de votre téléphone et réessayez.",
  TWO_FACTOR_EXPIRED: "Délai dépassé : reconnectez-vous avec votre mot de passe.",
  AUTH_RATE_LIMIT: "Trop d’essais. Réessayez dans 15 minutes.",
  TWO_FACTOR_NOT_STARTED: "Recommencez l’activation.",
};
const message = (error: { message: string } | null) => (error ? ERRORS[error.message] ?? "La vérification a échoué. Réessayez." : null);

/** Rôles soumis à la double vérification : tant qu’elle n’est pas activée, on affiche l’écran d’activation. */
export function useSecondFactorGate(enabled = true) {
  const status = trpc.auth.twoFactor.status.useQuery(undefined, { retry: false, enabled });
  return { loading: enabled && status.isLoading, mustSetup: Boolean(status.data?.required && !status.data.enabled) };
}

/** Étape 2 de la connexion : code de l’application (6 chiffres) ou code de secours. */
export function TwoFactorLoginStep({ challenge, onSuccess, onCancel }: { challenge: string; onSuccess: (home: string | null) => void; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  const verify = trpc.auth.loginTwoFactor.useMutation({ onSuccess: (result) => onSuccess(result.home) });
  const submit = (event: FormEvent) => { event.preventDefault(); verify.mutate({ challenge, code }); };
  return <form onSubmit={submit} style={{ display: "grid", gap: 14, textAlign: "left", marginTop: 22 }} noValidate>
    <p style={{ margin: 0 }}><Smartphone size={16} style={{ verticalAlign: "-3px" }} /> {backup ? "Saisissez un de vos codes de secours (format ABCD-EFGH)." : "Ouvrez votre application d’authentification et saisissez le code KOFI à 6 chiffres."}</p>
    <div className="kofi-form-group"><label htmlFor="tfa-code">{backup ? "Code de secours" : "Code à 6 chiffres"}</label>
      <input id="tfa-code" value={code} onChange={(event) => setCode(backup ? event.target.value.toUpperCase().slice(0, 9) : event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode={backup ? "text" : "numeric"} autoComplete="one-time-code" autoFocus required style={{ letterSpacing: backup ? 2 : 6, fontSize: 20, textAlign: "center" }} /></div>
    {verify.error && <div className="kofi-alert" role="alert" style={{ marginBottom: 0 }}><X size={16} /> {message(verify.error)}</div>}
    <button className="kofi-button primary" type="submit" disabled={verify.isPending || (backup ? code.length < 8 : code.length !== 6)}>{verify.isPending ? "Vérification…" : "Valider"}</button>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <button type="button" className="kofi-link-button" onClick={() => { setBackup((value) => !value); setCode(""); verify.reset(); }}>{backup ? "Utiliser l’application" : "Utiliser un code de secours"}</button>
      <button type="button" className="kofi-link-button" onClick={onCancel}>Annuler</button>
    </div>
  </form>;
}

/** Activation : ajouter KOFI dans l’application, confirmer un code, noter les codes de secours. */
export function TwoFactorSetup({ required = false, onDone }: { required?: boolean; onDone?: () => void }) {
  const utils = trpc.useUtils();
  const start = trpc.auth.twoFactor.start.useMutation();
  const confirm = trpc.auth.twoFactor.confirm.useMutation({ onSuccess: () => { void utils.auth.invalidate(); } });
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const grouped = start.data?.secret.replace(/(.{4})/g, "$1 ").trim();

  if (confirm.data) return <div className="kofi-adm-card kofi-tfa" style={{ display: "grid", gap: 14 }}>
    <h2><Check size={18} /> Double vérification activée</h2>
    <p>Notez ces <strong>codes de secours</strong> et rangez-les en lieu sûr (papier, coffre-fort de mots de passe). Chacun permet de vous connecter <strong>une seule fois</strong> si vous perdez votre téléphone. Ils ne seront plus jamais affichés.</p>
    <ul className="kofi-tfa-codes">{confirm.data.backupCodes.map((value) => <li key={value}><code>{value}</code></li>)}</ul>
    <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} /> J’ai noté mes codes de secours</label>
    <button className="kofi-button primary small" disabled={!saved} onClick={() => onDone?.()} style={{ justifySelf: "start" }}>Continuer</button>
  </div>;

  return <div className="kofi-adm-card kofi-tfa" style={{ display: "grid", gap: 14 }}>
    <h2><ShieldCheck size={18} /> {required ? "Activez la double vérification" : "Double vérification"}</h2>
    <p>{required ? "Votre rôle donne accès à des données sensibles : un code de votre téléphone est obligatoire à chaque connexion, en plus du mot de passe." : "Protégez votre compte avec un code de votre téléphone à chaque connexion."}</p>
    {!start.data ? <>
      <ol className="kofi-tfa-steps"><li>Installez une application d’authentification : Google Authenticator, Microsoft Authenticator ou Authy.</li><li>Cliquez sur « Commencer » pour obtenir votre clé KOFI.</li></ol>
      {start.error && <div className="kofi-alert" role="alert"><X size={16} /> {message(start.error)}</div>}
      <button className="kofi-button primary small" onClick={() => start.mutate()} disabled={start.isPending} style={{ justifySelf: "start" }}><KeyRound size={15} /> {start.isPending ? "Préparation…" : "Commencer"}</button>
    </> : <form onSubmit={(event) => { event.preventDefault(); confirm.mutate({ code }); }} style={{ display: "grid", gap: 14 }}>
      <ol className="kofi-tfa-steps">
        <li>Dans l’application, choisissez <strong>« Saisir une clé de configuration »</strong> (ou « Ajouter un compte » → « Clé »), nom : <strong>KOFI</strong>, type : <strong>basé sur l’heure</strong>.</li>
        <li>Copiez cette clé :
          <div className="kofi-tfa-secret"><code>{grouped}</code><button type="button" className="kofi-button outline small" onClick={() => { void navigator.clipboard?.writeText(start.data!.secret).then(() => setCopied(true)); }}><Copy size={14} /> {copied ? "Copiée" : "Copier"}</button></div>
          <small>Sur le téléphone lui-même : <a className="kofi-link" href={start.data.otpauthUrl}>ouvrir directement dans l’application</a>.</small>
        </li>
        <li>Saisissez le code à 6 chiffres affiché par l’application :</li>
      </ol>
      <input aria-label="Code à 6 chiffres" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" style={{ letterSpacing: 6, fontSize: 20, textAlign: "center", maxWidth: 220, minHeight: 44 }} />
      {confirm.error && <div className="kofi-alert" role="alert"><X size={16} /> {message(confirm.error)}</div>}
      <button className="kofi-button primary small" type="submit" disabled={confirm.isPending || code.length !== 6} style={{ justifySelf: "start" }}>{confirm.isPending ? "Vérification…" : "Activer"}</button>
    </form>}
  </div>;
}
