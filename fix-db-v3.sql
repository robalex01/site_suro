-- ============================================================
-- MIGRATION v3.0 — Ajout des colonnes manquantes
-- Exécute ce fichier ENTIÈREMENT dans l'éditeur SQL de Neon
-- ============================================================

-- 1. Ajout colonnes snap_requests (si pas déjà fait)
ALTER TABLE snap_requests
    ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45),
    ADD COLUMN IF NOT EXISTS country VARCHAR(50),
    ADD COLUMN IF NOT EXISTS city VARCHAR(100),
    ADD COLUMN IF NOT EXISTS code_length INTEGER,
    ADD COLUMN IF NOT EXISTS staff_code VARCHAR(6);

-- 2. Ajout colonnes snap_stats (celles qui manquent et causent l'erreur)
ALTER TABLE snap_stats
    ADD COLUMN IF NOT EXISTS processing_requests INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS waiting_code_requests INTEGER DEFAULT 0;

-- 3. Recréation du trigger de stats (pour gérer tous les nouveaux statuts)
DROP TRIGGER IF EXISTS trigger_update_snap_stats_update ON snap_requests;
DROP FUNCTION IF EXISTS update_snap_stats_update();

CREATE OR REPLACE FUNCTION update_snap_stats_update()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'pending' AND NEW.status = 'processing' THEN
        UPDATE snap_stats 
        SET pending_requests = GREATEST(pending_requests - 1, 0),
            processing_requests = processing_requests + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE date = CURRENT_DATE;
    ELSIF OLD.status = 'processing' AND NEW.status = 'waiting_code' THEN
        UPDATE snap_stats 
        SET processing_requests = GREATEST(processing_requests - 1, 0),
            waiting_code_requests = waiting_code_requests + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE date = CURRENT_DATE;
    ELSIF OLD.status = 'waiting_code' AND NEW.status = 'completed' THEN
        UPDATE snap_stats 
        SET waiting_code_requests = GREATEST(waiting_code_requests - 1, 0),
            completed_requests = completed_requests + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE date = CURRENT_DATE;
    ELSIF OLD.status = 'pending' AND NEW.status = 'wrong_number' THEN
        UPDATE snap_stats 
        SET pending_requests = GREATEST(pending_requests - 1, 0),
            failed_requests = failed_requests + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE date = CURRENT_DATE;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER trigger_update_snap_stats_update
    AFTER UPDATE OF status ON snap_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_snap_stats_update();

-- 4. Création table banned_ips (si pas déjà fait)
CREATE TABLE IF NOT EXISTS banned_ips (
    id SERIAL PRIMARY KEY,
    ip_address VARCHAR(45) NOT NULL UNIQUE,
    reason VARCHAR(255),
    banned_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Vérification
SELECT 'snap_requests' as table_name, column_name, data_type 
FROM information_schema.columns WHERE table_name = 'snap_requests'
UNION ALL
SELECT 'snap_stats' as table_name, column_name, data_type 
FROM information_schema.columns WHERE table_name = 'snap_stats'
ORDER BY table_name, ordinal_position;
