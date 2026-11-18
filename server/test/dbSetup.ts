import path from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { createDatabase, type Database } from "../db";
import { seedDemo } from "../modules/demoSeed";
import { doualaDateTime } from "../modules/time";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const MONDAY = "2030-05-06";
export const TUESDAY = "2030-05-07";
export const SUNDAY = "2030-05-12";
export const NOW = doualaDateTime("2030-05-01", "12:00");
export const at = (day: string, time: string) => doualaDateTime(day, time).toISOString();

export async function openTestDb(): Promise<Database> {
  const db = createDatabase(TEST_DATABASE_URL!);
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  return db;
}

/** Vide les tables métier puis recharge le catalogue de démonstration à partir du lundi de test. */
export async function resetTestDb(db: Database) {
  for (const table of ["favorites", "staff_members", "offpeak_rules", "loyalty_ledger", "gift_cards", "payouts", "payments", "portfolio_items", "notifications", "reviews", "mobile_login_codes", "reports", "promotions", "audit_logs", "booking_events", "booking_items", "bookings", "availability_slots", "service_catalog", "professional_profiles", "users"]) {
    await db.execute(sql.raw(`DELETE FROM \`${table}\``));
  }
  await seedDemo(db, { from: doualaDateTime(MONDAY, "00:00"), days: 14 });
}
