import cron from 'node-cron';
import config from '../config/env.js';
import storageService from './storageService.js';
import metaService from './metaService.js';

let telegramBotInstance = null;

/**
 * Establece la instancia de Telegraf para enviar notificaciones tras la ejecución de los cronjobs.
 * @param {import('telegraf').Telegraf} bot 
 */
export function setTelegramBot(bot) {
  telegramBotInstance = bot;
}

/**
 * Calcula la fecha y hora de programación para hoy en la zona horaria de Bogotá (UTC-5).
 * Si la hora especificada ya pasó para el día de hoy, programa para el siguiente día (misma hora).
 * 
 * @param {number} targetHour - Hora en formato 24h (ej: 22 para 10:00 PM, 23 para 11:30 PM)
 * @param {number} targetMinute - Minutos (ej: 0 o 30)
 * @returns {Date} - Objeto Date configurado en el momento exacto
 */
export function calculateScheduledDate(targetHour, targetMinute) {
  const timeZone = config.system.timezone;
  const now = new Date();

  // Obtener fecha actual en la zona horaria objetivo (YYYY-MM-DD)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const todayBogota = formatter.format(now); // Formato YYYY-MM-DD

  const pad = (n) => String(n).padStart(2, '0');
  
  // Construir cadena ISO en UTC-5 (Bogotá no tiene horario de verano)
  const dateString = `${todayBogota}T${pad(targetHour)}:${pad(targetMinute)}:00-05:00`;
  let scheduledDate = new Date(dateString);

  // Si la hora ya transcurrió hoy hace más de 1 minuto, programar para el día siguiente
  if (scheduledDate.getTime() <= now.getTime() - 60000) {
    scheduledDate = new Date(scheduledDate.getTime() + 24 * 60 * 60 * 1000);
  }

  return scheduledDate;
}

/**
 * Notifica al usuario en Telegram si la instancia del bot está disponible.
 */
async function notifyTelegramUser(chatId, message, extra = {}) {
  if (!telegramBotInstance || !chatId) return;
  try {
    await telegramBotInstance.telegram.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      ...extra
    });
  } catch (error) {
    console.error(`[ERROR] No se pudo enviar notificación a Telegram (Chat: ${chatId}): ${error.message}`);
  }
}

/**
 * Tarea Cron: Ejecuta la publicación de historias programadas pendientes.
 * Frecuencia: Cada minuto ('* * * * *').
 */
export async function processDueScheduledStories() {
  const now = new Date();

  try {
    const pendingStories = await storageService.getPendingStoriesDue(now);

    if (pendingStories.length === 0) {
      return;
    }

    console.log(`[SCHEDULER] Se encontraron ${pendingStories.length} historia(s) lista(s) para publicar.`);

    for (const story of pendingStories) {
      try {
        // Bloqueo optimista: marcar en estado 'publishing' para evitar colisiones
        await storageService.updateScheduledStoryRecord(story.id, {
          status: 'publishing'
        });

        console.log(`[SCHEDULER] Publicando historia ${story.id} en Instagram...`);

        // Publicar en Instagram Stories a través de Meta Graph API
        const { containerId, mediaId } = await metaService.publishStoryToInstagram(story.image_url);

        // Actualizar registro como publicado
        await storageService.updateScheduledStoryRecord(story.id, {
          status: 'published',
          published_at: new Date().toISOString(),
          meta_container_id: containerId,
          meta_media_id: mediaId
        });

        console.log(`[SCHEDULER] Historia ${story.id} publicada exitosamente (Media ID: ${mediaId})`);

        // Notificar al personal en Telegram
        const successMessage = `
🎉 <b>¡Historia Programada Publicada con Éxito!</b>

📱 <b>Red:</b> Instagram Stories
🆔 <b>ID de Media:</b> <code>${mediaId}</code>
🕒 <b>Hora de publicación:</b> ${new Date().toLocaleTimeString('es-CO', { timeZone: config.system.timezone })}
🔗 <a href="${story.image_url}">Ver imagen en Storage</a>
        `.trim();

        await notifyTelegramUser(story.telegram_chat_id, successMessage);
      } catch (publishError) {
        console.error(`[SCHEDULER ERROR] Falló la publicación de historia ${story.id}: ${publishError.message}`);

        await storageService.updateScheduledStoryRecord(story.id, {
          status: 'failed',
          error_message: publishError.message
        });

        const failureMessage = `
⚠️ <b>Error al Publicar Historia Programada</b>

No fue posible publicar la historia programada en Instagram.
<b>Detalle del error:</b> ${publishError.message}
        `.trim();

        await notifyTelegramUser(story.telegram_chat_id, failureMessage);
      }
    }
  } catch (error) {
    console.error(`[SCHEDULER] Error al consultar historias pendientes: ${error.message}`);
  }
}

/**
 * Tarea Cron: Purga automática de imágenes de más de 48 horas en Supabase Storage.
 * Mantiene intacta la copia permanente en Google Drive.
 * Frecuencia: Todos los días a las 04:00 AM ('0 4 * * *').
 */
export async function purgeOldStoriesFromStorage() {
  console.log('[PURGE] Iniciando rutina de purga de 48 horas en Supabase Storage...');

  try {
    const storiesToPurge = await storageService.getStoriesForPurge(48);

    if (storiesToPurge.length === 0) {
      console.log('[PURGE] No se encontraron archivos para purgar.');
      return;
    }

    console.log(`[PURGE] Se encontraron ${storiesToPurge.length} historias con más de 48 horas para limpiar.`);

    let purgedCount = 0;
    for (const story of storiesToPurge) {
      try {
        // 1. Eliminar archivo binario de Supabase Storage
        const fileRemoved = await storageService.deleteSupabaseFile(story.file_path);

        // 2. Actualizar registro en base de datos
        await storageService.updateScheduledStoryRecord(story.id, {
          storage_cleaned: true,
          image_url: 'PURGED'
        });

        purgedCount++;
        console.log(`[PURGE] Archivo ${story.file_path} purgado con éxito. Copia en Drive preservada.`);
      } catch (purgeError) {
        console.error(`[PURGE ERROR] No se pudo purgar la historia ${story.id}: ${purgeError.message}`);
      }
    }

    console.log(`[PURGE] Rutina finalizada. Total historias purgadas: ${purgedCount}/${storiesToPurge.length}`);
  } catch (error) {
    console.error(`[PURGE ERROR] Error en la rutina de purga de 48 horas: ${error.message}`);
  }
}

/**
 * Inicializa y programa todos los cronjobs del microservicio.
 * 
 * @param {import('telegraf').Telegraf} bot - Instancia del bot de Telegram
 */
export function initScheduler(bot) {
  setTelegramBot(bot);

  // 1. Cronjob de publicación: Cada minuto (* * * * *)
  cron.schedule('* * * * *', async () => {
    await processDueScheduledStories();
  }, {
    timezone: config.system.timezone
  });

  // 2. Cronjob de purga de 48h: Todos los días a las 04:00 AM (0 4 * * *)
  cron.schedule('0 4 * * *', async () => {
    await purgeOldStoriesFromStorage();
  }, {
    timezone: config.system.timezone
  });

  console.log(`[SCHEDULER] Cronjobs activados exitosamente (Zona Horaria: ${config.system.timezone}):`);
  console.log(' - Publicación de historias pendientes: cada minuto (* * * * *)');
  console.log(' - Purga de historias de 48h en Supabase: diario a las 04:00 AM (0 4 * * *)');
}

export default {
  setTelegramBot,
  calculateScheduledDate,
  processDueScheduledStories,
  purgeOldStoriesFromStorage,
  initScheduler
};
