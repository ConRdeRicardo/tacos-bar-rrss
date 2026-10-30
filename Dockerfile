# ==============================================================================
# DOCKERFILE - RRSS Stories Microservice (Production Node.js 20 Debian Base)
# ==============================================================================

FROM node:20-bookworm-slim AS production

# Variables de entorno de Node
ENV NODE_ENV=production \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PORT=3000

# Instalar dependencias del sistema requeridas:
# - fontconfig & fonts-dejavu / fonts-liberation: Cruciales para que librsvg / Sharp renderice texto SVG correctamente
# - ca-certificates: Para conexiones TLS seguras hacia Telegram, Meta Graph API y Supabase
# - tzdata: Para manejo adecuado de la zona horaria America/Bogota
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fontconfig \
    fonts-dejavu \
    fonts-dejavu-core \
    fonts-dejavu-extra \
    fonts-liberation \
    tzdata \
    && fc-cache -f -v \
    && rm -rf /var/lib/apt/lists/*

# Directorio de trabajo
WORKDIR /app

# Copiar manifiestos de dependencias
COPY package*.json ./

# Instalar dependencias de producción de forma limpia
RUN npm install --omit=dev

# Copiar el código fuente y activos
COPY . .

# Asegurar que el usuario no privilegiado tenga permisos
RUN chown -R node:node /app

# Cambiar a usuario no-root por seguridad
USER node

# Exponer puerto HTTP opcional para monitoreo/health checks
EXPOSE 3000

# Comando de inicio del microservicio
CMD ["node", "src/index.js"]
