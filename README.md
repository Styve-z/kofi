# KOFI — Réservation de coiffure au Cameroun

KOFI est une plateforme de découverte et de réservation de professionnels de la coiffure, pensée pour réduire les appels, rendre les tarifs lisibles et exposer les disponibilités. Cette livraison constitue un MVP de démonstration testable : recherche, filtres, profils, sélection de plusieurs prestations, créneau, demande de réservation, annulation, schéma backend, CI, documentation et base de reprise mobile. Le catalogue et les réservations sont enregistrés en base (MySQL/MariaDB) avec contrôle transactionnel des chevauchements ; l’interface web lit catalogue, créneaux libres et réservations depuis l’API.

> **Important — mode démonstration.** Le catalogue visible dans l’interface est explicitement composé de données de test. Aucune photo aléatoire n’est présentée comme une réalisation réelle et aucun paiement réel n’est simulé.

## Stack

Le web utilise React 19, Vite, TypeScript, Tailwind CSS et Wouter. Le serveur utilise Express, tRPC et Drizzle ORM. La base du starter est MySQL-compatible et peut être remplacée par PostgreSQL avec adaptation du driver et des enums ; la logique métier reste derrière les contrats tRPC. Les tests utilisent Vitest. Les dépendances sont verrouillées par pnpm 10.18.0.

L’authentification conserve Manus OAuth par défaut, conformément au starter sécurisé. Elle s’appuie sur la session `webdev_app_session`, le JWT de projet et les rôles serveur. Il n’y a pas de compte email/mot de passe inventé. Les secrets ne doivent jamais être ajoutés au dépôt.

## Structure

```text
KOFI/
├── apps/mobile/           # Application Expo (Android / iOS)
├── client/                # Application web React/Vite
│   ├── public/            # manifeste de routes et assets statiques
│   └── src/               # écrans, design system et catalogue de démonstration
├── server/                # Express, tRPC, auth et services métier
│   └── modules/           # catalogue et réservation anti-chevauchement
├── drizzle/               # schéma et migrations SQL
├── database/seeds/        # seed de démonstration séparé
├── documentation/         # architecture, API, guides, déploiement, coûts
├── infrastructure/       # Docker Compose d’exemple et notes d’exploitation
├── scripts/               # procédures de sauvegarde et migration
├── server/**/*.test.ts    # suites métier, auth et sécurité ; tests UI/API transverses à ajouter
├── .github/workflows/     # contrôle continu
└── plan.md / TODO.md      # décisions et suivi d’avancement
```

## Installation

Prérequis : Node.js 22, Corepack et pnpm 10.18.0.

```bash
corepack enable
corepack prepare pnpm@10.18.0 --activate
pnpm install
cp .env.example .env
```

Renseigner ensuite les variables utiles à l’environnement. `DATABASE_URL` est nécessaire pour les migrations et les fonctions persistées. Les clés Stripe, SMS, email, cartographie et stockage sont volontairement vides : elles doivent être obtenues auprès des prestataires choisis et ajoutées par secret manager, jamais dans Git.

## Développement et qualité

```bash
pnpm dev        # Express + Vite, PORT fourni par l’environnement ou 3000
pnpm check      # TypeScript sans émission
pnpm test       # Vitest (ajouter TEST_DATABASE_URL pour les tests sur base réelle)
pnpm build      # Vite puis bundle Express
pnpm start      # serveur de production après build
```

La CI GitHub Actions exécute `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm test` et `pnpm build` sur les branches `main`, `develop` et les pull requests vers `main`. Une version ne doit pas être déployée si l’un de ces contrôles échoue.

## Performance et données mobiles

Le shell HTML affiche immédiatement un état de chargement, les polices externes ont été retirées, le CSS global inutilisé a été supprimé et les assets fingerprintés sont mis en cache un an en production. Le bundle initial mesuré passe d’environ 583 Ko bruts à 379 Ko bruts ; le détail, les limites et les méthodes de mesure sont documentés dans [`documentation/performance.md`](documentation/performance.md). Les scores LCP/INP/CLS ne sont pas inventés : ils nécessitent encore un outil Web Vitals reproductible.

## Base de données

Le schéma métier se trouve dans `drizzle/schema.ts`. La migration additive `drizzle/0001_kofi_core.sql` crée les profils professionnels, prestations, disponibilités, réservations, éléments de réservation, historique, portfolios, promotions et audit logs sans supprimer la table `users` existante.

