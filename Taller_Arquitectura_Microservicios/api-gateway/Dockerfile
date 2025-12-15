FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build 2>&1 || (echo 'Build failed, checking files:' && ls -la && exit 1)

EXPOSE 3000

CMD ["node", "dist/main.js"]
