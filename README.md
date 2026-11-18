# KOFI — Réservation beauté au Cameroun

KOFI est une plateforme de réservation de professionnels de la beauté (coiffure, barbier, tresses, ongles, maquillage, esthétique) pensée pour le Cameroun. Les clients trouvent un salon, voient les tarifs et les créneaux libres et réservent en ligne. Les professionnels gèrent leur agenda, leur équipe et leurs offres. L’équipe KOFI modère et pilote la plateforme.

> **Version de démonstration.** Le catalogue (salons, avis, photos) est composé de données de test et les photos sont des illustrations. Le paiement Mobile Money fonctionne en **mode test** uniquement : aucune somme réelle n’est débitée tant qu’un prestataire de paiement n’est pas branché.

## Fonctionnalités

### Clients
- Recherche par texte, ville, spécialité et mode (salon / domicile). Tri par recommandation, note, prix ou nouveauté. Filtres par disponibilité (aujourd’hui, demain, jour précis, calculés sur les vrais créneaux libres), par note minimale et par offres.
- Badge **Top Rated** (note ≥ 4,5 sur au moins 3 avis) et prix « Dès X FCFA ».
- Profil du salon : prestations, choix du **collaborateur** (ou « peu importe »), créneaux avec remises **heures creuses**, avis et photos.
- Réservation avec code promo, **points de fidélité** et **carte cadeau**. Annulation, **déplacement d’un rendez-vous** et avis après la prestation.
- **Favoris**, **fidélité** (1 point par tranche de 100 FCFA ; 100 points = 500 FCFA, jusqu’à 50 % du prix), **cartes cadeaux** de 5 000 à 200 000 FCFA valables 1 an, notifications et **Aide / FAQ**.

### Professionnels
- Tableau de bord, demandes à traiter, agenda, historique et revenus.
- Prestations, horaires et congés, **équipe** (agenda propre à chaque collaborateur), **heures creuses** (−5 à −50 % par jour et plage horaire), photos et réponses aux avis.

### Équipe KOFI
| Rôle | Accès |
| --- | --- |
| Support | Réservations et signalements ; lecture du reste |
| Modérateur | Validation des professionnels, suspensions, avis, photos |
| Administrateur | Tout le back-office `/admin` : paiements, codes promo, nomination des agents de support et des modérateurs |
| Super-administrateur | Espace `/superadmin` : création et retrait des administrateurs, suspension de tout compte, journal complet. Ce rôle ne s’attribue que par script et ne peut être ni modifié ni suspendu depuis le site. Sa session dure 12 h. |

Chaque type de compte (visiteur, client, professionnel, équipe, super-admin) a son propre menu. Le serveur revérifie le rôle à chaque appel : masquer un lien n’est jamais la seule protection. Les administrateurs et le super-administrateur doivent activer la **double vérification** (code d’une application d’authentification, 8 codes de secours) : sans elle, le back-office reste fermé.

### Comptes et messages
- **Mot de passe oublié :** lien envoyé par e-mail, valable 1 h et à usage unique. Les sessions ouvertes avant le changement sont coupées.
- **Vérification de l’adresse e-mail à l’inscription :** les e-mails ne partent que vers une adresse vérifiée.
- **E-mails et SMS automatiques :** demande envoyée, confirmation, refus, annulation, paiements, et **rappel la veille** du rendez-vous. Ils passent par une file d’envoi avec nouvelles tentatives.
- **Mes données :** téléchargement de toutes ses données et suppression du compte (les rendez-vous passés sont conservés, anonymisés).
- **Pages légales :** CGU, confidentialité et mentions légales (`/cgu`, `/confidentialite`, `/mentions-legales`), en version de travail à faire valider.

## Stack

- **Web :** React 19, Vite 7, TypeScript, Wouter, Three.js pour l’effet 3D de la page d’accueil. Le site est installable (PWA).
- **Serveur :** Express, tRPC 11 et Drizzle ORM sur MySQL 8. Les sessions sont des cookies JWT signés.
- **Connexion :** e-mail + mot de passe. Les mots de passe sont stockés sous forme d’empreinte scrypt salée, et les essais ratés sont limités. Manus OAuth reste disponible s’il est configuré.
- **Tests :** Vitest, dont des suites sur une vraie base MySQL. **Mobile :** application Expo dans `apps/mobile`.

## Installation

Prérequis : Node.js 22, pnpm 10 et MySQL 8.

