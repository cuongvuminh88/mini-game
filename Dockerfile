FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /srv

# Không có dependency nên không cần npm install
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node app ./app
COPY --chown=node:node design ./design

USER node
EXPOSE 3000

CMD ["node", "server.js"]
