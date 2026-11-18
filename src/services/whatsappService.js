import axios from 'axios';

export async function publishWhatsAppStatus(mediaUrl, caption = '') {
  const evolutionUrl = process.env.EVOLUTION_API_URL?.replace(/\/+$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE_NAME || 'tacosbar';

  if (!evolutionUrl || !apiKey) {
    console.warn('[WHATSAPP] EVOLUTION_API_URL o EVOLUTION_API_KEY no configurados. Saltando WhatsApp Status.');
    return null;
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
        allContacts: true
      },
      {
        headers: {
          apikey: apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 45000
      }
    );

    console.log('[WHATSAPP] ✅ Estado publicado con éxito en WhatsApp:', response.data?.key?.id || 'OK');
    return response.data;
  } catch (error) {
    const errData = error.response?.data;
    const errorMsg = errData ? JSON.stringify(errData) : error.message;
    console.error(`[WHATSAPP ERROR] Fallo al publicar estado en WhatsApp: ${errorMsg}`);
    return null;
  }
}

export default {
  publishWhatsAppStatus
};
