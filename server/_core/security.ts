import type { Express } from "express";

/**
 * Durcissement HTTP et vérification de la configuration de production.
 * En production, le serveur REFUSE de démarrer si un réglage critique est dangereux
 * (secret de session faible, base en root, mode test du paiement, site sans HTTPS…).
 */

export type ConfigIssue = { level: "error" | "warning"; key: string; message: string };

export function checkProductionConfig(env: NodeJS.ProcessEnv = process.env): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const error = (key: string, message: string) => issues.push({ level: "error", key, message });
  const warn = (key: string, message: string) => issues.push({ level: "warning", key, message });

  const secret = env.MANUS_JWT_SECRET ?? "";
  if (secret.length < 32 || /^dev|test|changeme|secret/i.test(secret)) error("MANUS_JWT_SECRET", "secret de session absent, trop court (< 32 caractères) ou de développement : lancez scripts/generate-secrets.ts");
  if (!env.MANUS_PROJECT_ID) error("MANUS_PROJECT_ID", "identifiant de projet manquant");
  if (!env.TWO_FACTOR_KEY || env.TWO_FACTOR_KEY.length < 32) warn("TWO_FACTOR_KEY", "clé dédiée au chiffrement de la double vérification absente : le secret de session est utilisé à la place");

  try {
    const db = new URL(env.DATABASE_URL ?? "");
    if (!db.hostname) error("DATABASE_URL", "adresse de la base manquante");
    if (decodeURIComponent(db.username) === "root") error("DATABASE_URL", "la base est utilisée avec le compte root : créez un utilisateur dédié (voir documentation/production.md)");
    if (!db.password || db.password.length < 12) error("DATABASE_URL", "mot de passe de la base absent ou trop court (12 caractères minimum)");
  } catch {
    error("DATABASE_URL", "adresse de la base invalide");
  }

  const appUrl = env.APP_URL ?? "";
  if (!/^https:\/\//.test(appUrl)) error("APP_URL", "l’adresse publique du site doit commencer par https:// (liens des e-mails, cookies sécurisés)");

  const payment = (env.PAYMENT_PROVIDER ?? "").trim().toLowerCase();
  if (payment === "test") error("PAYMENT_PROVIDER", "le mode test du paiement est interdit en production");
  if (!payment) warn("PAYMENT_PROVIDER", "paiement en ligne désactivé");
  if (payment && (env.PAYMENT_WEBHOOK_SECRET ?? "").length < 24) error("PAYMENT_WEBHOOK_SECRET", "secret des webhooks de paiement absent ou trop court");

  if (!env.EMAIL_PROVIDER || env.EMAIL_PROVIDER === "log") warn("EMAIL_PROVIDER", "aucun service d’e-mails : confirmations, rappels et « mot de passe oublié » ne partiront pas");
  if (!env.SMS_PROVIDER || env.SMS_PROVIDER === "log") warn("SMS_PROVIDER", "aucun opérateur SMS : les SMS ne partiront pas");
  if (env.REQUIRE_STAFF_2FA === "off") warn("REQUIRE_STAFF_2FA", "ignoré en production : la double vérification reste obligatoire pour les administrateurs");
  return issues;
}

/** Au démarrage en production : affiche les avertissements et arrête le serveur en cas d’erreur. */
export function enforceProductionConfig() {
  if (process.env.NODE_ENV !== "production") return;
  const issues = checkProductionConfig();
  for (const issue of issues) console[issue.level === "error" ? "error" : "warn"](`[KOFI][config] ${issue.level === "error" ? "ERREUR" : "Attention"} ${issue.key} : ${issue.message}`);
  if (issues.some((issue) => issue.level === "error")) {
    console.error("[KOFI][config] Démarrage refusé : corrigez les erreurs ci-dessus (scripts/check-production.ts les liste aussi).");
    process.exit(1);
  }
}

/** En-têtes de sécurité. La politique de contenu (CSP) n’est appliquée qu’en production (Vite en a besoin en développement). */
export function applySecurityHeaders(app: Express) {
  const production = process.env.NODE_ENV === "production";
  // Derrière un proxy (hébergeur, Nginx) : nécessaire pour la vraie IP du client (limites d’essais) et le HTTPS.
  if (process.env.TRUST_PROXY) app.set("trust proxy", Number.isNaN(Number(process.env.TRUST_PROXY)) ? process.env.TRUST_PROXY : Number(process.env.TRUST_PROXY));
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self), payment=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    if (production) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
      res.setHeader("Content-Security-Policy", [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "manifest-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ].join("; "));
    }
    next();
  });
}
