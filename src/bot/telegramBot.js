import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';
import config from '../config/env.js';
import imageProcessor from '../services/imageProcessor.js';
import storageService from '../services/storageService.js';
import metaService from '../services/metaService.js';
import schedulerService from '../services/schedulerService.js';

export const bot = new Telegraf(config.telegram.token || '000000000:PLACEHOLDER_TOKEN_FOR_DEV', {
  handlerTimeout: 300000 // 5 minutos para evitar cortes en renderizado o subida de videos
});

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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

Envía una <b>foto o video</b> para procesarlo y publicarlo en Instagram, Facebook & WhatsApp:

1️⃣ <b>Envío:</b> Manda la foto o video (o como archivo/documento).
2️⃣ <b>Motor Gráfico:</b> Se adaptará a <b>1080x1920 (9:16)</b> con la plantilla oficial en PNG.
3️⃣ <b>Almacenamiento:</b> Subida temporal (48h) en Supabase + Respaldo seguro en Google Drive.
4️⃣ <b>Control:</b> Previsualiza el resultado, obtén el archivo en alta resolución y decide si publicar de inmediato o programar.

🆔 <b>Tu ID de Telegram:</b> <code>${ctx.from.id}</code>
  `.trim();

  ctx.reply(welcomeText, { parse_mode: 'HTML' });
});

bot.command('id', (ctx) => {
  ctx.reply(`Tu Telegram ID es: <code>${ctx.from.id}</code>`, { parse_mode: 'HTML' });
});

// ==============================================================================
// 3. CONTROLADOR MULTIMEDIA (FOTOS, VIDEOS Y DOCUMENTOS)
// ==============================================================================
async function handleMediaMessage(ctx, fileId, isVideoInput = false) {
  let statusMessage = null;

  try {
    statusMessage = await ctx.reply(
      isVideoInput
        ? '⏳ <i>Descargando video y renderizando formato Historia 9:16 con plantilla PNG...</i>'
        : '⏳ <i>Descargando imagen y procesando formato Historia 9:16 con plantilla PNG...</i>',
      { parse_mode: 'HTML' }
    );

    const fileLink = await ctx.telegram.getFileLink(fileId);

    const downloadResponse = await axios.get(fileLink.href, {
      responseType: 'arraybuffer',
      timeout: 60000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    const rawBuffer = Buffer.from(downloadResponse.data);

    const isVideo = isVideoInput || imageProcessor.isVideoBuffer(rawBuffer);

    const processedBuffer = isVideo
      ? await imageProcessor.processStoryVideo(rawBuffer)
      : await imageProcessor.processStoryImage(rawBuffer);

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMessage.message_id,
      null,
      '⏳ <i>Subiendo a Supabase Storage y respaldando en Google Drive...</i>',
      { parse_mode: 'HTML' }
    );

    const storageResult = await storageService.uploadStoryDual(processedBuffer);

    const storyRecord = await storageService.insertScheduledStoryRecord({
      telegramUserId: ctx.from.id,
      telegramChatId: ctx.chat.id,
      filePath: storageResult.filePath,
      imageUrl: storageResult.publicUrl,
      driveFileId: storageResult.driveFileId,
      driveWebLink: storageResult.driveWebLink,
      status: 'pending_review'
    });

    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMessage.message_id);
    } catch (_) {}

    const driveLinkText = storageResult.driveWebLink
      ? `<a href="${storageResult.driveWebLink}">Ver en Google Drive</a>`
      : '✅ Asegurado';

    const mediaLabel = isVideo ? 'Video Procesado' : 'Imagen Procesada';
    const extension = isVideo ? 'mp4' : 'jpg';

    const caption = `
✨ <b>${mediaLabel} (1080x1920 px)</b>

🔗 <b>Enlace directo:</b> <a href="${storageResult.publicUrl}">Abrir archivo procesado</a>
📁 <b>Respaldo Drive:</b> ${driveLinkText}

