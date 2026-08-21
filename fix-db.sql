-- ============================================================
-- MIGRATION : Ajout des colonnes manquantes v2.0
-- Exécute ce fichier dans l'éditeur SQL de Neon
-- ============================================================

-- Ajout des colonnes manquantes (si elles n'existent pas déjà)
ALTER TABLE snap_requests
    ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45),
    ADD COLUMN IF NOT EXISTS country VARCHAR(50),
    ADD COLUMN IF NOT EXISTS city VARCHAR(100),
    ADD COLUMN IF NOT EXISTS staff_code VARCHAR(6);

-- Vérification
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'snap_requests' 
ORDER BY ordinal_position;
