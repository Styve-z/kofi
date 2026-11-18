# Image de production KOFI.
# Construction : docker build -t kofi .
# Lancement    : voir infrastructure/docker-compose.production.yml et documentation/production.md
FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN CI=1 pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && mkdir -p /app/uploads /app/outbox && chown -R node:node /app/uploads /app/outbox
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
# Le serveur ne tourne pas en root.
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Les migrations sont appliquées à chaque démarrage (elles ne s’appliquent qu’une fois), puis le serveur démarre.
# Il vérifie lui-même sa configuration et refuse de démarrer si elle est dangereuse.
CMD ["sh", "-c", "pnpm db:migrate && node dist/index.js"]
