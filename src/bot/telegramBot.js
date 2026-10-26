import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';
import config from '../config/env.js';
import imageProcessor from '../services/imageProcessor.js';
import storageService from '../services/storageService.js';
import metaService from '../services/metaService.js';
import schedulerService from '../services/schedulerService.js';

export const bot = new Telegraf(config.telegram.token || '000000000:PLACEHOLDER_TOKEN_FOR_DEV');

// ==============================================================================
// 1. MIDDLEWARE DE SEGURIDAD (FILTRO DE USUARIOS AUTORIZADOS)
// ==============================================================================
bot.use(async (ctx, next) => {
  const userId = String(ctx.from?.id);

  if (!config.telegram.allowedIds.has(userId)) {
    console.warn(`[SEGURIDAD] Intento de acceso rechazado. ID Telegram: ${userId} (${ctx.from?.username || 'Sin username'})`);
    return ctx.reply(
      `⛔ <b>Acceso Denegado</b>\n\nNo estás autorizado para utilizar este bot de publicaciones.\nTu ID de Telegram es: <code>${userId}</code>\n\nContacta al administrador para que registre tu ID en <code>ALLOWED_TELEGRAM_IDS</code>.`,
      { parse_mode: 'HTML' }
    );
  }

  return next();
});

// ==============================================================================
// 2. COMANDOS BÁSICOS
// ==============================================================================
bot.command(['start', 'help'], async (ctx) => {
  const welcomeText = `
🎉 <b>Bot de Automatización de Historias - Discoteca / Tacos Bar</b>

Envía una foto para procesarla y publicarla en Instagram Stories:

1️⃣ <b>Envío:</b> Manda la imagen como foto estándar o como archivo/documento.
2️⃣ <b>Motor Gráfico:</b> Se recortará con IA/atención a <b>1080x1920 (9:16)</b>, con plantilla oficial y fecha dinámica.
3️⃣ <b>Almacenamiento:</b> Subida temporal (48h) en Supabase + Respaldo seguro en Google Drive.
4️⃣ <b>Control:</b> Previsualiza el resultado y decide si publicar de inmediato o programar.

🆔 <b>Tu ID de Telegram:</b> <code>${ctx.from.id}</code>
  `.trim();

  await ctx.reply(welcomeText, { parse_mode: 'HTML' });
});

bot.command('id', (ctx) => {
  ctx.reply(`Tu Telegram ID es: <code>${ctx.from.id}</code>`, { parse_mode: 'HTML' });
});

// ==============================================================================
// 3. CONTROLADOR DE IMÁGENES (FOTO ESTÁNDAR Y DOCUMENTO)
// ==============================================================================

/**
 * Procesa la imagen recibida (descarga, Sharp, Supabase, Drive y botones de acción).
 */
