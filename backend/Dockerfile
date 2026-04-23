FROM ghcr.io/puppeteer/puppeteer:24.2.0

WORKDIR /app

COPY package*.json ./
# Puppeteer 24.2.0 matches Docker image 24.2.0 — same Chrome version bundled
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci

COPY . .
RUN npm run build

USER pptruser
CMD ["node", "dist/index.js"]
