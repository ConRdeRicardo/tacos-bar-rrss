import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1920;

/**
 * Localiza automáticamente la plantilla PNG dentro de la carpeta assets/
 */
function getTemplatePath() {
  const assetsDir = path.resolve(process.cwd(), 'assets');
  if (process.env.TEMPLATE_PATH && fs.existsSync(process.env.TEMPLATE_PATH)) {
    return process.env.TEMPLATE_PATH;
  }
  if (fs.existsSync(assetsDir)) {
    const pngFile = fs.readdirSync(assetsDir).find((f) => f.toLowerCase().endsWith('.png'));
    if (pngFile) {
      return path.join(assetsDir, pngFile);
    }
  }
  throw new Error('No se encontró ninguna plantilla .png dentro de la carpeta assets/');
}

/**
 * Detecta si un Buffer corresponde a un archivo de video MP4/MOV
 */
export function isVideoBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const header = buffer.subarray(4, 12).toString('ascii');
  return header.includes('ftyp') || header.includes('moov') || header.includes('wide');
}

/**
 * Procesa una IMAGEN a 1080x1920 (9:16) y le superpone únicamente la plantilla PNG
 */
export async function processStoryImage(inputBuffer) {
  // Si recibe un video por esta misma función, lo redirige al procesador de video
  if (isVideoBuffer(inputBuffer)) {
    return await processStoryVideo(inputBuffer);
  }

  const templatePath = getTemplatePath();

  // Asegurar que la plantilla PNG tenga exactamente 1080x1920
  const overlayBuffer = await sharp(templatePath)
    .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: 'fill' })
    .png()
    .toBuffer();

  // Redimensionar foto de fondo y colocar la plantilla encima (sin fecha)
  const finalImageBuffer = await sharp(inputBuffer)
    .rotate() // Respeta orientación EXIF del celular
    .resize(TARGET_WIDTH, TARGET_HEIGHT, {
      fit: 'cover',
      position: 'center'
    })
    .composite([
      {
        input: overlayBuffer,
        top: 0,
        left: 0
      }
    ])
    .jpeg({ quality: 92 })
    .toBuffer();

  return finalImageBuffer;
}

/**
 * Procesa un VIDEO a 1080x1920 (9:16) y le superpone únicamente la plantilla PNG con FFmpeg
 */
export async function processStoryVideo(inputVideoBuffer) {
  const templatePath = getTemplatePath();
  const tempId = `story_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const tempInputPath = path.join(os.tmpdir(), `${tempId}_in.mp4`);
  const tempOverlayPath = path.join(os.tmpdir(), `${tempId}_overlay.png`);
  const tempOutputPath = path.join(os.tmpdir(), `${tempId}_out.mp4`);

  try {
    // 1. Guardar video temporalmente en disco
    await fs.promises.writeFile(tempInputPath, inputVideoBuffer);

    // 2. Preparar la plantilla PNG a 1080x1920 exactos
    await sharp(templatePath)
      .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: 'fill' })
      .png()
      .toFile(tempOverlayPath);

    // 3. Ejecutar FFmpeg: escalar/recortar a 9:16 (1080x1920), superponer PNG y limitar a máx 60s
    const filterComplex = `[0:v]scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=increase,crop=${TARGET_WIDTH}:${TARGET_HEIGHT},setsar=1,fps=30[bg];[1:v]scale=${TARGET_WIDTH}:${TARGET_HEIGHT}[ov];[bg][ov]overlay=0:0:format=auto[v]`;

    const ffmpegArgs = [
      '-y',
      '-i', tempInputPath,
      '-i', tempOverlayPath,
      '-filter_complex', filterComplex,
      '-map', '[v]',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-t', '60',
      tempOutputPath
    ];

    console.log('[VIDEO] Renderizando video 9:16 con plantilla PNG en FFmpeg...');
    await execFileAsync('ffmpeg', ffmpegArgs);

    // 4. Leer el video procesado a memoria
    const outputBuffer = await fs.promises.readFile(tempOutputPath);
    console.log('[VIDEO] ✅ Video procesado correctamente.');
    return outputBuffer;
  } finally {
    // 5. Limpiar archivos temporales
    for (const file of [tempInputPath, tempOverlayPath, tempOutputPath]) {
      if (fs.existsSync(file)) {
        await fs.promises.unlink(file).catch(() => {});
      }
    }
  }
}

// Alias de compatibilidad por si telegramBot.js importa otro nombre
export const processImage = processStoryImage;

export default {
  processStoryImage,
  processStoryVideo,
  processImage,
  isVideoBuffer
};
