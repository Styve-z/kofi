# État de livraison KOFI

KOFI est une **version de démonstration complète**, pas encore autorisée à passer en production. Le catalogue (salons, avis, photos) est composé de données de test. Le paiement fonctionne en mode test uniquement.

## Livré

| Commit | Contenu |
| --- | --- |
| `c36555a` | Accueil adapté aux professionnels : « Mon espace professionnel » remplace « Trouver un professionnel » |
| `68ce1d5` | Tondeuse 3D rouge filaire sur l’accueil, curseur tondeuse sur ordinateur |
| `407ab4f` | Sécurité et préparation de la mise en ligne : double vérification (TOTP + 8 codes de secours) obligatoire pour les administrateurs et le super-administrateur, pages CGU / confidentialité / mentions légales, export et suppression du compte, révocation des sessions, en-têtes de sécurité (CSP, HSTS), refus de démarrer sur une configuration dangereuse, Dockerfile non-root, `docker-compose` de production, script de sauvegarde |
| `ebf9019` | E-mails et SMS automatiques (demande, confirmation, refus, annulation, paiements), rappel la veille, file d’envoi avec nouvelles tentatives, vérification de l’adresse e-mail |
| `af9b3c1` | Mot de passe oublié (lien valable 1 h, à usage unique) ; paiement Mobile Money en mode test avec webhook signé |
| `242cc2f`, `93a3640`, `3da21f1` | Dépôt GitHub, README, connexion e-mail + mot de passe, 4 comptes de démonstration, menu propre à chaque type de compte, espace `/superadmin` réservé |

Fonctionnalités en place : recherche et filtres, profils, choix du collaborateur, heures creuses, réservation, déplacement et annulation, avis, favoris, fidélité, cartes cadeaux, espace professionnel (agenda, équipe, prestations, horaires, congés, photos), back-office (modération, paiements, codes promo, équipe) et super-administration.

## Vérifications

- `pnpm check` : réussi.
- Tests Vitest, dont des suites sur une vraie base MySQL : 105 tests réussis.
- `pnpm build` : réussi. Le build de production refuse la configuration de développement et sert les en-têtes de sécurité.
- Parcours vérifiés dans le navigateur : redirection du super-administrateur, refus de `/superadmin` aux autres comptes, menus par rôle, paiement et remboursement simulés, webhook falsifié rejeté, mot de passe oublié, e-mails et SMS écrits dans `outbox/`, back-office fermé sans double vérification.

## Reste à faire avant la mise en ligne

1. **Hébergement et nom de domaine** (HTTPS obligatoire).
2. **Prestataire de paiement réel** (MTN MoMo, Orange Money ou agrégateur) : adaptateur dans `server/modules/payments/`.
3. **Services réels d’e-mails et de SMS** : adaptateurs dans `server/modules/mailer.ts` et `server/modules/sms.ts`.
4. **Validation juridique** des CGU, de la politique de confidentialité et des mentions légales (champs entre [crochets]).
5. **Activer la double vérification du super-administrateur** à sa prochaine connexion.
6. **Changer tous les mots de passe de démonstration** et générer les secrets de production (`scripts/generate-secrets.ts`, puis `scripts/check-production.ts`).

## Améliorations possibles

7. Rattacher le profil pro `styve-azoa` au bon compte (il appartient aujourd’hui au compte « Client Démo »).
8. Vérifier l’installation hors ligne (PWA) sur le vrai site en HTTPS.
9. Remplacer le catalogue de démonstration par de vrais professionnels.
10. Stockage de fichiers pour les photos du portfolio (aujourd’hui par lien).
11. Carte pour situer les salons.

Voir aussi `documentation/production.md` pour le guide de déploiement.
