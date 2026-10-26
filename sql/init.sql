-- ==============================================================================
-- DDL DE INICIALIZACIÓN PARA SUPABASE
-- Base de Datos & Almacenamiento para Microservicio de Historias de Instagram
-- ==============================================================================

-- 1. Habilitar extensión UUID si no está activa
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Creación del Bucket en Supabase Storage (público para que Meta Graph API pueda descargar la imagen)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'social-media',
    'social-media',
    true,
    20971520, -- 20MB límite
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
    public = true,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- 3. Políticas de acceso para Supabase Storage (lectura pública)
CREATE POLICY "Public Access for Story Images"
ON storage.objects FOR SELECT
USING (bucket_id = 'social-media');

CREATE POLICY "Service Role Full Access for Story Images"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'social-media')
WITH CHECK (bucket_id = 'social-media');

-- 4. Creación de la tabla `scheduled_stories`
CREATE TABLE IF NOT EXISTS public.scheduled_stories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_user_id BIGINT NOT NULL,
    telegram_chat_id BIGINT NOT NULL,
    file_path TEXT NOT NULL,                                          -- Ruta en Supabase Storage (ej. stories/story_12345.jpg)
    image_url TEXT NOT NULL,                                          -- URL pública de la imagen
    drive_file_id TEXT,                                               -- ID del archivo de respaldo en Google Drive
    drive_web_link TEXT,                                              -- Link de visualización en Google Drive
    status TEXT NOT NULL DEFAULT 'pending_review' 
        CHECK (status IN ('pending_review', 'pending', 'publishing', 'published', 'failed', 'discarded')),
    scheduled_at TIMESTAMPTZ,                                         -- Fecha y hora exacta programada para publicación (null si aún en revisión)
    published_at TIMESTAMPTZ,                                         -- Fecha y hora real de publicación en Instagram
    storage_cleaned BOOLEAN NOT NULL DEFAULT false,                   -- Bandera de purga a las 48h
    error_message TEXT,                                               -- Detalle en caso de fallo en Meta Graph API
    meta_container_id TEXT,                                           -- ID del contenedor de media en Meta
    meta_media_id TEXT,                                               -- ID final del objeto publicado en Instagram
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Índices de alto rendimiento para los Cronjobs
-- Índice parcial para el cron de cada minuto: búsqueda de historias pendientes listas para publicar
CREATE INDEX IF NOT EXISTS idx_scheduled_stories_pending_queue 
ON public.scheduled_stories (scheduled_at) 
WHERE status = 'pending';

-- Índice parcial para la purga de 48 horas a las 04:00 AM
CREATE INDEX IF NOT EXISTS idx_scheduled_stories_storage_cleanup 
ON public.scheduled_stories (created_at) 
WHERE storage_cleaned = false;

-- 6. Trigger para actualización automática de `updated_at`
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_scheduled_stories ON public.scheduled_stories;
CREATE TRIGGER set_updated_at_scheduled_stories
BEFORE UPDATE ON public.scheduled_stories
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Comentarios explicativos
COMMENT ON TABLE public.scheduled_stories IS 'Registro de historias procesadas, estado de publicación en Instagram y control de purga temporal de 48h.';
