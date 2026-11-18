# Intégrations à brancher (préparées, non simulées)

Ces services exigent un compte, un contrat et des clés chez un prestataire. KOFI n’affiche aucune fausse transaction ni aucune fausse photo en attendant : le paiement est indiqué « non connecté » partout, et les profils n’ont pas de portfolio.

## 1. Paiement Mobile Money (MTN MoMo, Orange Money)

**Ce qui est en place.** Tout le circuit est codé et testé avec un prestataire de **test** (`PAYMENT_PROVIDER=test`, refusé en production) :

- le client paie **après l’acceptation** par le professionnel, depuis « Mes réservations » (site et application) : choix MTN ou Orange, numéro, puis validation sur son téléphone ;
- le montant est relu en base (remise comprise) ; acompte possible (`PAYMENT_MODE=deposit`, `PAYMENT_DEPOSIT_PERCENT`) ;
- un paiement ne passe à « réussi » que par l’**événement signé** du prestataire (`POST /api/payments/webhook/<prestataire>`), traité **une seule fois** même s’il arrive plusieurs fois en même temps ;
- annulation gratuite par le client jusqu’à `PAYMENT_FREE_CANCEL_HOURS` (24 h) avant ; toute réservation payée puis annulée ou refusée (par le client, le pro ou KOFI) est **remboursée intégralement**, y compris un paiement reçu après l’annulation ;
- la commission KOFI (`KOFI_COMMISSION_PERCENT`, 10 %) est figée à la fin du rendez-vous ; le pro voit son solde (onglet Revenus) ; le super-administrateur enregistre les reversements faits (onglet Paiements), plafonnés au solde.

**Ce qu’il reste : un seul fichier.** Après le choix d’un agrégateur couvrant MTN et Orange au Cameroun (par exemple Smobilpay, Notch Pay, Campay ou CamooPay — comparer frais, délai de reversement, fiabilité de l’API, remboursements) :

1. créer `server/modules/payments/<prestataire>.ts` qui implémente l’interface `PaymentProvider` de `server/modules/payments/provider.ts` : `initiate` (demande de paiement), `refund` (remboursement), `parseWebhook` (vérification de la signature du prestataire et traduction en `{ providerReference, status }`) ;
2. l’enregistrer dans `REAL_PROVIDERS` de `server/modules/payments/config.ts` ;
3. déclarer l’URL `https://<domaine>/api/payments/webhook/<prestataire>` dans le tableau de bord du prestataire, puis définir `PAYMENT_PROVIDER=<prestataire>` et ses clés dans le gestionnaire de secrets.

Les tests de `server/modules/payments.db.test.ts` restent valables : ils décrivent ce que l’adaptateur doit permettre. Faire un premier paiement réel de faible montant, puis son remboursement, avant l’ouverture.

## 2. Photos de réalisations (portfolio)

**En place.** Le professionnel envoie jusqu’à 12 photos (onglet Photos). Le navigateur les réduit avant l’envoi ; le serveur vérifie qu’il s’agit d’une vraie image, applique l’orientation, **supprime les métadonnées (dont la position GPS)** et produit une image WebP de 1200 px et une miniature de 400 px. Une photo n’est publique qu’après validation par un modérateur (onglet Photos du back-office) ; le pro est prévenu.

**Pour la production**, choisir le stockage : `STORAGE_DRIVER=s3` avec `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT` (si autre qu’AWS), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` et `S3_PUBLIC_URL` (adresse publique du bucket ou du CDN), ou `STORAGE_DRIVER=manus` sur la plateforme Manus. Le pilote `local` (disque du serveur) ne convient qu’au développement ou à un serveur unique sauvegardé.

## 3. Notifications SMS / WhatsApp

Les notifications existent déjà dans le site et l’app : chaque événement écrit une ligne dans la table `notifications`, dans la même transaction que l’action. Pour les SMS/WhatsApp, ajouter une tâche qui lit les nouvelles lignes (colonne `smsSentAt` à créer), envoie par le prestataire choisi, et enregistre le résultat ; ajouter le rappel de la veille (tâche planifiée sur les réservations confirmées du lendemain). Le numéro client est déjà normalisé au format `+237…` ; celui du professionnel est à ajouter à son profil.
