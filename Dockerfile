# Builds the website, then packages it with the API server into one small image.
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY --from=web /web/dist ./public
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
