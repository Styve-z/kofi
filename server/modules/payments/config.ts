import { testProvider, type PaymentProvider } from "./provider";

/**
 * Réglages du paiement (variables d’environnement, aucune modification de code) :
 *  PAYMENT_PROVIDER          vide = paiement désactivé ; « test » = mode test (refusé en production) ;
 *                            sinon le nom d’un prestataire réel enregistré ci-dessous.
 *  PAYMENT_MODE              « full » (défaut) = paiement complet ; « deposit » = acompte.
 *  PAYMENT_DEPOSIT_PERCENT   pourcentage de l’acompte (défaut 30).
 *  PAYMENT_FREE_CANCEL_HOURS annulation gratuite par le client jusqu’à N heures avant (défaut 24).
 *  KOFI_COMMISSION_PERCENT   commission KOFI sur les montants encaissés (défaut 10).
 */
export type PaymentSettings = { enabled: boolean; testMode: boolean; mode: "full" | "deposit"; depositPercent: number; freeCancelHours: number; commissionPercent: number };

const clampInt = (value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

/** Prestataires réels disponibles. Ajouter ici l’adaptateur du prestataire choisi. */
const REAL_PROVIDERS: Record<string, () => PaymentProvider> = {};

let override: PaymentProvider | null | undefined;

export function getPaymentProvider(): PaymentProvider | null {
  if (override !== undefined) return override;
  const name = (process.env.PAYMENT_PROVIDER ?? "").trim().toLowerCase();
  if (!name) return null;
  if (name === "test") {
    if (process.env.NODE_ENV === "production") {
      console.error("[KOFI] PAYMENT_PROVIDER=test est interdit en production : paiement désactivé.");
      return null;
    }
    return testProvider();
  }
  const factory = REAL_PROVIDERS[name];
  if (!factory) console.error(`[KOFI] Prestataire de paiement inconnu : ${name}. Paiement désactivé.`);
  return factory ? factory() : null;
}

export function getPaymentSettings(): PaymentSettings {
  const provider = getPaymentProvider();
  return {
    enabled: Boolean(provider),
    testMode: Boolean(provider?.test),
    mode: process.env.PAYMENT_MODE === "deposit" ? "deposit" : "full",
    depositPercent: clampInt(process.env.PAYMENT_DEPOSIT_PERCENT, 30, 10, 90),
    freeCancelHours: clampInt(process.env.PAYMENT_FREE_CANCEL_HOURS, 24, 0, 168),
    commissionPercent: clampInt(process.env.KOFI_COMMISSION_PERCENT, 10, 0, 50),
  };
}

/** Montant à payer pour une réservation confirmée (acompte arrondi aux 50 FCFA supérieurs). */
export function amountDue(totalXaf: number, settings = getPaymentSettings()) {
  if (settings.mode === "full") return totalXaf;
  return Math.min(totalXaf, Math.ceil((totalXaf * settings.depositPercent) / 100 / 50) * 50);
}

export const commissionFor = (amountPaidXaf: number, settings = getPaymentSettings()) => Math.round((amountPaidXaf * settings.commissionPercent) / 100);

/** Pour les tests : force un prestataire (null = désactivé ; undefined = réglages normaux). */
export function setPaymentProviderForTests(provider: PaymentProvider | null | undefined) {
  override = provider;
}
