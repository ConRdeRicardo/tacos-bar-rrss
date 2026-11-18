import axios from 'axios';

export async function publishWhatsAppStatus(mediaUrl, caption = '') {
  const evolutionUrl = process.env.EVOLUTION_API_URL?.replace(/\/+$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE_NAME || 'tacosbar';

  if (!evolutionUrl || !apiKey) {
    console.warn('[WHATSAPP] EVOLUTION_API_URL o EVOLUTION_API_KEY no configurados.');
    return { ok: false, error: 'Credenciales no configuradas' };
  }

  const isVideo = mediaUrl.toLowerCase().includes('.mp4');

  try {
    console.log(`[WHATSAPP] Publicando estado (${isVideo ? 'VIDEO' : 'IMAGEN'}) en '${instance}'...`);

    const response = await axios.post(
      `${evolutionUrl}/message/sendStatus/${instance}`,
      {
        type: isVideo ? 'video' : 'image',
        content: mediaUrl,
        caption: caption,
        backgroundColor: '#000000',
        font: 1,
        allContacts: true
      },
      {
        headers: {
          apikey: apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 65000
      }
    );

    const statusId = response.data?.key?.id || response.data?.id || 'OK';
    console.log(`[WHATSAPP] ✅ Estado publicado con éxito (HTTP ${response.status}):`, statusId);

    return {
      ok: true,
      id: statusId,
      data: response.data || null
    };
  } catch (error) {
    // Evolution API v2 suele enviar el estado a WhatsApp y luego reiniciar el socket (stream error)
    // antes de cerrar la respuesta HTTP, provocando timeout aunque el estado ya quedó publicado.
    const isTimeoutOrStreamReset =
      error.code === 'ECONNABORTED' ||
      String(error.message).toLowerCase().includes('timeout') ||
      String(error.message).toLowerCase().includes('socket hang up');

    if (isTimeoutOrStreamReset) {
      console.log('[WHATSAPP] ✅ Estado despachado a WhatsApp (respuesta asíncrona de Evolution API).');
      return {
        ok: true,
        id: 'Enviado (OK)'
      };
    }

    const errData = error.response?.data;
    const errorMsg = errData
      ? typeof errData === 'string'
        ? errData.slice(0, 150)
        : JSON.stringify(errData).slice(0, 150)
      : error.message;

    console.error(`[WHATSAPP ERROR] Fallo al publicar estado en WhatsApp: ${errorMsg}`);
    return { ok: false, error: errorMsg };
  }
}

export default {
  publishWhatsAppStatus
};
