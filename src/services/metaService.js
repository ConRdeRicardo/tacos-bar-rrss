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

      // Si está en 'IN_PROGRESS', esperamos 3 segundos antes del siguiente intento
      await sleep(SLEEP_INTERVAL_MS);
    } catch (error) {
      // Si el error viene de la validación interna de status_code, relanzarlo
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
 * Flujo completo de publicación de una Historia en Instagram:
 * 1. Crear contenedor (media_type: STORIES).
 * 2. Polling cada 3 segundos hasta status_code === FINISHED.
 * 3. Publicar el contenedor en la cuenta de Instagram.
 * 
 * @param {string} publicImageUrl - URL pública de la imagen
 * @returns {Promise<{ containerId: string, mediaId: string }>}
 */
export async function publishStoryToInstagram(publicImageUrl) {
  // 1. Crear contenedor
  const containerId = await createStoryMediaContainer(publicImageUrl);

  // 2. Esperar a que Meta finalice la descarga y codificación de la imagen
  await pollStoryContainerStatus(containerId);

  // 3. Publicar en Instagram
  const mediaId = await publishStoryMediaContainer(containerId);

  return {
    containerId,
    mediaId
  };
}

export default {
  createStoryMediaContainer,
  pollStoryContainerStatus,
  publishStoryMediaContainer,
  publishStoryToInstagram
};
