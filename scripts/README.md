# Scripts d’exploitation

`pnpm db:push` génère puis applique une migration Drizzle après revue. `pnpm db:migrate` applique seulement les migrations déjà commitées. Une sauvegarde locale peut être produite avec `mysqldump --single-transaction --routines --triggers "$DATABASE_URL" > backup.sql` selon le client MySQL installé. Pour restaurer, vérifier d’abord l’environnement cible et exécuter `mysql "$DATABASE_URL" < backup.sql`; ne jamais restaurer une sauvegarde de production dans le développement partagé sans validation.

Les seeds de démonstration sont SQL et restent séparés des données de production. Aucun script ne supprime automatiquement des tables.
