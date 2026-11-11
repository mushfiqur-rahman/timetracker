# API server + the built website (server/public). Rebuild the website with: npm run build:web
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY server ./server
USER node
EXPOSE 3000
CMD ["node", "server.js"]
