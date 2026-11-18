# API KOFI

Les procédures sont exposées via tRPC sous `/api/trpc`.

| Procédure | Accès | Rôle |
|---|---|---|
| `auth.me` | public | Retourne la session courante ou `null`. |
| `auth.logout` | public | Efface la session applicative. |
| `catalog.search` | public | Filtre par recherche, ville, mode et budget. |
| `catalog.professional` | public | Retourne un profil par slug. |
| `catalog.categories` | public | Retourne les catégories de prestations actives (lues en base). |
| `catalog.slots` | public | `{ slug, day: "AAAA-MM-JJ", serviceIds }` → durée, total et départs libres (instants ISO UTC) pour ce jour à Douala. |
| `booking.create` | connecté | Crée une demande après validation et contrôle de chevauchement. |
| `booking.mine` | connecté | Retourne les réservations du compte courant. |
| `booking.cancel` | connecté | Annule une demande appartenant au compte ; refuse une réservation confirmée. |
| `pro.me` / `pro.register` / `pro.updateProfile` | connecté | Profil professionnel du compte (ou `null`), inscription (profil « en attente », horaires par défaut lun–sam 9 h–18 h), mise à jour (un profil refusé repasse « en attente »). |
| `pro.overview` | connecté + profil pro | Demandes à traiter, rendez-vous du jour, confirmés à 7 jours, terminés et montant du mois. |
| `pro.saveService` / `pro.setServiceActive` | connecté + profil pro | Ajout/modification d’une prestation (10 min–10 h, ≥ 500 FCFA) ; masquage sans suppression. |
| `pro.setWeeklyHours` | connecté + profil pro | Horaires types par jour (`{"1":{"open":"09:00","close":"18:00"}}`) ; régénère les créneaux sur 60 jours et compte les rendez-vous devenus hors horaires. |
| `pro.closures` / `pro.addClosure` / `pro.removeClosure` | connecté + profil pro | Congés, jours fériés, indisponibilités ; renvoie les références des rendez-vous déjà pris sur la période. |
| `pro.bookings` / `pro.transition` | connecté + profil pro | Demandes (`pending`), agenda (`upcoming`), historique (`past`) ; en attente → acceptée/refusée (motif), confirmée → annulée (motif), terminée ou absence seulement après l’heure de début. Bloqué si le profil est suspendu. |
| `mobile.createLoginCode` | connecté (site) | Crée un code à usage unique (5 min) pour l’app, à partir de l’empreinte de son secret ; retour uniquement vers `kofi://` ou `exp://`. |
| `mobile.exchange` | public | Code + secret → jeton de session de 30 jours (en-tête `Authorization: Bearer`). Code grillé après une tentative. |
| `catalog.reviews` | public | Avis visibles d’un professionnel (prénom + initiale, note, commentaire, réponse du pro). |
| `reviews.create` | connecté | Avis sur sa réservation terminée depuis moins de 30 jours, une seule fois (note 1–5, commentaire facultatif). |
| `pro.reviews` / `pro.replyReview` | connecté + profil pro | Avis reçus ; une réponse publique par avis. |
| `admin.reviews.list` / `.setStatus` | lecture : équipe ; masquage : modérateur et super-admin | Masquer (motif obligatoire) ou réafficher ; la note est recalculée. |
| `notifications.list` / `.unreadCount` / `.markRead` | connecté | Notifications du compte ; `markRead` sans id = tout marquer comme lu. |
| `payments.config` | public | Paiement actif ou non, mode test, acompte, délai d’annulation gratuite. |
| `payments.initiate` / `payments.status` | connecté | Demande de paiement Mobile Money d’une réservation confirmée (opérateur, numéro) et suivi. |
| `payments.simulate` | connecté, mode test seulement | Simule la réponse de l’opérateur (même chemin qu’un webhook). |
| `POST /api/payments/webhook/:prestataire` | prestataire | Événement signé ; 400 si signature invalide ; idempotent. |
| `pro.earnings` | connecté + profil pro | Encaissé, commission, part du pro, reversé, solde. |
| `admin.payments.list` / `.recordPayout` | lecture : support et super-admin ; reversement : super-admin | Opérations, totaux, soldes par pro, enregistrement d’un reversement (plafonné au solde). |
| `catalog.portfolio` / `pro.portfolio` / `pro.removePhoto` | public / pro | Photos publiées ; photos du pro avec leur statut ; retrait. |
| `POST /api/uploads/portfolio` | pro connecté | Envoi d’une photo (corps binaire image/*, 8 Mo max, en-tête `X-Description`). |
| `admin.portfolio.list` / `.moderate` | lecture : équipe ; validation : modérateur et super-admin | Modération des photos. |
| `promo.check` | connecté | Aperçu d’un code pour une sélection : `{ valid: true, discountXaf, totalXaf, … }` ou `{ valid: false, reason }`. Revérifié à la création. |
| `reports.create` / `reports.mine` | connecté | Signalement (sur sa propre réservation ou général, 10 par jour au plus) et suivi avec la réponse de l’équipe. |
| `admin.me` | équipe | Rôle et permissions du compte connecté. |
| `admin.reports.list` / `.update` | équipe (`reports.*`) | Traitement des signalements ; clôture (résolu ou classé) avec réponse obligatoire. |
| `admin.promotions.list` / `.create` / `.setEnabled` | lecture : support et super-admin ; gestion : super-admin | Codes promo et utilisation réelle (réservations actives). |
| `admin.users.setRole` | super-admin | Rôle `user`, `support`, `moderator` ou `admin` ; impossible sur son propre compte. |
| `admin.overview` | administrateur | Chiffres clés sur 7 jours glissants (heure de Douala) : rendez-vous du jour, taux de confirmation, volume réservé, annulations, absences, rendez-vous par jour, top professionnels, files à traiter. |
| `admin.professionals.list` / `.setStatus` | administrateur | Liste filtrable ; actions `validate`, `refuse` (motif), `suspend` (motif), `reactivate`. Suspendus et refusés sont masqués du public. |
| `admin.bookings.list` / `.transition` | administrateur | Recherche par référence, client, téléphone ou professionnel ; transitions autorisées : en attente → confirmée/refusée/annulée, confirmée → terminée/absence/annulée (motif obligatoire pour refus et annulation). |
| `admin.users.list` / `.setStatus` | administrateur | Recherche par nom, e-mail ou téléphone (via les réservations) ; suspension avec motif, impossible sur son propre compte. |
| `admin.audit` | administrateur | Journal en lecture seule : qui, quoi, sur quoi, quand, motif. |

Les procédures `admin.*` sont ouvertes selon le rôle (voir `shared/permissions.ts`) : le support gère réservations et signalements, le modérateur les professionnels, les suspensions et les signalements, le super-administrateur tout, y compris les rôles et les codes promo. Toute action d’administration écrit sa ligne de journal d’audit dans la même transaction que la modification. Un compte `suspended` reçoit `FORBIDDEN` / `ACCOUNT_SUSPENDED` sur toute procédure connectée, back-office compris. Pour donner le rôle administrateur à un compte : `UPDATE users SET role = 'admin' WHERE openId = '…';` (ou la variable `OWNER_OPEN_ID` à la première connexion).

## Persistance et règles de réservation

Catalogue et réservations sont lus et écrits dans la base (`professional_profiles`, `service_catalog`, `availability_slots`, `bookings`, `booking_items`, `booking_events`). Les prestations sont désignées dans l’API par leur `code` public (ex. `cedric-fade`) et les professionnels par leur `slug`.

`booking.create` attend `professionalSlug`, `startsAt` (ISO 8601), `serviceIds`, `durationMinutes`, `totalXaf`, `mode`, `customerName`, `customerPhone`, et en option `address` et `notes`. Le serveur, dans une transaction :

1. verrouille la ligne du professionnel (`SELECT … FOR UPDATE`) pour sérialiser les demandes concurrentes ;
2. recalcule durée et total à partir des prestations actives et refuse toute différence ;
3. vérifie le mode, le nom et un numéro camerounais (normalisé en `+237XXXXXXXXX`) ;
4. refuse un horaire passé, hors des plages ouvertes ou pendant un blocage/congé/jour férié ;
5. compte le temps de préparation des prestations dans l’occupation ;
6. refuse tout chevauchement avec une réservation en attente ou confirmée, puis écrit la réservation, ses lignes et l’événement « pending ».

`booking.cancel` n’annule qu’une demande en attente du client propriétaire ; une réservation confirmée est protégée et une double annulation est sans effet.

## Erreurs

Les erreurs métier sortent en erreurs tRPC typées, avec le code métier comme message : `NOT_FOUND` (`PROFESSIONAL_NOT_FOUND`, `SERVICE_NOT_FOUND`, `BOOKING_NOT_FOUND`), `BAD_REQUEST` (`DURATION_MISMATCH`, `TOTAL_MISMATCH`, `MODE_UNAVAILABLE`, `CUSTOMER_DETAILS_INVALID`, `INVALID_TIME_RANGE`, `SLOT_IN_PAST`, `SLOT_OUTSIDE_HOURS`, `ADDRESS_REQUIRED`), `CONFLICT` (`SLOT_UNAVAILABLE`, `CONFIRMED_BOOKING_PROTECTED`, `BOOKING_NOT_CANCELLABLE`) et `INTERNAL_SERVER_ERROR` (`DATABASE_UNAVAILABLE`, `UNEXPECTED_ERROR`). Les dates sont stockées et échangées en UTC ; l’affichage se fait en heure de Douala.

Les intégrations paiement, SMS et email doivent être ajoutées comme services serveur et ne doivent jamais recevoir de secret depuis le navigateur. Les procédures upload doivent vérifier le propriétaire et la taille avant de créer une URL présignée ; l’URL `/manus-storage/<key>` est ensuite persistée avec l’index portfolio.