```bash
pnpm db:migrate  # applique les migrations déjà commitées
pnpm db:push     # génère puis applique une évolution après revue
```

`pnpm db:seed` charge le catalogue de démonstration (4 professionnels, 12 prestations, 60 jours d’horaires). Il est idempotent et refuse de tourner en production sans `--force`. La base gérée de développement et celle de publication peuvent partager des données : ne pas lancer de seed ou de suppression destructive sans sauvegarde et validation.

## Fonctionnalités livrées

Le parcours web permet de rechercher par texte, ville, spécialité, quartier, mode et budget, de trier par note ou popularité, d’ouvrir un profil, de sélectionner plusieurs prestations et de créer une demande via `booking.create` avec référence unique, durée, total, fuseau et statut « en attente ». Une connexion est requise avant l’enregistrement ; le brouillon est conservé localement pendant le retour OAuth. Les annulations demandent une confirmation et appellent `booking.cancel`. Le service serveur refuse deux réservations qui se chevauchent pour un même professionnel et protège les réservations confirmées dans sa logique métier.

Les écrans professionnel et administrateur sont structurés avec métriques, planning, validation, modération et journal d’audit explicitement signalés comme maquettes tant que les comptes et permissions réels ne sont pas branchés. Les états chargement, vide, erreur, succès, réservation en attente, connexion et absence de paiement sont visibles dans l’interface.

## API

Les procédures tRPC sont documentées dans `documentation/api.md`. Les principales sont `catalog.search`, `catalog.professional`, `booking.create`, `booking.mine`, `booking.cancel` et `admin.overview`. L’autorisation est côté serveur : la procédure admin exige le rôle `admin`, et les procédures de réservation exigent une session. L’espace professionnel (`/professionnel`) et le back-office (`/admin`) sont chargés à la demande. `catalog.slots` renvoie les créneaux libres d’un jour. Les réservations sont persistées dans une transaction qui verrouille le professionnel. L’interface web n’a plus de données locales : catalogue, créneaux et historique viennent de l’API, et le brouillon de réservation ne garde que des identifiants pendant la connexion.

## Site installable et hors connexion

Le site est une PWA : on peut l’ajouter à l’écran d’accueil, et il s’ouvre sans réseau avec les profils déjà consultés (`client/public/sw.js`). Créneaux, réservations et données de compte ne sont jamais servis depuis le cache.

## Mobile, paiements et services externes

`apps/mobile` contient l’application Expo (SDK 57) branchée sur la même API : voir `apps/mobile/README.md` pour la lancer avec Expo Go et la publier avec EAS. Les builds Android/iOS ne sont pas prétendus produits dans cette livraison : ils nécessitent les comptes Expo, Google Play Console et Apple Developer. Le paiement Mobile Money/carte, SMS, email transactionnel, cartographie, stockage objet et monitoring nécessitent des prestataires, contrats et secrets réels. Aucun service payant n’a été souscrit.

## Sauvegarde, restauration et déploiement

Le Dockerfile construit `dist/public` et `dist/index.js` sur Node 22. `infrastructure/docker-compose.example.yml` fournit un MySQL local de développement. Les commandes de sauvegarde/restauration sont décrites dans `scripts/README.md` et `documentation/deployment.md` ; tester toute restauration dans un environnement isolé. Pour la production, choisir l’hébergement frontend/backend, la base managée, le stockage image, le domaine HTTPS, le monitoring et les notifications, puis renseigner les secrets via le gestionnaire de l’environnement.

Avant mise en ligne : valider juridiquement les pages légales, connecter le paiement réel avec webhooks idempotents, activer l’upload modéré des portfolios, brancher notifications et cartographie, activer les comptes professionnels/admin, lancer une base de test isolée et obtenir les certificats développeur mobile. L’état détaillé est tenu dans `documentation/release-status.md` et `TODO.md`.

## Licence et reprise

Le dépôt est autonome et sous licence MIT dans son `package.json`. Un autre développeur peut reprendre le code avec les commandes ci-dessus sans dépendre d’une plateforme propriétaire, à l’exception des services explicitement documentés comme intégrations à configurer (OAuth de projet, base gérée éventuelle et stockage objet).
