import { RefreshCcw, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";

/** Composants partagés entre le back-office et l’espace professionnel. */

export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(timer); }, [value, delay]);
  return debounced;
}

/** Saisie d’un motif obligatoire, avec suggestions, avant une action sensible. */
export function ReasonForm({ title, suggestions, confirmLabel, busy, onConfirm, onCancel }: { title: string; suggestions: string[]; confirmLabel: string; busy: boolean; onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const submit = (event: FormEvent) => { event.preventDefault(); onConfirm(reason.trim()); };
  return <form className="kofi-adm-reason" onSubmit={submit}>
    <label><span>{title}</span><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motif visible dans le journal d’audit" autoFocus maxLength={255} /></label>
    <div className="kofi-adm-chips">{suggestions.map((item) => <button type="button" key={item} className="kofi-chip" onClick={() => setReason(item)}>{item}</button>)}</div>
    <div className="kofi-adm-actions"><button type="submit" className="kofi-button primary small" disabled={busy || reason.trim().length < 3}>{busy ? "Enregistrement…" : confirmLabel}</button><button type="button" className="kofi-button outline small" onClick={onCancel}>Annuler</button></div>
  </form>;
}

export function Pills<T extends string>({ value, options, onChange, label }: { value: T | "all"; options: { value: T | "all"; label: string; count?: number }[]; onChange: (value: T | "all") => void; label: string }) {
  return <div className="kofi-adm-pills" role="group" aria-label={label}>{options.map((option) => <button key={option.value} type="button" className={`kofi-adm-pill ${value === option.value ? "is-on" : ""}`} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}{option.count !== undefined && <span>{option.count}</span>}</button>)}</div>;
}

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="kofi-adm-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Rechercher</span><input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

export function Loading() { return <div className="kofi-loading" role="status"><RefreshCcw className="kofi-spinner" size={20} /> Chargement…</div>; }
export function Failed({ onRetry }: { onRetry: () => void }) { return <div className="kofi-alert" role="alert"><X size={16} /> <span>Impossible de charger les données. <button className="kofi-link" onClick={onRetry}>Réessayer</button></span></div>; }
export function Empty({ children }: { children: ReactNode }) { return <p className="kofi-adm-empty">{children}</p>; }

