# Infrastructure KOFI

Le `Dockerfile` du starter produit le serveur Express et les assets Vite. `docker-compose.example.yml` fournit uniquement une base MySQL locale de développement. Pour une exploitation commerciale, choisir un hébergeur, une base managée, un stockage objet, un domaine HTTPS et un système de monitoring ; aucun service payant n’est souscrit par ce dépôt.

Les déploiements doivent être construits depuis un commit validé par CI. En cas de régression, revenir au commit précédent accepté, restaurer la base uniquement avec une sauvegarde vérifiée et inspecter les journaux avant de relancer le trafic.
