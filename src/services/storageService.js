import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { Readable } from 'stream';
import fs from 'fs';
import config from '../config/env.js';

// Polyfill seguro para entornos Node < 22 sin WebSocket nativo habilitado
// Evita excepciones durante la inicialización interna del módulo Realtime de Supabase
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class WebSocket {};
}

// Cliente Supabase instanciado con Service Role Key para operaciones de administración y storage
export const supabase = createClient(
  config.supabase.url || 'https://placeholder-project.supabase.co',
  config.supabase.serviceRoleKey || 'placeholder-service-key',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

// Inicialización de Google Drive API Client
let driveClient = null;

function getDriveClient() {
  if (driveClient) return driveClient;

  if (!fs.existsSync(config.googleDrive.credentialsPath)) {
    console.warn(`[WARN] Archivo de credenciales de Google Drive no encontrado en: ${config.googleDrive.credentialsPath}. Los respaldos en Drive estarán pausados.`);
    return null;
  }

  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: config.googleDrive.credentialsPath,
      scopes: ['https://www.googleapis.com/auth/drive.file']
    });

    driveClient = google.drive({ version: 'v3', auth });
    return driveClient;
  } catch (error) {
    console.error(`[ERROR] No se pudo inicializar Google Drive client: ${error.message}`);
    return null;
  }
}

/**
 * Sube la imagen a Supabase Storage en el bucket configurado ('social-media').
 * 
 * @param {Buffer} buffer - Imagen procesada en buffer
 * @param {string} filePath - Ruta dentro del bucket (ej. 'stories/story_12345.jpg')
 * @returns {Promise<{ filePath: string, publicUrl: string }>}
 */
export async function uploadToSupabaseStorage(buffer, filePath) {
  const { data, error } = await supabase.storage
    .from(config.supabase.bucketName)
    .upload(filePath, buffer, {
      contentType: 'image/jpeg',
      upsert: true
    });

  if (error) {
    throw new Error(`Error subiendo imagen a Supabase Storage: ${error.message}`);
  }

  const { data: publicUrlData } = supabase.storage
    .from(config.supabase.bucketName)
    .getPublicUrl(filePath);

  if (!publicUrlData?.publicUrl) {
    throw new Error('No se pudo generar la URL pública de Supabase Storage.');
  }

  return {
    filePath,
    publicUrl: publicUrlData.publicUrl
  };
}

/**
 * Sube una copia permanente de la imagen a Google Drive en la carpeta especificada.
 * 
 * @param {Buffer} buffer - Imagen a respaldar
 * @param {string} fileName - Nombre del archivo en Drive
 * @returns {Promise<{ driveFileId: string | null, driveWebLink: string | null }>}
 */
export async function uploadToGoogleDrive(buffer, fileName) {
  const drive = getDriveClient();
  if (!drive || !config.googleDrive.folderId) {
    console.warn('[WARN] Google Drive no está configurado o no se encontró credenciales. Omitiendo respaldo en Drive.');
    return { driveFileId: null, driveWebLink: null };
  }

  try {
    const mediaStream = Readable.from(buffer);

    const response = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [config.googleDrive.folderId]
      },
      media: {
        mimeType: 'image/jpeg',
        body: mediaStream
      },
      fields: 'id, name, webViewLink'
    });

    return {
      driveFileId: response.data.id || null,
      driveWebLink: response.data.webViewLink || null
    };
  } catch (error) {
    console.error(`[ERROR] Falló el respaldo en Google Drive: ${error.message}`);
    // No bloqueamos el flujo principal si Drive falla, pero registramos el error
    return { driveFileId: null, driveWebLink: null, error: error.message };
  }
}

/**
 * Almacenamiento Dual: Ejecuta la subida a Supabase Storage y a Google Drive de manera concurrente.
 * 
 * @param {Buffer} buffer - Buffer de imagen JPEG procesada
 * @param {string} [customName] - Nombre base opcional
 * @returns {Promise<{ filePath: string, publicUrl: string, driveFileId: string | null, driveWebLink: string | null }>}
 */