```bash
pnpm install
cp .env.example .env      # puis renseigner DATABASE_URL, MANUS_JWT_SECRET, MANUS_PROJECT_ID
pnpm db:migrate           # crée les tables
pnpm db:seed              # catalogue de démonstration (refusé en production sans --force)
pnpm exec tsx scripts/create-accounts.ts   # comptes super-admin, admin, client et pro de démo
```

Le script de comptes tire des mots de passe au hasard et les écrit **uniquement** dans `COMPTES-KOFI.local.md`, un fichier ignoré par Git. Pour changer un mot de passe :

```bash
pnpm exec tsx scripts/set-password.ts <email> "<nouveau mot de passe>"
```

## Lancer le site

```bash
pnpm dev          # macOS / Linux
```

Sous Windows (PowerShell) :

```powershell
$env:NODE_ENV='development'; pnpm exec tsx watch server/_core/index.ts
```

Le site s’ouvre sur http://localhost:3000. Pages utiles : `/connexion`, `/professionnel`, `/admin` et `/superadmin`.

## Paiement (Mobile Money)

Le paiement se règle sans toucher au code, par variables d’environnement :

| Variable | Rôle |
| --- | --- |
| `PAYMENT_PROVIDER` | vide = désactivé ; `test` = mode test (refusé en production) ; sinon nom d’un prestataire réel |
| `PAYMENT_WEBHOOK_SECRET` | secret de signature des webhooks |
| `PAYMENT_MODE` | `full` (paiement complet) ou `deposit` (acompte) |
| `PAYMENT_DEPOSIT_PERCENT`, `PAYMENT_FREE_CANCEL_HOURS`, `KOFI_COMMISSION_PERCENT` | acompte, délai d’annulation gratuite et commission |

En mode test, des boutons simulent la réponse de l’opérateur : côté client pour les paiements, dans le back-office pour les paiements et les remboursements. Seul un webhook signé (`POST /api/payments/webhook/:provider`) peut valider un paiement réel. Brancher un vrai prestataire revient à écrire un adaptateur dans `server/modules/payments/` (voir `documentation/integrations.md`).

## Tests et qualité

```bash
pnpm check                                   # TypeScript
pnpm test                                    # tests unitaires
TEST_DATABASE_URL=mysql://…/kofi_test pnpm test   # + suites sur base réelle (base vidée à chaque lancement)
pnpm build                                   # build de production
```

La CI GitHub Actions lance l’installation, `check`, `test` et `build` à chaque envoi.

## Structure

```text
client/src/pages/     Kofi.tsx (site public et client), Features.tsx (favoris, fidélité, cartes cadeaux, aide),
                      Pro.tsx (espace pro), Admin.tsx (back-office), SuperAdmin.tsx (super-administration)
server/modules/       logique métier : booking, catalog, staff, offpeak, loyalty, giftcards, favorites,
                      payments/, admin, superadmin, passwordAuth, reviews, portfolio…
server/routers.ts     toutes les procédures tRPC et leurs contrôles d’accès
shared/permissions.ts rôles et permissions (partagés client / serveur)
drizzle/              schéma et migrations SQL
scripts/              seed de démo, création de comptes, changement de mot de passe
apps/mobile/          application Expo
documentation/        architecture, API, intégrations, déploiement
```

## E-mails et SMS

Sans réglage (`EMAIL_PROVIDER` / `SMS_PROVIDER` vides), rien n’est envoyé : chaque message est écrit dans le dossier `outbox/`, ignoré par Git, pour être relu pendant le développement. Brancher un vrai service revient à écrire un adaptateur dans `server/modules/mailer.ts` ou `server/modules/sms.ts`.

## Mise en production

Le guide complet est dans [`documentation/production.md`](documentation/production.md) : Docker, HTTPS, utilisateur MySQL dédié, sauvegardes et premiers comptes.

```bash
pnpm exec tsx scripts/generate-secrets.ts              # secrets forts
pnpm exec tsx scripts/check-production.ts prod.env     # vérifie la configuration
```

En production, le serveur **refuse de démarrer** si la configuration est dangereuse : secret faible, base en `root`, site sans HTTPS ou paiement en mode test. Il ajoute lui-même les en-têtes de sécurité (CSP, HSTS…).

Il reste à choisir l’hébergement, le nom de domaine et les prestataires réels de paiement, d’e-mails et de SMS, et à faire valider les textes légaux. L’état détaillé est suivi dans `documentation/release-status.md` et `TODO.md`.

## Sécurité

Aucun secret n’est versionné : `.env`, `COMPTES-KOFI.local.md` et les journaux locaux sont ignorés par Git. Pour signaler une faille, ouvrez une issue sans détail exploitable et demandez un contact privé.

## Licence

MIT (voir `package.json`).
