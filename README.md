# 📸 RRSS Stories Microservice — Tacos Bar / Discoteca

Microservicio de grado producción en **Node.js (ES Modules)** diseñado para procesar y publicar automáticamente fotografías enviadas a un Bot de Telegram en formato exclusivo de **Historias de Instagram (Stories 9:16 - 1080x1920 px)**, con retención temporal de 48 horas en **Supabase** y respaldo permanente en **Google Drive**.

---

## 🏗️ Arquitectura y Tecnologías

- **Motor Gráfico:** [`sharp`](https://sharp.pixelplumbing.com/) (Recorte inteligente `fit: cover, position: attention`, composición multicapa y overlay vectorial SVG con fecha en español y drop-shadow).
- **Bot de Telegram:** [`telegraf`](https://telegraf.js.org/) con middleware de autenticación por ID (`ALLOWED_TELEGRAM_IDS`), soporte para fotos comprimidas y documentos en alta resolución, y teclado `inline_keyboard` interactivo.
- **Base de Datos & Almacenamiento:** [Supabase](https://supabase.com/) (`@supabase/supabase-js`) para almacenamiento público temporal en bucket `social-media` y registro en tabla `scheduled_stories`.
- **Respaldo Permanente:** [Google Drive API v3](https://developers.google.com/drive) (`googleapis`) mediante Service Account (`credentials.json`).
- **Publicación:** [Meta Graph API v21.0](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media) con flujo asíncrono de contenedores (`media_type=STORIES`, polling `status_code === 'FINISHED'` y `media_publish`).
- **Colas y Tareas Programadas:** [`node-cron`](https://github.com/node-cron/node-cron) con ejecución cada minuto para publicación diferida y purga automática diaria a las 04:00 AM (48 horas).
- **Contenedorización:** `Dockerfile` multi-stage optimizado sobre Debian Bookworm con `fontconfig` y `fonts-dejavu` para renderizado fiel de tipografías SVG.

---

## 📁 Estructura del Proyecto

```plaintext
├── .env.example                     # Plantilla de variables de entorno requeridas
├── credentials.json.example         # Ejemplo de credenciales de Google Cloud Service Account
├── Dockerfile                       # Definición de contenedor para producción (Node 20 Debian)
├── package.json                     # Manifiesto de dependencias y scripts ("type": "module")
├── sql/
│   └── init.sql                     # Script DDL para inicializar tablas, índices y bucket en Supabase
├── assets/
│   ├── template_story.png           # Plantilla PNG overlay (1080x1920)
│   └── template_story.svg           # Vector fuente de la plantilla
└── src/
    ├── index.js                     # Punto de entrada y arranque del servicio (Graceful Shutdown)
    ├── config/
    │   └── env.js                   # Carga, validación estricta y congelamiento de configuración
    ├── bot/
    │   └── telegramBot.js           # Handlers de Telegraf, middleware de seguridad y callbacks
    └── services/
        ├── imageProcessor.js        # Motor de procesamiento Sharp (9:16 + SVG Fecha + Plantilla)
        ├── storageService.js        # Almacenamiento dual (Supabase Storage + Google Drive API)
        ├── metaService.js           # Integración con Meta Graph API v21.0 (Historias)
        └── schedulerService.js      # Cronjobs de publicación y purga de 48h
```

---

## ⚙️ Configuración y Puesta en Marcha

### 1. Variables de Entorno (`.env`)

Copia `.env.example` a `.env` y completa los valores:

```bash
cp .env.example .env
```

| Variable | Descripción | Ejemplo |
| :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | Token del bot provisto por [@BotFather](https://t.me/botfather). | `7123456789:ABC...` |
| `ALLOWED_TELEGRAM_IDS` | IDs numéricos de Telegram autorizados separados por coma. | `123456789,987654321` |
| `SUPABASE_URL` | URL del proyecto Supabase. | `https://xyzproject.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Llave secreta con rol de servicio (Settings > API). | `eyJhbGciOi...` |
| `SUPABASE_BUCKET_NAME` | Nombre del bucket público en Storage. | `social-media` |
| `INSTAGRAM_ACCOUNT_ID` | ID de la cuenta de Instagram Business o Creador. | `17841400000000000` |
| `META_ACCESS_TOKEN` | Token de acceso de usuario o página con permisos `instagram_content_publish`. | `EAA...` |
| `GOOGLE_DRIVE_FOLDER_ID` | ID alfanumérico de la carpeta de Google Drive para respaldo. | `1A2B3C4D5E6F7G8H9I0J...` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Ruta al archivo JSON de credenciales de Google Service Account. | `./credentials.json` |
| `TIMEZONE` | Zona horaria del negocio. | `America/Bogota` |
| `PORT` | Puerto HTTP para chequeos de salud. | `3000` |

---

### 2. Inicialización en Supabase

Ejecuta el script SQL ubicado en [`sql/init.sql`](sql/init.sql) directamente en el **SQL Editor** de tu consola de Supabase. Esto creará:
1. El bucket público `social-media`.
2. Las políticas de acceso de lectura pública y escritura por `service_role`.
3. La tabla `scheduled_stories` con índices optimizados y trigger `updated_at`.

---

### 3. Configuración de Google Drive

1. Ve a la consola de [Google Cloud Console](https://console.cloud.google.com/).
2. Habilita la **Google Drive API**.
3. Crea una cuenta de servicio (Service Account), genera una nueva clave JSON y guárdala como `credentials.json` en la raíz del proyecto.
4. En Google Drive, comparte tu carpeta de respaldo con el correo de la cuenta de servicio (ejemplo: `story-backup-sa@...iam.gserviceaccount.com`) otorgándole rol de **Editor**.
5. Copia el ID de la carpeta de la URL y asígnalo a `GOOGLE_DRIVE_FOLDER_ID`.

---

### 4. Permisos Requeridos en Meta Graph API

Asegúrate de que la aplicación en [Meta for Developers](https://developers.facebook.com/) cuente con los siguientes permisos en el Access Token:
- `instagram_basic`
- `instagram_content_publish`
- `pages_show_list`
- `pages_read_engagement`

---

## 🚀 Ejecución

### Desarrollo Local
```bash
# Instalar dependencias
npm install

# Modo desarrollo con recarga automática
npm run dev

# Modo producción
npm start
```

### Ejecución con Docker
```bash
# Construir la imagen
docker build -t rrss-stories-microservice .

# Correr el contenedor
docker run -d \
  --name rrss-stories \
  --env-file .env \
  -v $(pwd)/credentials.json:/app/credentials.json:ro \
  -p 3000:3000 \
  rrss-stories-microservice
```

---

## 🔄 Flujo Operativo

```
[Personal en Discoteca]
         │ (Envía foto o archivo)
         ▼
[Bot de Telegram] ──▶ ¿ID en ALLOWED_TELEGRAM_IDS?
         │ Sí                                    │ No
         ▼                                       ▼
[imageProcessor]                           [Rechazo 403]
  • Recorte 9:16 (1080x1920) cover attention
  • Overlay plantilla template_story.png
  • Overlay SVG fecha dinámica ("SÁBADO, 24 OCTUBRE")
  • Exportación JPEG Calidad 90
         │
         ▼
[Almacenamiento Dual]
  ├──▶ Supabase Storage (URL pública, retención 48h)
  └──▶ Google Drive (Copia permanente inmutable)
         │
         ▼
[Previsualización en Telegram]
  [📱 Publicar Ahora] ────▶ Meta Graph API v21.0 ────▶ Instagram Stories
  [⏰ Programar 10:00 PM] ─▶ scheduled_stories (pending) ──▶ Cronjob cada minuto
  [⏰ Programar 11:30 PM] ─▶ scheduled_stories (pending) ──▶ Cronjob cada minuto
  [❌ Descartar] ─────────▶ Purga inmediata de Storage

[Cronjob Diario 04:00 AM]
  └──▶ Elimina archivos de > 48h de Supabase Storage. (Drive queda intacto).
```
