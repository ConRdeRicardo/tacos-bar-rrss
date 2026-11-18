import axios from 'axios';
import config from '../config/env.js';
import { publishWhatsAppStatus } from './whatsappService.js';

const SLEEP_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 35; // Hasta 105s para dar tiempo al renderizado de video en Meta

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Crea contenedor de historia en Instagram (Foto o Video automáticamente)
 */
export async function createStoryMediaContainer(mediaUrl) {
  const endpoint = `${config.meta.graphApiBaseUrl}/${config.meta.instagramAccountId}/media`;
  const isVideo = mediaUrl.toLowerCase().includes('.mp4');

  const params = {
    media_type: 'STORIES',
    access_token: config.meta.accessToken
  };

  if (isVideo) {
    params.video_url = mediaUrl;
  } else {
    params.image_url = mediaUrl;
  }

  try {
    const response = await axios.post(endpoint, null, { params, timeout: 25000 });
    if (!response.data?.id) {
      throw new Error('Respuesta inválida de Meta: No se recibió container_id.');
    }
    return response.data.id;
  } catch (error) {
    const metaError = error.response?.data?.error;
    const errorDetails = metaError
      ? `[Meta Error ${metaError.code} / Subcode ${metaError.error_subcode || 'N/A'}]: ${metaError.message}`
      : error.message;
    console.error(`[ERROR] Fallo al crear contenedor en Instagram: ${errorDetails}`);
    throw new Error(errorDetails);
  }
}

/**
 * Polling del estado del contenedor en Instagram
 */
export async function pollStoryContainerStatus(containerId) {
  const endpoint = `${config.meta.graphApiBaseUrl}/${containerId}`;
  let attempts = 0;

  while (attempts < MAX_POLL_ATTEMPTS) {
    attempts++;
    try {
      const response = await axios.get(endpoint, {
        params: {
          fields: 'status_code,status',
          access_token: config.meta.accessToken
        },
        timeout: 15000
      });

      const { status_code, status } = response.data;
      if (status_code === 'FINISHED') return true;

      if (status_code === 'ERROR' || status_code === 'EXPIRED') {
        throw new Error(`El procesamiento del contenedor falló en Meta: ${status_code} (${status || 'Sin detalle'})`);
      }

      await sleep(SLEEP_INTERVAL_MS);
    } catch (error) {
      if (error.message.includes('falló en Meta')) throw error;
      await sleep(SLEEP_INTERVAL_MS);
    }
  }

  throw new Error(`Timeout esperando que el contenedor ${containerId} esté listo en Meta.`);
}

/**
 * Publica el contenedor de historia en Instagram
 */
export async function publishStoryMediaContainer(containerId) {
  const endpoint = `${config.meta.graphApiBaseUrl}/${config.meta.instagramAccountId}/media_publish`;

  const response = await axios.post(
    endpoint,
    null,
    {
      params: {
        creation_id: containerId,
        access_token: config.meta.accessToken
      },
      timeout: 25000
    }
  );

  if (!response.data?.id) {
    throw new Error('No se recibió media_id publicado en Instagram.');
  }
  return response.data.id;
}

/**
 * Flujo completo de publicación en Instagram (Foto o Video)
 */
export async function publishStoryToInstagram(publicMediaUrl) {
  const containerId = await createStoryMediaContainer(publicMediaUrl);
  await pollStoryContainerStatus(containerId);
  const mediaId = await publishStoryMediaContainer(containerId);
  return { containerId, mediaId };
}

/**
 * Publica historia en Facebook Page (Foto o Video automáticamente)
 */
