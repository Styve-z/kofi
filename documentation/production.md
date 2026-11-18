# Mise en production de KOFI

Ce guide part d’un serveur Linux (VPS) avec Docker. Le même principe vaut pour un hébergeur qui lance l’image Docker (Railway, Render, Fly.io…) ; seule la base MySQL et le HTTPS changent de place.

## 1. Choix à faire (hors code)

| Besoin | À choisir | Réglage |
| --- | --- | --- |
| Hébergement | VPS (Docker) ou plateforme qui lance une image Docker | — |
| Nom de domaine | ex. `kofi.cm` | `APP_URL=https://…` |
| Base de données | MySQL 8 (le conteneur fourni ou une base managée) | `DATABASE_URL` |
| Paiement Mobile Money | agrégateur MTN / Orange au Cameroun | `PAYMENT_PROVIDER` + adaptateur dans `server/modules/payments/` |
| E-mails | service d’e-mails transactionnels | `EMAIL_PROVIDER` + adaptateur dans `server/modules/mailer.ts` |
| SMS | opérateur ou agrégateur SMS | `SMS_PROVIDER` + adaptateur dans `server/modules/sms.ts` |

## 2. Secrets

```bash
pnpm exec tsx scripts/generate-secrets.ts
```

Copiez le résultat dans `infrastructure/prod.env` sur le serveur (ce fichier est ignoré par Git et par Docker) ou dans les variables secrètes de l’hébergeur. Gardez une copie dans un coffre-fort de mots de passe.

## 3. Vérifier la configuration

```bash
pnpm exec tsx scripts/check-production.ts infrastructure/prod.env
```

Le serveur applique les mêmes règles au démarrage. En production, il **refuse de démarrer** si :
- le secret de session est faible ;
- la base est utilisée en `root` ou sans mot de passe solide ;
- `APP_URL` n’est pas en `https://` ;
- le paiement est en mode test ;
- le secret des webhooks de paiement manque.

## 4. Base de données avec un utilisateur dédié

Avec le `docker-compose.production.yml` fourni, l’utilisateur `kofi` est créé automatiquement et la base n’est pas exposée sur Internet. Pour une base existante :

```sql
CREATE DATABASE kofi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'kofi'@'%' IDENTIFIED BY '<DB_PASSWORD généré>';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP ON kofi.* TO 'kofi'@'%';
FLUSH PRIVILEGES;
```

Les migrations s’appliquent automatiquement au démarrage du conteneur (`pnpm db:migrate`).

## 5. Lancement

```bash
docker compose -f infrastructure/docker-compose.production.yml --env-file infrastructure/prod.env up -d --build
```

Mettez ensuite un proxy HTTPS devant `127.0.0.1:3000`, par exemple Caddy, qui obtient le certificat tout seul :

```
kofi.cm {
  reverse_proxy 127.0.0.1:3000
}
```

`TRUST_PROXY=1` est déjà réglé dans le compose : la vraie adresse IP des clients sert aux limites d’essais de connexion.

## 6. Premiers comptes

```bash
docker compose -f infrastructure/docker-compose.production.yml exec app pnpm exec tsx scripts/create-accounts.ts --force
```

Remplacez d’abord les adresses `@kofi.test` du script par de vraies adresses. Changez immédiatement chaque mot de passe (`scripts/set-password.ts`). À la première connexion, les administrateurs et le super-administrateur doivent activer la **double vérification** : elle est obligatoire et ne peut pas être désactivée en production.

N’importez pas le catalogue de démonstration (`pnpm db:seed`) en production.

## 7. Sauvegardes

- **Docker :**

  ```bash
  docker compose -f infrastructure/docker-compose.production.yml exec mysql sh -c 'mysqldump --single-transaction -u root -p"$MYSQL_ROOT_PASSWORD" kofi' > kofi-$(date +%F).sql
  ```

  À planifier chaque nuit (cron), avec une copie hors du serveur.
- **Windows (développement) :** `.\scripts\backup-db.ps1` conserve les 14 dernières sauvegardes dans `backups/`.
- **Restauration :** testez-la régulièrement sur une base séparée, jamais directement sur la production.

Les sauvegardes contiennent des données personnelles : stockez-les chiffrées et à accès restreint.

## 8. Ce que le serveur fait déjà

- **En-têtes de sécurité :**
  - HSTS ;
  - politique de contenu (CSP) ;
  - interdiction d’être affiché dans un cadre ;
  - `nosniff` ;
  - pas d’en-tête `X-Powered-By`.
- **Comptes :**
  - cookies de session `Secure` / `HttpOnly` ;
  - session du super-administrateur limitée à 12 h ;
  - essais de connexion limités ;
  - double vérification obligatoire pour l’équipe d’administration.
- **Envois :**
  - e-mails et SMS mis en file d’attente avec nouvelles tentatives ;
  - rappels de la veille.

  Si plusieurs instances tournent, n’en laissez qu’une s’en charger : `BACKGROUND_JOBS=off` sur les autres.
- **Contrôle de santé :** `GET /api/health`, utilisé par le `HEALTHCHECK` Docker.
