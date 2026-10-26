import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const requiredEnvVars = [
  'TELEGRAM_BOT_TOKEN',
  'ALLOWED_TELEGRAM_IDS',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'INSTAGRAM_ACCOUNT_ID',
  'META_ACCESS_TOKEN',
  'GOOGLE_DRIVE_FOLDER_ID'
];

const missingVars = requiredEnvVars.filter((varName) => !process.env[varName] || process.env[varName].trim() === '');

if (missingVars.length > 0) {
  console.error(`[CRITICAL] Error de configuración: Faltan las siguientes variables de entorno requeridas:\n - ${missingVars.join('\n - ')}`);
  console.error('Por favor configure estas variables en su archivo .env o en el entorno antes de iniciar el servicio.');
  // En producción salimos si faltan variables críticas
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

// Parsear lista de IDs de Telegram permitidos
const rawAllowedIds = process.env.ALLOWED_TELEGRAM_IDS || '';
const allowedTelegramIds = new Set(
  rawAllowedIds
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
);

// Normalizar URL de Supabase eliminando subrutas como /rest/v1/ si fueron copiadas directamente del dashboard
function normalizeSupabaseUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (_) {
    return rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  }
}

export const config = Object.freeze({
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    allowedIds: allowedTelegramIds
  },
  supabase: {
    url: normalizeSupabaseUrl(process.env.SUPABASE_URL),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    bucketName: process.env.SUPABASE_BUCKET_NAME || 'social-media'
  },
  meta: {
    instagramAccountId: process.env.INSTAGRAM_ACCOUNT_ID || '',
    accessToken: process.env.META_ACCESS_TOKEN || '',
    graphApiVersion: 'v21.0',
    graphApiBaseUrl: 'https://graph.facebook.com/v21.0'
  },
  googleDrive: {
    folderId: process.env.GOOGLE_DRIVE_FOLDER_ID || '',
    credentialsPath: path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS || './credentials.json')
  },
  system: {
    timezone: process.env.TIMEZONE || 'America/Bogota',
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development'
  }
});

export default config;
