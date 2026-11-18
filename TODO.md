# Suivi KOFI

## Développé

- [x] Shell web responsive, navigation, design system « atelier solaire », états chargement/vide/erreur/succès et manifeste de routes.
- [x] Optimisation initiale : shell HTML anti-page-blanche, retrait des polices externes, réduction du CSS global, providers UI inutilisés retirés, cache des assets fingerprintés et payloads serveur limités ; mesures consignées dans `documentation/performance.md`.
- [x] Recherche par texte, ville, type de prestation, mode salon/domicile, prix, note et disponibilité ; filtres combinables et tris principaux.
- [x] Fiches professionnelles avec tarifs, durée, mode de prestation, disponibilité, badge de vérification et avertissement explicite sur les données de démonstration.
- [x] Panier de plusieurs prestations et calcul du total/durée.
- [x] Création et annulation d’une réservation depuis l’interface via les procédures tRPC protégées, avec brouillon conservé localement, statuts, référence, fuseau horaire affiché et historique UI.
- [x] Base backend tRPC pour catalogue, créneaux, réservation, annulation et santé.
- [x] Schéma de données initial pour professionnels, prestations, disponibilités, réservations, historique, portfolio, promotions et audit.
- [x] Source mobile exportable documentée dans `apps/mobile`.

## En cours

- [x] Réservations persistées en transaction (verrou par professionnel, anti-chevauchement, horaires d’ouverture, préparation, téléphone camerounais), catalogue lu en base, `catalog.slots`, erreurs tRPC typées, seed `pnpm db:seed`, tests d’intégration sur base réelle (migration `0002_kofi_persistence`).
- [x] Interface web branchée sur l’API : catalogue, recherche filtrée côté serveur, créneaux réels par jour (heure de Douala), adresse obligatoire à domicile, confirmation avec référence, « Mes réservations » via `booking.mine` (multi-appareils), annulation. Catalogue local et historique `localStorage` supprimés ; bug de dates corrigé.
- [x] En-tête selon la connexion, liens internes sans rechargement, menu mobile fonctionnel ; filtre « Quand ? » et bouton favori (non fonctionnels) retirés.
- [ ] Remplacer le catalogue de démonstration par une ingestion de professionnels vérifiés.
- [x] Back-office administrateur V1 (`/admin`) : vue d’ensemble sur 7 jours, validation/refus/suspension/réactivation des professionnels avec motif, réservations (recherche, historique, confirmer/terminer/absence/annuler avec motif), utilisateurs (recherche nom/e-mail/téléphone, suspension), journal d’audit en lecture seule. Comptes suspendus bloqués côté serveur. Migration `0003_admin_v1`.
- [x] Espace professionnel (`/professionnel`) : inscription liée au compte (profil « en attente »), demandes à accepter/refuser avec motif, agenda, historique, terminer/absence après l’heure du rendez-vous, prestations (ajout, modification, masquage), horaires types par jour avec génération des créneaux sur 60 jours glissants, congés/jours fériés/indisponibilités avec alerte sur les rendez-vous touchés, profil (un profil refusé corrigé repasse en validation). Migration `0004_pro_space`.
- [x] Notifications dans le site et l’app (cloche, page dédiée, onglet Compte de l’app) : nouvelle demande, annulation par le client, acceptation, refus, annulation, rendez-vous terminé (invitation à donner son avis), nouvel avis, validation/refus/suspension du profil, réponse à un signalement. Écrites dans la même transaction que l’événement.
- [x] Avis vérifiés : seulement par le client d’un rendez-vous terminé, une fois, dans les 30 jours ; prénom + initiale affichés ; note publique recalculée ; réponse unique du professionnel ; masquage motivé par l’équipe (modérateur, super-admin). Migration `0007_reviews_notifications`.
- [ ] Envoi SMS/WhatsApp des notifications (rappel la veille compris) — nécessite un prestataire ; la table `notifications` sert de source.
- [x] Back-office V2 : niveaux d’équipe (support, modérateur, super-administrateur) appliqués côté serveur (`shared/permissions.ts`), gestion des rôles par le super-admin ; signalements envoyés par les clients depuis « Mes réservations » et traités avec réponse visible du client ; codes promo (pourcentage ou montant, période, plafond d’utilisations, une fois par client, montant minimum) appliqués dans la transaction de réservation. Migration `0005_backoffice_v2`.
- [x] Photos de réalisations : envoi (12 max), réduction WebP, suppression des métadonnées GPS, modération, galerie publique (site et app). Stockage local / S3 / Manus. Migration `0008_portfolio_media`.
- [x] Circuit de paiement Mobile Money complet en mode test : paiement après acceptation, acompte réglable, webhook signé et idempotent, remboursements automatiques, annulation gratuite jusqu’à 24 h avant, commission, soldes et reversements. Migration `0009_payments`.
- [ ] Brancher le prestataire de paiement réel (un fichier, voir `documentation/integrations.md`) et configurer le stockage S3 de production.
- [ ] Finaliser les uploads portfolio via stockage objet avec index propriétaire.

## À faire — critères conservés du cahier des charges

- [ ] Inscription, récupération de mot de passe, vérification email/téléphone et suppression de compte selon le fournisseur choisi ; KOFI conserve Manus OAuth par défaut tant qu’aucun fournisseur métier n’est fourni.
- [ ] Gestion avancée des horaires particuliers, congés, jours fériés, indisponibilités, retards, domicile/salon, fuseaux horaires et protection des confirmations côté serveur.
- [ ] Promotions, fidélité, favoris, parrainage, mise en avant, abonnements professionnels, commissions, factures, reçus et historique financier activables depuis l’administration.
- [ ] Back-office complet : recherche utilisateurs, transactions, validation/suspension, signalements, réclamations, modération et journal d’audit renforcé.
- [ ] Paiement réel sans fausse transaction, notifications SMS/email, cartographie et coûts d’exploitation avec secrets fournis par le propriétaire.
- [ ] Tests API/intégration/frontend/responsive, concurrence de réservations, paiements échoués, perte réseau/reconnexion, accès interdits, prestation supprimée et créneau bloqué.
- [ ] CI, environnements dev/test/prod, rollback, sauvegardes/restauration PostgreSQL ou MySQL selon cible, monitoring, domaine HTTPS et publication.
- [x] Application mobile Expo (SDK 57, `apps/mobile`) branchée sur l’API : recherche, profils, créneaux, réservation avec code promo, mes réservations, connexion sécurisée par code à usage unique + secret (migration `0006_mobile_login`). Icônes et écran de démarrage aux couleurs KOFI.
- [x] Site installable (PWA) avec mode hors-ligne léger : coquille et catalogue consulté disponibles sans réseau, créneaux et réservations toujours en direct.
- [ ] Builds Android (AAB) et iOS (TestFlight) avec EAS : nécessitent un compte Expo, Google Play Console et Apple Developer ; notifications push.
- [ ] Pages légales validées par le propriétaire et guides finaux client, professionnel et administrateur.

## Bloqué par accès externes

- [ ] Clés et comptes de paiement, SMS, email transactionnel, cartographie, stockage externe éventuel, domaine, hébergeur, Apple Developer et Google Play Console.