export async function uploadStoryDual(buffer, customName) {
  const timestamp = Date.now();
  const fileName = customName || `story_${timestamp}.jpg`;
  const storageFilePath = `stories/${fileName}`;

  // Ejecución simultánea en Supabase y Google Drive
  const [supabaseResult, driveResult] = await Promise.all([
    uploadToSupabaseStorage(buffer, storageFilePath),
    uploadToGoogleDrive(buffer, fileName)
  ]);

  return {
    filePath: supabaseResult.filePath,
    publicUrl: supabaseResult.publicUrl,
    driveFileId: driveResult.driveFileId,
    driveWebLink: driveResult.driveWebLink
  };
}

/**
 * Elimina un archivo de Supabase Storage.
 * 
 * @param {string} filePath - Ruta del archivo en el bucket
 * @returns {Promise<boolean>}
 */
export async function deleteSupabaseFile(filePath) {
  const { data, error } = await supabase.storage
    .from(config.supabase.bucketName)
    .remove([filePath]);

  if (error) {
    console.error(`[ERROR] No se pudo borrar ${filePath} de Supabase Storage: ${error.message}`);
    return false;
  }

  return true;
}

/**
 * Guarda un registro de historia en la tabla `scheduled_stories`.
 */
export async function insertScheduledStoryRecord({
  telegramUserId,
  telegramChatId,
  filePath,
  imageUrl,
  driveFileId,
  driveWebLink,
  scheduledAt = null,
  status = 'pending_review'
}) {
  const insertPayload = {
    telegram_user_id: telegramUserId,
    telegram_chat_id: telegramChatId,
    file_path: filePath,
    image_url: imageUrl,
    drive_file_id: driveFileId,
    drive_web_link: driveWebLink,
    status,
    scheduled_at: scheduledAt ? scheduledAt.toISOString() : null
  };

  const { data, error } = await supabase
    .from('scheduled_stories')
    .insert([insertPayload])
    .select()
    .single();

  if (error) {
    throw new Error(`Error al insertar en scheduled_stories: ${error.message}`);
  }

  return data;
}

/**
 * Obtiene una historia por su ID único.
 */
export async function getStoryById(id) {
  const { data, error } = await supabase
    .from('scheduled_stories')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    throw new Error(`Error al consultar historia ${id}: ${error.message}`);
  }

  return data;
}

/**
 * Actualiza los datos o estado de una historia programada.
 */
export async function updateScheduledStoryRecord(id, fieldsToUpdate) {
  const { data, error } = await supabase
    .from('scheduled_stories')
    .update(fieldsToUpdate)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Error al actualizar scheduled_stories (ID: ${id}): ${error.message}`);
  }

  return data;
}

/**
 * Obtiene historias pendientes cuya fecha de programación sea menor o igual a la actual.
 */
export async function getPendingStoriesDue(date = new Date()) {
  const { data, error } = await supabase
    .from('scheduled_stories')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', date.toISOString())
    .order('scheduled_at', { ascending: true });

  if (error) {
    throw new Error(`Error al consultar historias pendientes: ${error.message}`);
  }

  return data || [];
}

/**
 * Obtiene las historias creadas hace más de 48 horas cuyo almacenamiento no haya sido purgado.
 */
export async function getStoriesForPurge(hoursOld = 48) {
  const cutoffTime = new Date(Date.now() - hoursOld * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('scheduled_stories')
    .select('id, file_path, image_url, created_at')
    .lt('created_at', cutoffTime)
    .eq('storage_cleaned', false);

  if (error) {
    throw new Error(`Error al consultar historias para purgar: ${error.message}`);
  }

  return data || [];
}

export default {
  supabase,
  uploadToSupabaseStorage,
  uploadToGoogleDrive,
  uploadStoryDual,
  deleteSupabaseFile,
  insertScheduledStoryRecord,
  getStoryById,
  updateScheduledStoryRecord,
  getPendingStoriesDue,
  getStoriesForPurge
};
