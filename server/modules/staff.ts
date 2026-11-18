import { and, asc, eq, inArray } from "drizzle-orm";
import { professionalProfiles, staffMembers } from "../../drizzle/schema";
import type { Database } from "../db";
import { BusinessError } from "./errors";
import { overlaps } from "./time";

/**
 * Équipe d’un salon. Sans équipe déclarée, le professionnel a un seul agenda (comportement d’origine).
 * Avec une équipe, chaque collaborateur actif a son agenda : deux rendez-vous peuvent avoir lieu en même
 * temps avec deux personnes différentes. Une ancienne réservation sans collaborateur bloque toute l’équipe.
 */
export type StaffMember = { id: number; name: string; title: string | null };

export async function activeStaff(db: Pick<Database, "select">, professionalId: number): Promise<StaffMember[]> {
  return db.select({ id: staffMembers.id, name: staffMembers.name, title: staffMembers.title }).from(staffMembers).where(and(eq(staffMembers.professionalId, professionalId), eq(staffMembers.isActive, 1))).orderBy(asc(staffMembers.name));
}

export async function staffByProfessional(db: Pick<Database, "select">, professionalIds: number[]) {
  const map = new Map<number, StaffMember[]>();
  if (!professionalIds.length) return map;
  const rows = await db.select().from(staffMembers).where(and(inArray(staffMembers.professionalId, professionalIds), eq(staffMembers.isActive, 1))).orderBy(asc(staffMembers.name));
  for (const row of rows) map.set(row.professionalId, [...(map.get(row.professionalId) ?? []), { id: row.id, name: row.name, title: row.title }]);
  return map;
}

type Busy = { startsAt: Date; endsAt: Date; staffMemberId: number | null };

/**
 * Collaborateurs libres sur [start, end[ parmi les candidats, compte tenu des réservations actives.
 * Sans équipe (candidats vides) : renvoie [null] si l’agenda unique est libre, [] sinon.
 */
export function freeStaffFor(candidates: number[], busy: Busy[], start: number, end: number): (number | null)[] {
  const overlapping = busy.filter((item) => overlaps(start, end, item.startsAt.getTime(), item.endsAt.getTime()));
  if (!candidates.length) return overlapping.length ? [] : [null];
  if (overlapping.some((item) => item.staffMemberId === null)) return [];
  return candidates.filter((id) => !overlapping.some((item) => item.staffMemberId === id));
}

/** Vérifie le collaborateur demandé et renvoie la liste des candidats possibles pour ce professionnel. */
export async function staffCandidates(db: Pick<Database, "select">, professionalId: number, requested?: number | null) {
  const staff = await activeStaff(db, professionalId);
  if (!staff.length) {
    if (requested) throw new BusinessError("STAFF_NOT_FOUND");
    return { staff, candidates: [] as number[] };
  }
  if (requested) {
    if (!staff.some((member) => member.id === requested)) throw new BusinessError("STAFF_NOT_FOUND");
    return { staff, candidates: [requested] };
  }
  return { staff, candidates: staff.map((member) => member.id) };
}

async function myProfileId(db: Database, userId: number) {
  const [profile] = await db.select({ id: professionalProfiles.id }).from(professionalProfiles).where(eq(professionalProfiles.ownerUserId, userId)).limit(1);
  if (!profile) throw new BusinessError("NO_PROFESSIONAL_PROFILE");
  return profile.id;
}

export async function listMyStaff(db: Database, userId: number) {
  const id = await myProfileId(db, userId);
  const rows = await db.select().from(staffMembers).where(eq(staffMembers.professionalId, id)).orderBy(asc(staffMembers.name));
  return rows.map((row) => ({ id: row.id, name: row.name, title: row.title, active: row.isActive === 1 }));
}

export async function saveStaffMember(db: Database, userId: number, input: { id?: number; name: string; title?: string }) {
  const id = await myProfileId(db, userId);
  const name = input.name.trim();
  const title = input.title?.trim() || null;
  if (name.length < 2 || name.length > 120 || (title && title.length > 120)) throw new BusinessError("STAFF_INVALID");
  if (input.id) {
    await db.update(staffMembers).set({ name, title }).where(and(eq(staffMembers.id, input.id), eq(staffMembers.professionalId, id)));
    return { id: input.id };
  }
  const existing = await db.select({ id: staffMembers.id }).from(staffMembers).where(eq(staffMembers.professionalId, id));
  if (existing.length >= 30) throw new BusinessError("STAFF_INVALID");
  const [inserted] = await db.insert(staffMembers).values({ professionalId: id, name, title }).$returningId();
  return { id: inserted.id };
}

export async function setStaffActive(db: Database, userId: number, input: { id: number; active: boolean }) {
  const id = await myProfileId(db, userId);
  await db.update(staffMembers).set({ isActive: input.active ? 1 : 0 }).where(and(eq(staffMembers.id, input.id), eq(staffMembers.professionalId, id)));
  return { ok: true as const };
}
