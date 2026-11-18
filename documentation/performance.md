# Performance et consommation de données

## Mesure de référence

La référence a été construite avec `pnpm build` avant optimisation :

- JavaScript initial : 463 053 octets, environ 137,34 Ko gzip.
- CSS initial : 119 860 octets, environ 20,10 Ko gzip.
- HTML initial : 981 octets, environ 0,52 Ko gzip.
- Polices : deux familles Google Fonts chargées depuis un domaine externe.
- Les providers `sonner`, `next-themes` et Radix Tooltip étaient chargés au démarrage sans être utilisés par le parcours KOFI.

## Optimisations appliquées

- Suppression des polices Google bloquantes au profit d’une pile système locale ; les titres conservent une pile serif locale.
- Suppression de `Toaster` et `TooltipProvider` du shell principal, car ils ne sont pas utilisés par KOFI.
- Suppression du CSS Tailwind global et de `tw-animate-css` du bundle initial ; le design KOFI utilise son design system CSS dédié. L’écran d’erreur possède désormais ses styles KOFI autonomes.
- Ajout d’un shell HTML de chargement visible avant l’exécution de React afin d’éviter une page blanche sur réseau lent.
- Cache de production : HTML et manifeste en `no-cache`, fichiers fingerprintés sous `/assets/` en `public, max-age=31536000, immutable`.
- Réduction des limites JSON/urlencoded Express de 50 Mo à 1 Mo ; les uploads binaires ne sont pas encore exposés par l’API.
- Conservation des données de réservation saisies dans le brouillon local ; aucune réservation n’est confirmée sans réponse serveur.

## Résultats après optimisation

Après optimisation et recompilation :

- JavaScript initial : 359 863 octets, environ 105,35 Ko gzip, soit environ 22,3 % de moins en brut et 23,3 % de moins en gzip par rapport à la référence.
- CSS initial : 18 761 octets, environ 4,54 Ko gzip, soit environ 84,3 % de moins en brut et 77,4 % de moins en gzip.
- HTML initial : 896 octets, environ 0,49 Ko gzip. Le shell de chargement ajoute quelques octets utiles pour éviter une page blanche.
- Total brut des trois ressources initiales principales : 583 894 octets avant, 379 520 octets après, soit 35,0 % de moins.
- Le build passe de 2,08 s à 1,56 s dans les mesures disponibles.

## Contrôles exécutés

- `pnpm check` : réussi.
- `pnpm test` : 10 tests passés.
- `pnpm build` : réussi.
- `chromium --headless --dump-dom --virtual-time-budget=5000 http://127.0.0.1:3000/` : le contenu KOFI est rendu ; aucune page blanche constatée dans ce contrôle.
- Test de transfert HTML avec `curl --limit-rate 64k` : le shell HTML reste récupérable sur débit limité.
- Serveur de production compilé : `/` renvoie `Cache-Control: no-cache`, un asset fingerprinté renvoie `public, max-age=31536000, immutable`, et `/api/health` répond correctement.
- Diagnostics TypeScript Webdev : enregistrés et actifs.

## Limites et prochaines mesures

Les métriques LCP, INP et CLS n’ont pas été déclarées comme mesurées : aucun outil Lighthouse/Playwright n’est installé dans cet environnement. Le contrôle Chromium confirme le rendu mais ne constitue pas une mesure Web Vitals de laboratoire.

Le bundle JavaScript reste relativement important car l’application web actuelle est regroupée dans un parcours React unique et inclut l’écosystème tRPC/React Query et les icônes Lucide. Une prochaine passe pourra découper les écrans par route avec des imports dynamiques, après ajout d’une mesure navigateur reproductible.

La compression HTTP gzip/Brotli dépend encore de la couche de déploiement ; elle n’est pas simulée dans le serveur local. Les images métier ne sont pas téléchargées actuellement : les visuels de démonstration sont des gradients et des initiales. Quand les portfolios seront activés, il faudra appliquer WebP/AVIF, tailles responsives, miniatures et lazy loading côté stockage objet.
