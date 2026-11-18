import { describe, expect, it } from "vitest";
import { hashPassword, normalizeEmail, verifyPassword } from "./passwordAuth";

describe("mots de passe", () => {
  it("ne stocke jamais le mot de passe en clair et le vérifie", async () => {
    const hash = await hashPassword("motdepasse-solide");
    expect(hash).not.toContain("motdepasse-solide");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("motdepasse-solide", hash)).toBe(true);
    expect(await verifyPassword("mauvais", hash)).toBe(false);
  });

  it("sale chaque empreinte différemment", async () => {
    expect(await hashPassword("identique")).not.toBe(await hashPassword("identique"));
  });

  it("refuse une empreinte mal formée", async () => {
    expect(await verifyPassword("x", "pas-une-empreinte")).toBe(false);
  });

  it("normalise l’e-mail", () => {
    expect(normalizeEmail("  Awa.Ngo@Example.COM ")).toBe("awa.ngo@example.com");
  });
});
