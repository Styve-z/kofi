import type { CookieOptions, Request } from "express";

export function getSessionCookieOptions(req: Request): CookieOptions {
  // Développement local en http (localhost ou adresse du réseau) : un cookie « Secure » serait refusé
  // hors localhost, donc on utilise un cookie Lax classique.
  if (process.env.NODE_ENV === "development" && !isHttps(req)) return { httpOnly: true, path: "/", sameSite: "lax", secure: false };
  // Preview is public HTTPS in a cross-site frame even when the upstream request is HTTP.
  return { httpOnly: true, path: "/", sameSite: "none", secure: true };
}

function isHttps(req: Request) {
  if (req.protocol === "https") return true;
  const forwarded = req.headers?.["x-forwarded-proto"];
  const proto = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return typeof proto === "string" && proto.split(",")[0].trim() === "https";
}
