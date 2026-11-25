FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3270
ENV IMTV_DB_PATH=/app/data/imtv-pedidos-2027.sqlite

EXPOSE 3270

CMD ["node", "--experimental-sqlite", "--import", "tsx", "server/index.ts"]
