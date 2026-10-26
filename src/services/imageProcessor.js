import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import config from '../config/env.js';

const TEMPLATE_PATH = path.resolve('./assets/template_story.png');

/**
 * Genera la cadena de fecha actual en español en formato "DÍA_SEMANA, DÍA MES" (ej: "SÁBADO, 24 OCTUBRE")
 * utilizando la zona horaria configurada.
 * 
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
export function getFormattedSpanishDate(date = new Date()) {
  const timeZone = config.system.timezone;

  const weekdayFormatter = new Intl.DateTimeFormat('es-ES', { weekday: 'long', timeZone });
  const dayFormatter = new Intl.DateTimeFormat('es-ES', { day: 'numeric', timeZone });
  const monthFormatter = new Intl.DateTimeFormat('es-ES', { month: 'long', timeZone });

  const weekday = weekdayFormatter.format(date).toUpperCase();
  const day = dayFormatter.format(date);
  const month = monthFormatter.format(date).toUpperCase();

  return `${weekday}, ${day} ${month}`;
}

/**
 * Genera un Buffer SVG de 1080x1920 con la fecha estilizada en alta legibilidad,
 * tipografía sans-serif bold, color blanco (#FFFFFF) y filtro drop-shadow.
 * 
 * @param {string} dateText - Texto de fecha a renderizar
 * @returns {Buffer}
 */
export function generateDateSvgOverlay(dateText) {
  // Safe zone de Instagram Stories: El contenido se posiciona en Y=320 para no colisionar
  // con la barra de progreso de la historia ni el perfil del emisor.
  const svg = `
    <svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#000000" flood-opacity="0.95"/>
          <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.80"/>
        </filter>
        <linearGradient id="badgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#000000" stop-opacity="0.55"/>
          <stop offset="50%" stop-color="#000000" stop-opacity="0.70"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="0.55"/>
        </linearGradient>
      </defs>

      <!-- Píldora de contraste sutil para legibilidad óptima sobre fotos con luces intensas de discoteca -->
      <g filter="url(#shadow)">
        <rect x="240" y="270" width="600" height="70" rx="35" fill="url(#badgeGrad)" stroke="#FFFFFF" stroke-opacity="0.3" stroke-width="2"/>
        <text 
          x="540" 
          y="318" 
          text-anchor="middle" 
          font-family="'DejaVu Sans', 'Liberation Sans', Arial, Helvetica, sans-serif" 
          font-size="34" 
          font-weight="900" 
          fill="#FFFFFF" 
          letter-spacing="4"
        >${dateText}</text>
      </g>
    </svg>
  `.trim();

  return Buffer.from(svg);
}

/**
 * Procesa la imagen enviada por el bot:
 * 1. Redimensiona y recorta exactamente a 1080x1920 px (9:16) con fit: 'cover' y position: 'attention'.
 * 2. Superpone la plantilla PNG de ./assets/template_story.png (si existe).
 * 3. Genera y superpone el SVG dinámico con la fecha actual en español.
 * 4. Exporta como JPEG optimizado al 90% de calidad.
 * 
 * @param {Buffer} inputBuffer - Buffer binario de la imagen original recibida
 * @param {Date} [customDate=new Date()] - Fecha opcional a estampar
 * @returns {Promise<Buffer>} - Buffer de la imagen procesada en formato JPEG
 */
export async function processStoryImage(inputBuffer, customDate = new Date()) {
  if (!inputBuffer || !Buffer.isBuffer(inputBuffer)) {
    throw new Error('El parámetro inputBuffer debe ser un Buffer válido.');
  }

  // 1. Redimensionar y recortar la imagen base exactamente a 1080x1920 (9:16)
  const baseImage = sharp(inputBuffer)
    .resize(1080, 1920, {
      fit: 'cover',
      position: 'attention' // Algoritmo inteligente enfocado en las partes más luminosas/rostros
    });

  const composites = [];

  // 2. Superponer plantilla PNG si existe en disco
  if (fs.existsSync(TEMPLATE_PATH)) {
    try {
      const templateBuffer = await sharp(TEMPLATE_PATH)
        .resize(1080, 1920, { fit: 'fill' })
        .toBuffer();

      composites.push({
        input: templateBuffer,
        top: 0,
        left: 0,
        blend: 'over'
      });
    } catch (templateError) {
      console.warn(`[WARN] No se pudo procesar la plantilla PNG en ${TEMPLATE_PATH}: ${templateError.message}`);
    }
  } else {
    console.warn(`[WARN] Plantilla ${TEMPLATE_PATH} no encontrada. Continuando sin overlay de plantilla.`);
  }

  // 3. Generar capa SVG con la fecha en español
  const dateText = getFormattedSpanishDate(customDate);
  const svgDateBuffer = generateDateSvgOverlay(dateText);

  composites.push({
    input: svgDateBuffer,
    top: 0,
    left: 0,
    blend: 'over'
  });

  // 4. Componer todas las capas y exportar en JPEG optimizado (calidad 90)
  const outputBuffer = await baseImage
    .composite(composites)
    .jpeg({
      quality: 90,
      mozjpeg: true,
      chromaSubsampling: '4:4:4' // Máxima fidelidad de color
    })
    .toBuffer();

  return outputBuffer;
}

export default {
  processStoryImage,
  getFormattedSpanishDate,
  generateDateSvgOverlay
};
