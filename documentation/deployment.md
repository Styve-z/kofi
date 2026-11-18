# Déploiement et maintenance

## Installation

Utiliser Node 22 et pnpm 10.18.0. Exécuter `pnpm install`, copier `.env.example` vers `.env`, puis renseigner uniquement les secrets de l’environnement concerné. Vérifier avec `pnpm check`, `pnpm test` et `pnpm build`.

## Développement

`pnpm dev` lance Express et Vite sur le port géré par l’environnement. `pnpm db:migrate` applique les migrations déjà revues. `pnpm db:push` génère et applique une migration après vérification de la base partagée.

## Sauvegarde et restauration

Le fichier `scripts/README.md` décrit `mysqldump --single-transaction` et la restauration par le client MySQL. Tester d’abord une restauration dans un environnement séparé. Le stockage d’images doit être sauvegardé par le fournisseur objet choisi ; une suppression logique dans l’index ne promet pas une suppression physique.

## Publication

Le Dockerfile du starter construit le frontend et le serveur. La CI doit réussir avant le push de `main`. Le domaine, HTTPS, monitoring, stockage objet, notifications, paiement et comptes stores sont des opérations externes à configurer avec autorisation explicite ; aucune souscription payante n’est effectuée par ce dépôt.