Selecciona una acción para continuar:
    `.trim();

    const inlineKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📱 Publicar Ahora (IG + FB + WA)', `pub:${storyRecord.id}`)],
      [Markup.button.callback('⏰ Programar para las 10:00 PM', `sch:22:00:${storyRecord.id}`)],
      [Markup.button.callback('⏰ Programar para las 11:30 PM', `sch:23:30:${storyRecord.id}`)],
      [Markup.button.callback('❌ Descartar', `disc:${storyRecord.id}`)]
    ]);

    if (isVideo) {
      await ctx.replyWithVideo(
        { source: processedBuffer, filename: `historia_${Date.now()}.mp4` },
        {
          caption,
          parse_mode: 'HTML',
          ...inlineKeyboard
        }
      );
    } else {
      await ctx.replyWithPhoto(
        { source: processedBuffer },
        {
          caption,
          parse_mode: 'HTML',
          ...inlineKeyboard
        }
      );
    }

    await ctx.replyWithDocument(
      { source: processedBuffer, filename: `historia_${Date.now()}.${extension}` },
      {
        caption: '📥 <b>Archivo original en alta resolución (1080x1920)</b> listo para guardar en el celular.',
        parse_mode: 'HTML'
      }
    );
  } catch (error) {
    console.error(`[ERROR BOT] Fallo al procesar multimedia: ${error.message}`);
    if (statusMessage) {
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMessage.message_id,
          null,
          `❌ <b>Error durante el procesamiento:</b>\n${escapeHtml(error.message)}`,
          { parse_mode: 'HTML' }
        );
        return;
      } catch (_) {}
    }
    await ctx.reply(`❌ <b>Ocurrió un error:</b> ${escapeHtml(error.message)}`, { parse_mode: 'HTML' });
  }
}

bot.on('photo', async (ctx) => {
  const photos = ctx.message.photo;
  if (!photos || photos.length === 0) return;

  const highestResPhoto = photos[photos.length - 1];
  await handleMediaMessage(ctx, highestResPhoto.file_id, false);
});

bot.on('video', async (ctx) => {
  const video = ctx.message.video;
  if (!video) return;

  await handleMediaMessage(ctx, video.file_id, true);
});

bot.on('animation', async (ctx) => {
  const animation = ctx.message.animation;
  if (!animation) return;

  await handleMediaMessage(ctx, animation.file_id, true);
});

bot.on('document', async (ctx) => {
  const doc = ctx.message.document;
  if (!doc || !doc.mime_type) return;

  const isImage = doc.mime_type.startsWith('image/');
  const isVideo = doc.mime_type.startsWith('video/');

  if (!isImage && !isVideo) {
    return ctx.reply('⚠️ El documento enviado no es válido. Envía una imagen (JPG, PNG, WebP) o un video (MP4, MOV).');
  }

  await handleMediaMessage(ctx, doc.file_id, isVideo);
});

// ==============================================================================
// 4. ACCIONES DEL TECLADO INLINE (CALLBACK QUERIES)
// ==============================================================================

bot.action(/^pub:(.+)$/, async (ctx) => {
  const storyId = ctx.match[1];
  await ctx.answerCbQuery('Iniciando publicación en IG, FB y WhatsApp...');

  try {
    await ctx.editMessageCaption(
      '⏳ <b>Publicando historia en Instagram, Facebook y WhatsApp...</b>\nPor favor espera unos segundos...',
      { parse_mode: 'HTML' }
    );

    const story = await storageService.getStoryById(storyId);
    if (!story) {
      throw new Error('No se encontró el registro de la historia en la base de datos.');
    }

    if (story.status === 'published') {
      return ctx.editMessageCaption('ℹ️ Esta historia ya fue publicada previamente.');
    }

    const results = await metaService.publishStoryToAll(story.image_url);

    const anyPublished = Boolean(results.instagram?.ok || results.facebook?.ok || results.whatsapp?.ok);

    await storageService.updateScheduledStoryRecord(storyId, {
      status: anyPublished ? 'published' : 'failed',
      published_at: anyPublished ? new Date().toISOString() : null,
      meta_container_id: results.instagram?.containerId || null,
      meta_media_id: results.instagram?.mediaId || null,
      error_message: anyPublished ? null : JSON.stringify(results)
    });

    const igLine = results.instagram?.ok
      ? `✅ Publicada (ID: <code>${escapeHtml(results.instagram.mediaId)}</code>)`
      : `❌ Error: ${escapeHtml(results.instagram?.error)}`;

    const fbLine = results.facebook?.ok
      ? `✅ Publicada (ID: <code>${escapeHtml(results.facebook.id)}</code>)`
      : `❌ Error: ${escapeHtml(results.facebook?.error)}`;

    const waLine = results.whatsapp?.ok
      ? `✅ Publicado (ID: <code>${escapeHtml(results.whatsapp.id)}</code>)`
      : `❌ Error: ${escapeHtml(results.whatsapp?.error)}`;

    const summaryCaption = `
${anyPublished ? '🎉 <b>¡Resultado de Publicación!</b>' : '⚠️ <b>No se pudo publicar en ninguna red</b>'}

📸 <b>Instagram:</b> ${igLine}
📘 <b>Facebook:</b> ${fbLine}
🟢 <b>WhatsApp:</b> ${waLine}
🕒 <b>Hora:</b> ${new Date().toLocaleTimeString('es-CO', { timeZone: config.system.timezone })}
    `.trim();

    await ctx.editMessageCaption(summaryCaption, { parse_mode: 'HTML' });
  } catch (error) {
    console.error(`[ERROR ACCIÓN PUBLICAR] ${error.message}`);
    await storageService.updateScheduledStoryRecord(storyId, {
      status: 'failed',
      error_message: error.message
    }).catch(() => {});

    const safeError = escapeHtml(error.message);
    try {
      await ctx.editMessageCaption(`⚠️ <b>Error durante la publicación:</b>\n${safeError}`, {
        parse_mode: 'HTML'
      });
    } catch (_) {
      await ctx.editMessageCaption(`⚠️ Error durante la publicación: ${error.message}`).catch(() => {});
    }
  }
});

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
🤖 El servicio publicará automáticamente la historia en Instagram, Facebook y WhatsApp al cumplirse la hora.
    `.trim();

    await ctx.editMessageCaption(scheduleCaption, { parse_mode: 'HTML' });
  } catch (error) {
    console.error(`[ERROR ACCIÓN PROGRAMAR] ${error.message}`);
    await ctx.editMessageCaption(`⚠️ <b>Error al programar la historia:</b>\n${escapeHtml(error.message)}`, {
      parse_mode: 'HTML'
    });
  }
});

bot.action(/^disc:(.+)$/, async (ctx) => {
  const storyId = ctx.match[1];
  await ctx.answerCbQuery('Historia descartada');

  try {
    const story = await storageService.getStoryById(storyId);
    if (story) {
      await storageService.deleteSupabaseFile(story.file_path);
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
