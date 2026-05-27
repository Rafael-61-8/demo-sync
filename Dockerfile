FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm install tsx

COPY . .

ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo

CMD ["npx", "tsx", "src/index.ts"]
