FROM node:20-alpine

ENV NODE_ENV=production \
    TZ=Asia/Kolkata \
    PORT=4000

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Manager-entered data (JSON backend). Writable by the non-root user.
RUN mkdir -p /app/data && chown node:node /app/data

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" > /dev/null || exit 1

CMD ["node", "index.js"]
