FROM ghcr.io/puppeteer/puppeteer:24.2.0

WORKDIR /app

COPY package*.json ./
# Use Chrome bundled with the Docker image — don't let puppeteer download its own
# (npm ci installs puppeteer 24.36.1 which downloads broken Chrome 144)
ENV PUPPETEER_SKIP_DOWNLOAD=true
# Tell puppeteer where to find the Docker image's bundled Chrome
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
RUN npm ci

COPY . .
RUN npm run build

USER pptruser
CMD ["node", "dist/index.js"]