async function handleImageMessage(ctx, fileId) {
  let statusMessage = null;

  try {
    statusMessage = await ctx.reply('⏳ <i>Descargando imagen y procesando formato Historia 9:16...</i>', {
      parse_mode: 'HTML'
    });

    // 1. Obtener enlace de descarga de Telegram
    const fileLink = await ctx.telegram.getFileLink(fileId);

    // 2. Descargar imagen en memoria como Buffer
    const downloadResponse = await axios.get(fileLink.href, {
      responseType: 'arraybuffer',
      timeout: 30000
    });
    const rawBuffer = Buffer.from(downloadResponse.data);

    // 3. Procesar imagen con Sharp (1080x1920, cover attention, plantilla PNG y SVG fecha)
    const processedBuffer = await imageProcessor.processStoryImage(rawBuffer);

    // Actualizar mensaje de estado
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMessage.message_id,
      null,
      '⏳ <i>Subiendo a Supabase Storage y respaldando en Google Drive...</i>',
      { parse_mode: 'HTML' }
    );

    // 4. Subida dual: Supabase (48h) y Google Drive (permanente)
    const storageResult = await storageService.uploadStoryDual(processedBuffer);

    // 5. Crear registro inicial en la tabla `scheduled_stories` en estado 'pending_review'
    const storyRecord = await storageService.insertScheduledStoryRecord({
      telegramUserId: ctx.from.id,
      telegramChatId: ctx.chat.id,
      filePath: storageResult.filePath,
      imageUrl: storageResult.publicUrl,
      driveFileId: storageResult.driveFileId,
      driveWebLink: storageResult.driveWebLink,
      status: 'pending_review'
    });

    // Eliminar el mensaje de carga
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMessage.message_id);
    } catch (_) {}

    // 6. Enviar previsualización con teclado inline interactivo
    const dateFormatted = imageProcessor.getFormattedSpanishDate();
    const caption = `
✨ <b>Previsualización de Historia (9:16)</b>

📅 <b>Fecha:</b> ${dateFormatted}
📐 <b>Dimensiones:</b> 1080 x 1920 px
☁️ <b>Storage:</b> Supabase (Retención 48h)
📁 <b>Respaldo Drive:</b> ${storageResult.driveFileId ? '✅ Asegurado' : '⚠️ No disponible'}

Selecciona una acción:
    `.trim();

    const inlineKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📱 Publicar Historia Ahora', `pub:${storyRecord.id}`)],
      [Markup.button.callback('⏰ Programar para las 10:00 PM', `sch:22:00:${storyRecord.id}`)],
      [Markup.button.callback('⏰ Programar para las 11:30 PM', `sch:23:30:${storyRecord.id}`)],
      [Markup.button.callback('❌ Descartar', `disc:${storyRecord.id}`)]
    ]);

    await ctx.replyWithPhoto(
      { source: processedBuffer },
      {
        caption,
        parse_mode: 'HTML',
        ...inlineKeyboard
      }
    );
  } catch (error) {
    console.error(`[ERROR BOT] Fallo al procesar imagen: ${error.message}`);
    if (statusMessage) {
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMessage.message_id,
          null,
          `❌ <b>Error durante el procesamiento:</b>\n${error.message}`,
          { parse_mode: 'HTML' }
        );
        return;
      } catch (_) {}
    }
    await ctx.reply(`❌ <b>Ocurrió un error:</b> ${error.message}`, { parse_mode: 'HTML' });
  }
}

// Escuchar fotos estándar (selecciona la de mayor resolución: photo[photo.length - 1])
bot.on('photo', async (ctx) => {
  const photos = ctx.message.photo;
  if (!photos || photos.length === 0) return;

  const highestResPhoto = photos[photos.length - 1];
  await handleImageMessage(ctx, highestResPhoto.file_id);
});

// Escuchar documentos tipo imagen (archivos sin compresión de Telegram)
bot.on('document', async (ctx) => {
  const doc = ctx.message.document;
  if (!doc) return;

  if (!doc.mime_type || !doc.mime_type.startsWith('image/')) {
    return ctx.reply('⚠️ El documento enviado no es una imagen válida (debe ser JPEG, PNG o WebP).');
  }

  await handleImageMessage(ctx, doc.file_id);
});

// ==============================================================================
// 4. ACCIONES DEL TECLADO INLINE (CALLBACK QUERIES)
// ==============================================================================