export async function publishFacebookStory(mediaUrl) {
  const targetPageId = String(config.meta?.facebookPageId || process.env.FACEBOOK_PAGE_ID || '').trim();
  const pageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || config.meta?.accessToken || process.env.META_ACCESS_TOKEN;

  if (!targetPageId) {
    console.warn('[META] FACEBOOK_PAGE_ID no configurado. Saltando Facebook Story.');
    return null;
  }

  const isVideo = mediaUrl.toLowerCase().includes('.mp4');

  try {
    if (isVideo) {
      // FLUJO PARA VIDEO STORIES EN FACEBOOK (3 fases de Meta API)
      console.log(`[META] 1/3 Iniciando sesión de subida de Video Story en Facebook (${targetPageId})...`);
      const startRes = await axios.post(
        `${config.meta.graphApiBaseUrl}/${targetPageId}/video_stories`,
        null,
        {
          params: {
            upload_phase: 'start',
            access_token: pageAccessToken
          },
          timeout: 20000
        }
      );

      const { video_id, upload_url } = startRes.data;

      console.log(`[META] 2/3 Enviando archivo de video a Facebook (Video ID: ${video_id})...`);
      await axios.post(upload_url, null, {
        headers: {
          Authorization: `OAuth ${pageAccessToken}`,
          file_url: mediaUrl
        },
        timeout: 60000
      });

      console.log(`[META] 3/3 Finalizando y publicando Video Story en Facebook...`);
      const finishRes = await axios.post(
        `${config.meta.graphApiBaseUrl}/${targetPageId}/video_stories`,
        null,
        {
          params: {
            video_id: video_id,
            upload_phase: 'finish',
            access_token: pageAccessToken
          },
          timeout: 25000
        }
      );

      console.log(`[META] ✅ Video Story de Facebook publicada: ID ${finishRes.data?.post_id || video_id}`);
      return finishRes.data;
    } else {
      // FLUJO PARA FOTO STORIES EN FACEBOOK
      console.log(`[META] Subiendo foto no publicada a la página ${targetPageId}...`);
      const uploadRes = await axios.post(
        `${config.meta.graphApiBaseUrl}/${targetPageId}/photos`,
        null,
        {
          params: {
            url: mediaUrl,
            published: false,
            access_token: pageAccessToken
          },
          timeout: 20000
        }
      );

      const photoId = uploadRes.data?.id;
      const storyRes = await axios.post(
        `${config.meta.graphApiBaseUrl}/${targetPageId}/photo_stories`,
        null,
        {
          params: {
            photo_id: photoId,
            access_token: pageAccessToken
          },
          timeout: 20000
        }
      );

      console.log(`[META] ✅ Foto Story de Facebook publicada: ID ${storyRes.data?.post_id || 'OK'}`);
      return storyRes.data;
    }
  } catch (error) {
    const metaError = error.response?.data?.error;
    const errorDetails = metaError
      ? `[Meta Error ${metaError.code} / Subcode ${metaError.error_subcode || 'N/A'}]: ${metaError.message}`
      : error.message;
    console.error(`[META ERROR] Error al publicar historia en Facebook: ${errorDetails}`);
    return null;
  }
}

/**
 * Publica simultáneamente en Instagram, Facebook y WhatsApp
 */
export async function publishStoryToAll(publicMediaUrl) {
  const results = { instagram: null, facebook: null, whatsapp: null };

  try {
    results.instagram = await publishStoryToInstagram(publicMediaUrl);
  } catch (err) {
    console.error('[META] Fallo al publicar en Instagram:', err.message);
    throw err;
  }

  try {
    results.facebook = await publishFacebookStory(publicMediaUrl);
  } catch (err) {
    console.error('[META] Fallo en la llamada de Facebook:', err.message);
  }

  try {
    results.whatsapp = await publishWhatsAppStatus(publicMediaUrl);
  } catch (err) {
    console.error('[WHATSAPP] Fallo en la llamada de WhatsApp:', err.message);
  }

  return results;
}

export default {
  createStoryMediaContainer,
  pollStoryContainerStatus,
  publishStoryMediaContainer,
  publishStoryToInstagram,
  publishFacebookStory,
  publishStoryToAll
};
