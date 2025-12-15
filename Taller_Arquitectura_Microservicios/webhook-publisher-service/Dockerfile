FROM node:20-alpine

WORKDIR /app

# Instalar dependencias
COPY package*.json ./
RUN npm install

# Copiar código fuente
COPY . .

# Compilar TypeScript
RUN npm run build 2>&1 || (echo 'Build failed, checking files:' && ls -la && exit 1)

# Puerto del servicio
EXPOSE 3003

# Variables de entorno por defecto
ENV PORT=3003
ENV NODE_ENV=production

# Comando de inicio
CMD ["npm", "run", "start:prod"]
