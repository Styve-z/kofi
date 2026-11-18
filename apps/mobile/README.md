# KOFI — application mobile (Expo)

Application Android / iOS branchée sur la même API que le site : recherche, profils, créneaux réels en heure de Douala, réservation (code promo compris), suivi et annulation des réservations, connexion sécurisée.

- **Expo SDK 57** (Expo Router). La SDK 57 est retenue pour pouvoir tester avec l’application **Expo Go** sur un vrai téléphone pendant la transition vers la SDK 58.
- Les types de l’API sont importés du serveur (`server/routers.ts`) : toute modification de l’API qui casse l’app est détectée par `npm run typecheck`. Le dépôt racine doit donc avoir ses dépendances installées (`pnpm install` à la racine).

## Lancer sur un téléphone avec Expo Go

```bash
pnpm install                 # à la racine du dépôt (types partagés)
cd apps/mobile
npm install
EXPO_PUBLIC_API_URL=https://votre-domaine-kofi npx expo start
```

Scannez le QR code avec Expo Go (Android) ou l’appareil photo (iPhone). Pour viser un serveur lancé sur votre ordinateur, utilisez son adresse IP sur le réseau local (ex. `http://192.168.1.20:3000`), jamais `localhost`.

## Connexion

L’app n’a pas de mot de passe à elle. « Se connecter » ouvre la page `/connexion-app` du site ; après la connexion KOFI habituelle, le site renvoie vers l’app un code à usage unique (5 minutes), que l’app échange avec un secret qu’elle seule connaît contre un jeton de session de 30 jours, rangé dans le stockage chiffré du téléphone (Keychain / Keystore). Détails : `server/modules/mobileAuth.ts`.

## Publication (Play Store / App Store)

1. Remplacez les identifiants `cm.kofi.app` dans `app.json` (`android.package`, `ios.bundleIdentifier`) par ceux de votre organisation.
2. Créez un compte Expo, puis : `npx eas-cli@latest build --platform android` (fichier AAB pour Google Play) et `--platform ios` (nécessite un compte Apple Developer).
3. Définissez `EXPO_PUBLIC_API_URL` dans les variables d’environnement EAS.

## Vérifications

```bash
npm run typecheck            # types, contre l’API réelle du serveur
npm run export:web           # version web, utile pour tester dans un navigateur
```

Pour tester la version web contre un serveur local, autorisez son adresse côté serveur : `CORS_ORIGINS=http://localhost:8081`.
