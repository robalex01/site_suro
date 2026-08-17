-- ============================================================
-- SNAPTECH - Base de données Neon (CORRIGÉ)
-- ============================================================

-- 1. Table principale
CREATE TABLE IF NOT EXISTS snap_requests (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    location VARCHAR(50) NOT NULL,
    operator VARCHAR(50) NOT NULL,
    lang VARCHAR(10) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(username),
    UNIQUE(phone)
);

-- 2. Index
CREATE INDEX IF NOT EXISTS idx_snap_requests_username ON snap_requests(username);
CREATE INDEX IF NOT EXISTS idx_snap_requests_phone ON snap_requests(phone);
CREATE INDEX IF NOT EXISTS idx_snap_requests_created_at ON snap_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snap_requests_status ON snap_requests(status);

-- 3. Logs
CREATE TABLE IF NOT EXISTS snap_logs (
    id SERIAL PRIMARY KEY,
    request_id INTEGER REFERENCES snap_requests(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    details JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Stats
CREATE TABLE IF NOT EXISTS snap_stats (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    total_requests INTEGER DEFAULT 0,
    pending_requests INTEGER DEFAULT 0,
    completed_requests INTEGER DEFAULT 0,
    failed_requests INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Fonction update_updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 6. Trigger updated_at
CREATE TRIGGER update_snap_requests_updated_at
    BEFORE UPDATE ON snap_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 7. Fonction stats INSERT
CREATE OR REPLACE FUNCTION update_snap_stats_insert()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO snap_stats (date, total_requests, pending_requests)
    VALUES (CURRENT_DATE, 1, 1)
    ON CONFLICT (date) DO UPDATE
    SET total_requests = snap_stats.total_requests + 1,
        pending_requests = snap_stats.pending_requests + 1,
        updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 8. Fonction stats UPDATE (CORRECTION BUG : gère les changements de statut)
CREATE OR REPLACE FUNCTION update_snap_stats_update()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'pending' AND NEW.status = 'completed' THEN
        UPDATE snap_stats 
        SET pending_requests = GREATEST(pending_requests - 1, 0),
            completed_requests = completed_requests + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE date = CURRENT_DATE;
    ELSIF OLD.status = 'pending' AND NEW.status = 'failed' THEN
        UPDATE snap_stats 
        SET pending_requests = GREATEST(pending_requests - 1, 0),
            failed_requests = failed_requests + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE date = CURRENT_DATE;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 9. Triggers stats
DROP TRIGGER IF EXISTS trigger_update_snap_stats ON snap_requests;
CREATE TRIGGER trigger_update_snap_stats_insert
    AFTER INSERT ON snap_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_snap_stats_insert();

DROP TRIGGER IF EXISTS trigger_update_snap_stats_update ON snap_requests;
CREATE TRIGGER trigger_update_snap_stats_update
    AFTER UPDATE OF status ON snap_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_snap_stats_update();