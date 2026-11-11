import axios from 'axios';

/**
 * Publica una imagen en los Estados de WhatsApp Business vía Evolution API v2
 * @param {string} imageUrl - URL pública de la imagen en Supabase
 * @param {string} caption - Texto de pie de foto (opcional)
 */
export async function publishWhatsAppStatus(imageUrl, caption = '') {
  const evolutionUrl = process.env.EVOLUTION_API_URL?.replace(/\/+$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE_NAME || 'tacosbar';

  if (!evolutionUrl || !apiKey) {
    console.warn('[WHATSAPP] EVOLUTION_API_URL o EVOLUTION_API_KEY no configurados. Saltando WhatsApp Status.');
    return null;
  }

  try {
    console.log(`[WHATSAPP] Publicando estado en la instancia '${instance}'...`);

    const endpoint = `${evolutionUrl}/message/sendStatus/${instance}`;
    
    const response = await axios.post(
      endpoint,
      {
        type: 'image',
        content: imageUrl,
        caption: caption,
        allContacts: true // Se publica para todos los contactos agendados
      },
      {
        headers: {
          apikey: apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 25000
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