// Acción: Publicar Historia Ahora
bot.action(/^pub:(.+)$/, async (ctx) => {
  const storyId = ctx.match[1];
  await ctx.answerCbQuery('Iniciando publicación en Instagram Stories...');

  try {
    await ctx.editMessageCaption('⏳ <b>Publicando en Instagram Stories a través de Meta Graph API...</b>\nPor favor espera unos segundos...', {
      parse_mode: 'HTML'
    });

    const story = await storageService.getStoryById(storyId);
    if (!story) {
      throw new Error('No se encontró el registro de la historia en la base de datos.');
    }

    if (story.status === 'published') {
      return ctx.editMessageCaption('ℹ️ Esta historia ya fue publicada previamente.');
    }

    // Publicar vía Meta Graph API v21.0
    const { containerId, mediaId } = await metaService.publishStoryToInstagram(story.image_url);

    // Actualizar registro en Supabase
    await storageService.updateScheduledStoryRecord(storyId, {
      status: 'published',
      published_at: new Date().toISOString(),
      meta_container_id: containerId,
      meta_media_id: mediaId
    });

    const successCaption = `
🎉 <b>¡Historia Publicada con Éxito en Instagram Stories!</b>

🆔 <b>ID de Media:</b> <code>${mediaId}</code>
🕒 <b>Hora:</b> ${new Date().toLocaleTimeString('es-CO', { timeZone: config.system.timezone })}
🌐 <b>Estado:</b> En vivo en Instagram
    `.trim();

    await ctx.editMessageCaption(successCaption, { parse_mode: 'HTML' });
  } catch (error) {
    console.error(`[ERROR ACCIÓN PUBLICAR] ${error.message}`);
    await storageService.updateScheduledStoryRecord(storyId, {
      status: 'failed',
      error_message: error.message
    }).catch(() => {});

    await ctx.editMessageCaption(`⚠️ <b>Error al publicar en Instagram:</b>\n${error.message}`, {
      parse_mode: 'HTML'
    });
  }
});

// Acción: Programar Historia (ej. 10:00 PM o 11:30 PM)
bot.action(/^sch:(\d{2}):(\d{2}):(.+)$/, async (ctx) => {
  const targetHour = parseInt(ctx.match[1], 10);
  const targetMinute = parseInt(ctx.match[2], 10);
  const storyId = ctx.match[3];

  await ctx.answerCbQuery('Programando historia...');

  try {
    const scheduledDate = schedulerService.calculateScheduledDate(targetHour, targetMinute);

    await storageService.updateScheduledStoryRecord(storyId, {
      status: 'pending',
      scheduled_at: scheduledDate.toISOString()
    });

    const timeLabel = `${String(targetHour).padStart(2, '0')}:${String(targetMinute).padStart(2, '0')}`;
    const formattedTargetTime = scheduledDate.toLocaleString('es-CO', {
      timeZone: config.system.timezone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });

    const scheduleCaption = `
⏰ <b>¡Historia Programada con Éxito!</b>

🕒 <b>Hora programada:</b> ${timeLabel} (${formattedTargetTime})
📍 <b>Zona Horaria:</b> ${config.system.timezone}
🤖 El servicio publicará automáticamente la historia al cumplirse la hora.
    `.trim();

    await ctx.editMessageCaption(scheduleCaption, { parse_mode: 'HTML' });
  } catch (error) {
    console.error(`[ERROR ACCIÓN PROGRAMAR] ${error.message}`);
    await ctx.editMessageCaption(`⚠️ <b>Error al programar la historia:</b>\n${error.message}`, {
      parse_mode: 'HTML'
    });
  }
});

// Acción: Descartar Historia
bot.action(/^disc:(.+)$/, async (ctx) => {
  const storyId = ctx.match[1];
  await ctx.answerCbQuery('Historia descartada');

  try {
    const story = await storageService.getStoryById(storyId);
    if (story) {
      // Eliminar el archivo de Supabase Storage para liberar espacio
      await storageService.deleteSupabaseFile(story.file_path);
      // Actualizar registro
      await storageService.updateScheduledStoryRecord(storyId, {
        status: 'discarded',
        storage_cleaned: true,
        image_url: 'DISCARDED'
      });
    }

    await ctx.editMessageCaption('❌ <i>Esta historia ha sido descartada y eliminada del almacenamiento.</i>', {
      parse_mode: 'HTML'
    });
  } catch (error) {
    console.error(`[ERROR ACCIÓN DESCARTAR] ${error.message}`);
    await ctx.editMessageCaption('❌ <i>Historia descartada.</i>', { parse_mode: 'HTML' });
  }
});

export default bot;
