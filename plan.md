# Plan KOFI

## Décisions d’architecture

KOFI est livré comme un monorepo TypeScript indépendant, avec une application React/Vite côté web, un backend Express/tRPC, un schéma Drizzle MySQL compatible PostgreSQL externe à terme, et une source Expo préparée dans `apps/mobile`. Le MVP de démonstration utilise un catalogue explicitement marqué « données de démonstration » afin de ne pas présenter de fausses réalisations comme celles de vrais professionnels. Les tables de réservation et leur modèle d’historique sont migrés dans la base, mais le service tRPC de cette itération utilise encore un registre mémoire : la persistance transactionnelle DB est un travail ouvert, pas une capacité livrée.

Le serveur reste la frontière d’autorisation : la session est exigée pour les réservations et le rôle `admin` est exigé pour l’overview administrateur. Le rôle professionnel, les procédures portfolio/disponibilités et les contrôles de créneaux DB restent à implémenter ; aucun accès métier fictif n’est présenté comme opérationnel. Les paiements, SMS, cartographie et comptes stores restent des intégrations à brancher via secrets documentés : aucune fausse transaction n’est affichée comme réelle.

## Structure cible

- `client/` : application web, routes publiques, espace client, professionnel et admin.
- `server/` : procédures tRPC, auth Manus OAuth existante, services de réservation, stockage et audit.
- `drizzle/` : schéma relationnel, migrations et seeds de démonstration.
- `apps/mobile/` : squelette Expo/React Native exportable, navigation et contrats API partagés.
- `server/**/*.test.ts` : scénarios critiques métier, authentification et sécurité ; un espace de tests frontend/API transversal reste à ajouter.
- `documentation/` : architecture, API, guides client/professionnel/admin, déploiement et coûts.
- `infrastructure/` : Docker, CI, sauvegarde et restauration.
- `scripts/` : seeds, contrôle de configuration et tâches d’exploitation.

## Design retenu — « Atelier solaire »

Trois directions considérées : minimalisme éditorial premium (0,06), néo-brutalisme chaleureux (0,08), atelier solaire afro-contemporain (0,07). Choix : **atelier solaire afro-contemporain**.

- **Mouvement** : artisanat éditorial contemporain, inspiré des affiches de quartier et des matières naturelles, sans folklorisation.
- **Principes** : proximité, confiance visible, parcours court, contraste accessible.
- **Couleurs** : crème sable pour l’accueil, encre cacao pour la confiance, orange mandarine comme signal propriétaire, vert feuille pour les confirmations.
- **Mise en page** : colonne éditoriale asymétrique avec rail de recherche, cartes de résultats aérées et panneaux de décision ; éviter les dashboards froids centrés.
- **Signatures** : pastilles de statut, motif de rayons fins, marque KOFI en bloc typographique avec le « O » traité comme un soleil.
- **Interactions** : chaque action importante répond par un état explicite ; les filtres sont réversibles et la réservation se fait en étapes courtes.
- **Animation** : entrée douce des cartes, micro-translation au survol, aucun mouvement décoratif permanent ; respect de `prefers-reduced-motion`.
- **Typographie** : Fraunces pour les titres éditoriaux, DM Sans pour l’interface et les données.
- **Essence** : « trouver une main de confiance, réserver sans appeler » ; humain, net, local.
- **Voix** : directe, rassurante, jamais infantilisante. Exemples : « Le prochain créneau qui vous ressemble. » / « Votre texture mérite mieux qu’une disponibilité floue. »
- **Logo** : mot-symbole KOFI en capitales, O-soleil composé d’un cercle et de quatre rayons.
- **Couleur propriétaire** : mandarine KOFI `#F47A45`.

## Périmètre de cette itération

La première itération rend réellement utilisables la découverte, le filtrage combinable, les fiches professionnelles, la sélection multi-prestations, les créneaux, la création/annulation d’une réservation, les états UI, l’authentification OAuth fournie, les contrats backend, le schéma métier, le seed de démonstration et la documentation de reprise. Les paiements, notifications, upload S3, validation juridique, déploiement public, builds Android/iOS et comptes administrateurs réels sont préparés mais restent dépendants de secrets, choix et accès externes.
