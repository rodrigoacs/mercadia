FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY . .

RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3003

CMD ["node", "server.js"]
