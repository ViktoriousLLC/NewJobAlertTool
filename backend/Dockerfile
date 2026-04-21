FROM ghcr.io/puppeteer/puppeteer:24.2.0

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

CMD ["node", "dist/index.js"]
