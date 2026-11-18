import axios from 'axios';
import config from '../config/env.js';
import { publishWhatsAppStatus } from './whatsappService.js';

const SLEEP_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 40;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    console.log(`[META IG] Creando contenedor (${isVideo ? 'VIDEO' : 'IMAGEN'})...`);
    const response = await axios.post(endpoint, null, { params, timeout: 30000 });
    if (!response.data?.id) {
      throw new Error('Meta no devolvió container_id.');
    }
    console.log(`[META IG] Contenedor creado: ${response.data.id}`);
    return response.data.id;
  } catch (error) {
    const metaError = error.response?.data?.error;
    const errorDetails = metaError
      ? `Meta ${metaError.code} (${metaError.error_subcode || 'N/A'}): ${metaError.message}`
      : error.message;
    console.error(`[META IG ERROR] ${errorDetails}`);
    throw new Error(errorDetails);
  }
}

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
      console.log(`[META IG] Polling #${attempts} (${containerId}): ${status_code}`);

      if (status_code === 'FINISHED') return true;

      if (status_code === 'ERROR' || status_code === 'EXPIRED') {
        throw new Error(`Meta rechazó el archivo: ${status_code} (${status || 'Sin detalle'})`);
      }

      await sleep(SLEEP_INTERVAL_MS);
    } catch (error) {
      if (error.message.includes('Meta rechazó')) throw error;
      await sleep(SLEEP_INTERVAL_MS);
    }
  }

  throw new Error(`Timeout esperando procesamiento de Meta (${containerId}).`);
}

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
      timeout: 30000
    }
  );

  if (!response.data?.id) {
    throw new Error('No se recibió media_id publicado en Instagram.');
  }
  return response.data.id;
}

export async function publishStoryToInstagram(publicMediaUrl) {
  const containerId = await createStoryMediaContainer(publicMediaUrl);
  await pollStoryContainerStatus(containerId);
  const mediaId = await publishStoryMediaContainer(containerId);
  console.log(`[META IG] ✅ Historia publicada en Instagram: ${mediaId}`);
  return { ok: true, containerId, mediaId };
}

export async function publishFacebookStory(mediaUrl) {
  const targetPageId = String(config.meta?.facebookPageId || process.env.FACEBOOK_PAGE_ID || '').trim();
  const pageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || config.meta?.accessToken || process.env.META_ACCESS_TOKEN;

  if (!targetPageId) {
    return { ok: false, error: 'FACEBOOK_PAGE_ID no configurado' };
  }

  const isVideo = mediaUrl.toLowerCase().includes('.mp4');

  try {
    if (isVideo) {
      console.log(`[META FB] 1/3 Iniciando subida de Video Story (${targetPageId})...`);
      const startRes = await axios.post(
        `${config.meta.graphApiBaseUrl}/${targetPageId}/video_stories`,
        null,
        {
          params: {
            upload_phase: 'start',
            access_token: pageAccessToken
          },
          timeout: 25000
        }
      );

      const { video_id, upload_url } = startRes.data;

      console.log(`[META FB] 2/3 Enviando archivo de video (${video_id})...`);
      await axios.post(upload_url, null, {
        headers: {
          Authorization: `OAuth ${pageAccessToken}`,
          file_url: mediaUrl
        },
        timeout: 60000
      });

      console.log(`[META FB] 3/3 Finalizando Video Story (${video_id})...`);
      const finishRes = await axios.post(
        `${config.meta.graphApiBaseUrl}/${targetPageId}/video_stories`,
        null,
        {
          params: {
            video_id: video_id,
            upload_phase: 'finish',
            access_token: pageAccessToken
          },
          timeout: 30000
        }
      );

      const postId = finishRes.data?.post_id || video_id || 'OK';
      console.log(`[META FB] ✅ Video Story publicada en Facebook: ${postId}`);
      return { ok: true, id: postId };
    } else {
      console.log(`[META FB] Subiendo foto a la página ${targetPageId}...`);
      const uploadRes = await axios.post(
        `${config.meta.graphApiBaseUrl}/${targetPageId}/photos`,
        null,
        {
          params: {
            url: mediaUrl,
            published: false,
            access_token: pageAccessToken
          },
          timeout: 25000
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
          timeout: 25000
        }
      );

      const postId = storyRes.data?.post_id || storyRes.data?.id || 'OK';
      console.log(`[META FB] ✅ Foto Story publicada en Facebook: ${postId}`);
      return { ok: true, id: postId };
    }
  } catch (error) {
    const metaError = error.response?.data?.error;
    const errorDetails = metaError
      ? `Meta ${metaError.code} (${metaError.error_subcode || 'N/A'}): ${metaError.message}`
      : error.message;
    console.error(`[META FB ERROR] ${errorDetails}`);
    return { ok: false, error: errorDetails };
  }
}

/**
 * Publica en Instagram, Facebook y WhatsApp EN PARALELO para reducir el tiempo a la mitad
 */
export async function publishStoryToAll(publicMediaUrl) {
  const [igSettled, fbSettled, waSettled] = await Promise.allSettled([
    publishStoryToInstagram(publicMediaUrl),
    publishFacebookStory(publicMediaUrl),
    publishWhatsAppStatus(publicMediaUrl)
  ]);

  return {
    instagram:
      igSettled.status === 'fulfilled'
        ? igSettled.value
        : { ok: false, error: igSettled.reason?.message || 'Error en Instagram' },
    facebook:
      fbSettled.status === 'fulfilled'
        ? fbSettled.value
        : { ok: false, error: fbSettled.reason?.message || 'Error en Facebook' },
    whatsapp:
      waSettled.status === 'fulfilled'
        ? waSettled.value
        : { ok: false, error: waSettled.reason?.message || 'Error en WhatsApp' }
  };
}

export default {
  createStoryMediaContainer,
  pollStoryContainerStatus,
  publishStoryMediaContainer,
  publishStoryToInstagram,
  publishFacebookStory,
  publishStoryToAll
};
