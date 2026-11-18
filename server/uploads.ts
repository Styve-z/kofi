import express, { type Express, type Request, type Response } from "express";
import { sdk } from "./_core/sdk";
import { getDb } from "./db";
import { BUSINESS_ERRORS, BusinessError } from "./modules/errors";
import { MAX_UPLOAD_BYTES, uploadPortfolioImage } from "./modules/portfolio";
import { getStorage, UPLOAD_DIR } from "./storage";

const HTTP: Partial<Record<string, number>> = { BAD_REQUEST: 400, PAYLOAD_TOO_LARGE: 413, NOT_FOUND: 404, FORBIDDEN: 403, CONFLICT: 409, INTERNAL_SERVER_ERROR: 500 };

/**
 * Envoi binaire des photos (hors tRPC, dont les requêtes JSON sont limitées à 1 Mo).
 * POST /api/uploads/portfolio — corps : l’image brute (Content-Type image/*), en-tête X-Description facultatif.
 * Même authentification que l’API : cookie de session ou en-tête Authorization (application mobile).
 */
export function registerUploadRoutes(app: Express) {
  app.post("/api/uploads/portfolio", express.raw({ type: ["image/*", "application/octet-stream"], limit: MAX_UPLOAD_BYTES }), async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req).catch(() => null);
      if (!user) { res.status(401).json({ error: "UNAUTHORIZED" }); return; }
      if (user.status === "suspended") { res.status(403).json({ error: "ACCOUNT_SUSPENDED" }); return; }
      if (!Buffer.isBuffer(req.body) || !req.body.length) { res.status(400).json({ error: "IMAGE_INVALID" }); return; }
      const db = await getDb();
      if (!db) { res.status(500).json({ error: "DATABASE_UNAVAILABLE" }); return; }
      const rawDescription = req.header("x-description");
      const description = rawDescription ? decodeURIComponent(rawDescription) : undefined;
      res.status(201).json(await uploadPortfolioImage(db, user.id, { data: req.body, description }));
    } catch (error) {
      if (error instanceof BusinessError) { res.status(HTTP[BUSINESS_ERRORS[error.code]] ?? 400).json({ error: error.code }); return; }
      console.error("[KOFI] Échec d’envoi de photo", error);
      res.status(500).json({ error: "UNEXPECTED_ERROR" });
    }
  });
  // Trop volumineux : express.raw lève une erreur 413 avant notre code.
  app.use("/api/uploads", (error: { type?: string }, _req: Request, res: Response, next: (error?: unknown) => void) => {
    if (error?.type === "entity.too.large") { res.status(413).json({ error: "IMAGE_TOO_LARGE" }); return; }
    next(error);
  });
  // Pilote « local » : les fichiers sont servis par l’application (noms uniques, donc cache long).
  if (getStorage()?.driver === "local") {
    app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "1y", immutable: true, fallthrough: false, index: false }));
  }
}
