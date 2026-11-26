FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
COPY index.html hubei.html vite.config.ts tsconfig.json ./
COPY admin/index.html ./admin/index.html
COPY workspace/index.html ./workspace/index.html
COPY src ./src
COPY server ./server
COPY scripts/cesium-assets.mjs ./scripts/cesium-assets.mjs
COPY public ./public
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    SERVE_DIST=1 \
    API_HOST=0.0.0.0 \
    API_PORT=3000
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src/jingshan/*.ts ./src/jingshan/
COPY --from=build /app/public/jingshan/demo-data.json /app/public/jingshan/demo-data-v3.json /app/public/jingshan/administration.json /app/public/jingshan/roads.json ./public/jingshan/
USER node
EXPOSE 3000
CMD ["node", "server/index.ts"]
