import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Interface d’un prestataire de paiement Mobile Money (agrégateur).
 * Brancher un prestataire réel = écrire UN fichier qui implémente cette interface
 * (voir documentation/integrations.md), puis PAYMENT_PROVIDER=<nom> et ses clés.
 */
export type PaymentEvent = { providerReference: string; status: "succeeded" | "failed"; failureReason?: string };

export interface PaymentProvider {
  name: string;
  /** Mode test : aucune somme réelle n’est débitée. Interdit en production. */
  test: boolean;
  /** Demande de paiement : le client valide ensuite sur son téléphone (USSD / application de l’opérateur). */
  initiate(input: { amountXaf: number; phone: string; operator: "mtn" | "orange"; reference: string; description: string }): Promise<{ providerReference: string; instructions: string }>;
  /** Remboursement d’un paiement réussi. */
  refund(input: { providerReference: string; amountXaf: number; reference: string }): Promise<{ providerReference: string }>;
  /** Vérifie la signature d’un webhook et le traduit ; null si le message est invalide ou à ignorer. */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): PaymentEvent | null;
}

/** Signature HMAC-SHA256 du corps brut, en hexadécimal (en-tête `x-kofi-signature` pour le prestataire de test). */
export function sign(body: Buffer | string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifySignature(body: Buffer, signature: string | undefined, secret: string) {
  if (!signature || !secret) return false;
  const expected = Buffer.from(sign(body, secret), "hex");
  const given = Buffer.from(signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Prestataire de TEST : accepte les demandes sans rien débiter. L’issue du paiement est simulée
 * depuis l’interface (boutons « Mode test ») ou par un webhook signé avec PAYMENT_WEBHOOK_SECRET.
 */
export function testProvider(): PaymentProvider {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET ?? "kofi-test-webhook-secret";
  return {
    name: "test",
    test: true,
    async initiate() {
      return { providerReference: `TEST-${randomBytes(8).toString("hex").toUpperCase()}`, instructions: "Mode test : aucun débit réel. Simulez la réponse de l’opérateur ci-dessous." };
    },
    async refund() {
      return { providerReference: `TEST-RF-${randomBytes(8).toString("hex").toUpperCase()}` };
    },
    parseWebhook(rawBody, headers) {
      const signature = headers["x-kofi-signature"];
      if (!verifySignature(rawBody, Array.isArray(signature) ? signature[0] : signature, secret)) return null;
      try {
        const payload = JSON.parse(rawBody.toString("utf8")) as Partial<PaymentEvent>;
        if (typeof payload.providerReference !== "string" || (payload.status !== "succeeded" && payload.status !== "failed")) return null;
        return { providerReference: payload.providerReference, status: payload.status, failureReason: typeof payload.failureReason === "string" ? payload.failureReason.slice(0, 255) : undefined };
      } catch {
        return null;
      }
    },
  };
}
