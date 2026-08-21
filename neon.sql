-- ============================================================
-- SNAPTECH v3.1 — Schéma DB (avec code_submitted + retry_code)
-- ============================================================

-- 1. Table principale
CREATE TABLE IF NOT EXISTS snap_requests (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    location VARCHAR(50) NOT NULL,
    operator VARCHAR(50) NOT NULL,
    lang VARCHAR(10) NOT NULL,
    status VARCHAR(30) DEFAULT 'pending',
    ip_address VARCHAR(45),
    country VARCHAR(50),
    city VARCHAR(100),
    code_length INTEGER,
    staff_code VARCHAR(6),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(username),
    UNIQUE(phone)
);

-- 2. IPs bannies
CREATE TABLE IF NOT EXISTS banned_ips (
    id SERIAL PRIMARY KEY,
    ip_address VARCHAR(45) NOT NULL UNIQUE,
    reason VARCHAR(255),
    banned_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Index
CREATE INDEX IF NOT EXISTS idx_snap_requests_username ON snap_requests(username);
CREATE INDEX IF NOT EXISTS idx_snap_requests_phone ON snap_requests(phone);
CREATE INDEX IF NOT EXISTS idx_snap_requests_status ON snap_requests(status);
CREATE INDEX IF NOT EXISTS idx_snap_requests_created_at ON snap_requests(created_at DESC);

-- 4. Logs
CREATE TABLE IF NOT EXISTS snap_logs (
    id SERIAL PRIMARY KEY,
    request_id INTEGER REFERENCES snap_requests(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    details JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Stats
CREATE TABLE IF NOT EXISTS snap_stats (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    total_requests INTEGER DEFAULT 0,
    pending_requests INTEGER DEFAULT 0,
    processing_requests INTEGER DEFAULT 0,
    waiting_code_requests INTEGER DEFAULT 0,
    code_submitted_requests INTEGER DEFAULT 0,
    completed_requests INTEGER DEFAULT 0,
    failed_requests INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_snap_requests_updated_at ON snap_requests;
CREATE TRIGGER update_snap_requests_updated_at
    BEFORE UPDATE ON snap_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 7. Stats INSERT trigger
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

DROP TRIGGER IF EXISTS trigger_update_snap_stats_insert ON snap_requests;
CREATE TRIGGER trigger_update_snap_stats_insert
    AFTER INSERT ON snap_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_snap_stats_insert();

-- 8. Stats UPDATE trigger (v3.1 — gère tous les statuts)
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
    ELSIF OLD.status = 'waiting_code' AND NEW.status = 'code_submitted' THEN
        UPDATE snap_stats 
        SET waiting_code_requests = GREATEST(waiting_code_requests - 1, 0),
            code_submitted_requests = code_submitted_requests + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE date = CURRENT_DATE;
    ELSIF OLD.status = 'code_submitted' AND NEW.status = 'completed' THEN
        UPDATE snap_stats 
        SET code_submitted_requests = GREATEST(code_submitted_requests - 1, 0),
            completed_requests = completed_requests + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE date = CURRENT_DATE;
    ELSIF OLD.status = 'code_submitted' AND NEW.status = 'retry_code' THEN
        UPDATE snap_stats 
        SET code_submitted_requests = GREATEST(code_submitted_requests - 1, 0),
            waiting_code_requests = waiting_code_requests + 1,
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

DROP TRIGGER IF EXISTS trigger_update_snap_stats_update ON snap_requests;
CREATE TRIGGER trigger_update_snap_stats_update
    AFTER UPDATE OF status ON snap_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_snap_stats_update();
