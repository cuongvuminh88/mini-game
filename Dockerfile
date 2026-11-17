FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /srv

# Cài dependency trước để tận dụng cache khi chỉ sửa code
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node server.js ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node shared ./shared
COPY --chown=node:node app ./app
COPY --chown=node:node admin ./admin
COPY --chown=node:node design ./design

USER node
EXPOSE 3000

CMD ["node", "server.js"]
