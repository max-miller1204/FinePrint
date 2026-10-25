# The FinePrint server for Cloud Run. deploy.sh builds it with
# `gcloud run deploy --source .` (Cloud Build); `docker build .` works too.
# .dockerignore and .gcloudignore keep the iOS app and docs out of the context.

FROM node:24-slim AS build
WORKDIR /repo
COPY . .
# The pnpm version pinned in package.json's packageManager field.
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")" \
 && pnpm install --frozen-lockfile --filter @fineprint/server \
 && pnpm --filter @fineprint/server build \
 && pnpm --filter @fineprint/server deploy --prod /out

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
# The rule packs the lease routes load: dist/rules/loader.js reads ../../../jurisdictions.
COPY --from=build --chown=node:node /repo/jurisdictions /jurisdictions
USER node
# Cloud Run sets PORT; the server defaults to 8080.
EXPOSE 8080
CMD ["node", "dist/index.js"]
