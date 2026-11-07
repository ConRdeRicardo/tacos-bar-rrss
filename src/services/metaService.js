import axios from 'axios';
import config from '../config/env.js';

const SLEEP_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 25; // 25 * 3s = 75s máximo de espera

/**
 * Función auxiliar para pausar la ejecución en milisegundos.
 * @param {number} ms 
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Crea un contenedor de media de tipo STORIES en Meta Graph API v21.0.
 * 
 * @param {string} imageUrl - URL pública de la imagen (Supabase)
 * @returns {Promise<string>} - ID del contenedor creado
 */
export async function createStoryMediaContainer(imageUrl) {
  const endpoint = `${config.meta.graphApiBaseUrl}/${config.meta.instagramAccountId}/media`;

  try {
    const response = await axios.post(
      endpoint,
      null,
      {
        params: {
          image_url: imageUrl,
          media_type: 'STORIES',
          access_token: config.meta.accessToken
        },
        timeout: 20000
      }
    );

    if (!response.data?.id) {
      throw new Error('Respuesta inválida de Meta: No se recibió container_id.');
    }

    return response.data.id;
  } catch (error) {
    const metaError = error.response?.data?.error;
    const errorDetails = metaError
      ? `[Meta Error ${metaError.code} / Subcode ${metaError.error_subcode || 'N/A'}]: ${metaError.message}`
      : error.message;

    console.error(`[ERROR] Fallo al crear contenedor de historia en Meta: ${errorDetails}`);
    throw new Error(errorDetails);
  }
}

/**
 * Realiza polling al contenedor de media en Meta Graph API cada 3 segundos
 * hasta que el status_code sea 'FINISHED'.
 * 
 * @param {string} containerId - ID del contenedor a consultar
 * @returns {Promise<boolean>}
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

      if (status_code === 'FINISHED') {
        return true;
      }

      if (status_code === 'ERROR' || status_code === 'EXPIRED') {
        throw new Error(`El procesamiento del contenedor falló en Meta con estado: ${status_code} (${status || 'Sin detalle'})`);
      }

      await sleep(SLEEP_INTERVAL_MS);
    } catch (error) {
      if (error.message.includes('falló en Meta con estado')) {
        throw error;
      }

      const metaError = error.response?.data?.error;
      const errorDetails = metaError ? metaError.message : error.message;
      console.warn(`[WARN] Intento ${attempts}/${MAX_POLL_ATTEMPTS} de polling en contenedor ${containerId} arrojó error de red: ${errorDetails}`);

      await sleep(SLEEP_INTERVAL_MS);
    }
  }

  throw new Error(`Timeout agotado (${MAX_POLL_ATTEMPTS * (SLEEP_INTERVAL_MS / 1000)}s) esperando que el contenedor ${containerId} esté listo en Meta.`);
}

/**
 * Publica el contenedor de historia previamente procesado en Instagram.
 * 
 * @param {string} containerId - ID del contenedor en estado FINISHED
 * @returns {Promise<string>} - ID del objeto de historia publicado
 */
export async function publishStoryMediaContainer(containerId) {
  const endpoint = `${config.meta.graphApiBaseUrl}/${config.meta.instagramAccountId}/media_publish`;

  try {
    const response = await axios.post(
      endpoint,
      null,
      {
        params: {
          creation_id: containerId,
          access_token: config.meta.accessToken
        },
        timeout: 20000
      }
    );

    if (!response.data?.id) {
      throw new Error('Respuesta inválida de Meta: No se recibió media_id publicado.');
    }

    return response.data.id;
  } catch (error) {
    const metaError = error.response?.data?.error;
    const errorDetails = metaError
      ? `[Meta Error ${metaError.code}]: ${metaError.message}`
      : error.message;

    console.error(`[ERROR] Fallo al publicar contenedor en Instagram: ${errorDetails}`);
    throw new Error(errorDetails);
  }
}

/**
 * Flujo completo de publicación de una Historia en Instagram.
 * 
 * @param {string} publicImageUrl - URL pública de la imagen
 * @returns {Promise<{ containerId: string, mediaId: string }>}
 */
export async function publishStoryToInstagram(publicImageUrl) {
  const containerId = await createStoryMediaContainer(publicImageUrl);
  await pollStoryContainerStatus(containerId);
  const mediaId = await publishStoryMediaContainer(containerId);

  return {
    containerId,
    mediaId
  };
}

/**
 * Publica una historia en la Fan Page de Facebook vinculada
 */
export async function publishFacebookStory(imageUrl) {
  const pageId = config.meta?.facebookPageId || process.env.FACEBOOK_PAGE_ID;
  const userAccessToken = config.meta?.accessToken || process.env.META_ACCESS_TOKEN;

  if (!pageId) {
    console.warn('[META] FACEBOOK_PAGE_ID no configurado. Saltando Facebook Story.');
    return null;
  }

  try {
    // 1. Obtener el Page Access Token de la página (para actuar 'as the page itself')
    console.log(`[META] Solicitando Page Access Token para la página ${pageId}...`);
    const pageTokenRes = await axios.get(
      `https://graph.facebook.com/v21.0/${pageId}`,
      {
        params: {
          fields: 'access_token',
          access_token: userAccessToken,
        },
        timeout: 15000
      }
    );

    const pageAccessToken = pageTokenRes.data?.access_token;
    if (!pageAccessToken) {
      throw new Error('No se pudo obtener el Page Access Token de Meta.');
    }

    // 2. Subir la imagen con el TOKEN DE LA PÁGINA (published: false)
    console.log('[META] Subiendo foto no publicada a la página de Facebook...');
    const uploadRes = await axios.post(
      `https://graph.facebook.com/v21.0/${pageId}/photos`,
      null,
      {
        params: {
          url: imageUrl,
          published: false,
          access_token: pageAccessToken,
        },
        timeout: 20000
      }
    );

    const photoId = uploadRes.data.id;

    // 3. Crear la historia en la página usando el photoId
    console.log(`[META] Publicando historia en Facebook (Photo ID: ${photoId})...`);
    const storyRes = await axios.post(
      `https://graph.facebook.com/v21.0/${pageId}/photo_stories`,
      null,
      {
        params: {
          photo_id: photoId,
          access_token: pageAccessToken,
        },
        timeout: 20000
      }
    );

    console.log(`[META] ✅ Historia de Facebook publicada con éxito: ID ${storyRes.data.post_id || storyRes.data.id || 'OK'}`);
    return storyRes.data;
  } catch (error) {
    const metaError = error.response?.data?.error;
    const errorDetails = metaError
      ? `[Meta Error ${metaError.code}]: ${metaError.message}`
      : error.message;

    console.error(`[META ERROR] Error al publicar historia en Facebook: ${errorDetails}`);
    return null;
  }
}

/**
 * Publica la historia tanto en Instagram como en Facebook en paralelo.
 * 
 * @param {string} publicImageUrl - URL pública de la imagen
 * @returns {Promise<{ instagram: object, facebook: object|null }>}
 */
export async function publishStoryToAll(publicImageUrl) {
  const results = { instagram: null, facebook: null };

  // 1. Disparo a Instagram
  try {
    results.instagram = await publishStoryToInstagram(publicImageUrl);
  } catch (err) {
    console.error('[META] Fallo al publicar en Instagram:', err.message);
    throw err;
  }

  // 2. Disparo a Facebook (captura error individual para no tumbar la confirmación de IG si FB falla)
  try {
    results.facebook = await publishFacebookStory(publicImageUrl);
  } catch (err) {
    console.error('[META] Fallo al publicar en Facebook:', err.message);
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
