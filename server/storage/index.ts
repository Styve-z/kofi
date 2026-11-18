import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { storagePut as manusPut } from "./manus";

export { storagePut } from "./manus";

/**
 * Stockage des fichiers envoyés (photos de réalisations). Trois pilotes, choisis par STORAGE_DRIVER :
 *  - « local » : disque du serveur (UPLOAD_DIR, servi sous /uploads) — développement et tests ;
 *  - « s3 »    : tout stockage compatible S3 (S3_BUCKET, S3_REGION, S3_ENDPOINT, S3_ACCESS_KEY_ID,
 *                S3_SECRET_ACCESS_KEY, et S3_PUBLIC_URL = adresse publique du bucket ou du CDN) ;
 *  - « manus » : stockage de la plateforme Manus (MANUS_API_URL, MANUS_API_KEY).
 * Sans réglage : « local » hors production ; en production, s3 ou manus s’ils sont configurés, sinon aucun
 * (l’envoi de photos est alors refusé avec un message clair plutôt que de perdre les fichiers).
 */
export type Storage = {
  driver: "local" | "s3" | "manus";
  put: (key: string, data: Buffer, contentType: string) => Promise<{ key: string; url: string }>;
  remove: (key: string) => Promise<void>;
};

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? "uploads");

function localStorage(): Storage {
  return {
    driver: "local",
    async put(key, data) {
      const file = path.join(UPLOAD_DIR, key);
      if (!file.startsWith(UPLOAD_DIR + path.sep)) throw new Error("INVALID_KEY");
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data);
      return { key, url: `/uploads/${key}` };
    },
    async remove(key) {
      const file = path.join(UPLOAD_DIR, key);
      if (file.startsWith(UPLOAD_DIR + path.sep)) await unlink(file).catch(() => undefined);
    },
  };
}

function s3Storage(): Storage {
  const bucket = process.env.S3_BUCKET!;
  const publicUrl = (process.env.S3_PUBLIC_URL ?? "").replace(/\/+$/, "");
  const client = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: Boolean(process.env.S3_ENDPOINT),
    credentials: process.env.S3_ACCESS_KEY_ID ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" } : undefined,
  });
  return {
    driver: "s3",
    async put(key, data, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }));
      return { key, url: `${publicUrl}/${key}` };
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined);
    },
  };
}

function manusStorage(): Storage {
  return {
    driver: "manus",
    put: (key, data, contentType) => manusPut(key, data, contentType),
    // Le stockage Manus n’expose pas de suppression : la photo n’est plus référencée ni affichée.
    remove: async () => undefined,
  };
}

let cached: Storage | null | undefined;

export function getStorage(): Storage | null {
  if (cached !== undefined) return cached;
  const driver = process.env.STORAGE_DRIVER ?? (process.env.NODE_ENV === "production" ? (process.env.S3_BUCKET ? "s3" : process.env.MANUS_API_KEY ? "manus" : "") : "local");
  cached = driver === "local" ? localStorage() : driver === "s3" && process.env.S3_BUCKET && process.env.S3_PUBLIC_URL ? s3Storage() : driver === "manus" && process.env.MANUS_API_KEY ? manusStorage() : null;
  return cached;
}

/** Pour les tests : force un pilote. */
export function setStorageForTests(storage: Storage | null) {
  cached = storage;
}
