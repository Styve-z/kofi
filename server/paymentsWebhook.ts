import express, { type Express } from "express";
import { getDb } from "./db";
import { getPaymentProvider } from "./modules/payments/config";
import { applyPaymentEvent } from "./modules/payments/index";

/**
 * Webhook du prestataire de paiement : POST /api/payments/webhook/:provider.
 * Le corps brut est conservé pour vérifier la signature. Un message invalide reçoit 400 ;
 * un événement déjà traité reçoit 200 (le prestataire arrête alors de le renvoyer).
 * À enregistrer AVANT express.json(), qui consommerait le corps.
 */
export function registerPaymentWebhook(app: Express) {
  app.post("/api/payments/webhook/:provider", express.raw({ type: "*/*", limit: "256kb" }), async (req, res) => {
    const provider = getPaymentProvider();
    if (!provider || provider.name !== req.params.provider) { res.status(404).json({ error: "UNKNOWN_PROVIDER" }); return; }
    const event = provider.parseWebhook(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), req.headers);
    if (!event) { res.status(400).json({ error: "INVALID_SIGNATURE_OR_PAYLOAD" }); return; }
    const db = await getDb();
    if (!db) { res.status(503).json({ error: "DATABASE_UNAVAILABLE" }); return; }
    try {
      const result = await applyPaymentEvent(db, event);
      res.status(200).json(result);
    } catch (error) {
      console.error("[KOFI] Webhook de paiement en échec", error);
      res.status(500).json({ error: "UNEXPECTED_ERROR" });
    }
  });
}
