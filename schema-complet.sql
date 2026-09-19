-- ════════════════════════════════════════════════════════════════════════
--  SNAPTECH — SCHÉMA SQL COMPLET CONSOLIDÉ
-- ════════════════════════════════════════════════════════════════════════
--  Regroupe TOUT ce qui existait éparpillé dans le projet :
--    - neon.sql                (schéma de base v3.1)
--    - fix-db.sql              (migration v2.0 — colonnes manquantes)
--    - fix-db-v3.sql           (migration v3.0 — colonnes + trigger stats)
--    - migration_v2.2.sql      (claimed_by_discord_id)
--    - migration_v2.3.sql      (suppression UNIQUE(username))
--    - snap_logs.sql           (version simple, remplacée par la v3.1 enrichie)
--    - bot/src/database.js     (bot_instance_lock — créée en JS, jamais en .sql)
--
--  100% IDEMPOTENT : safe à exécuter sur une base neuve OU déjà migrée.
--  Tout est en IF NOT EXISTS / IF EXISTS / ADD COLUMN IF NOT EXISTS.
--
--  ⚠️ CORRECTIF inclus (pas un simple copier-coller) :
--  Le trigger de stats (update_snap_stats_update) dans neon.sql/fix-db-v3.sql
--  ne gérait pas toutes les transitions réellement utilisées par le code
--  actuel de api/staff-action.js :
--    - wrong_number est déclenché depuis 'processing' OU 'retry_code'
--      (pas seulement 'pending' comme l'ancien trigger le supposait)
--    - retry_code → waiting_code (après un false_code, re-choix de longueur)
--      n'était pas géré du tout
--    - unclaim (processing/retry_code → pending) n'était pas géré : les
--      compteurs restaient bloqués sur "processing" pour une demande qui
--      était pourtant repassée en attente
--  La version ci-dessous corrige ces trois trous.
-- ════════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────────
-- 1. TABLE PRINCIPALE : snap_requests
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS snap_requests (
    id                      SERIAL PRIMARY KEY,
    username                VARCHAR(100) NOT NULL,
    phone                   VARCHAR(20)  NOT NULL UNIQUE,
    location                VARCHAR(50)  NOT NULL,
    operator                VARCHAR(50)  NOT NULL,
    lang                    VARCHAR(10)  NOT NULL,
    status                  VARCHAR(30)  DEFAULT 'pending',
    ip_address              VARCHAR(45),
    country                 VARCHAR(50),
    city                    VARCHAR(100),
    code_length             INTEGER,
    staff_code              VARCHAR(6),
    claimed_by_discord_id   VARCHAR(30)  DEFAULT NULL,
    created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chemin de mise à niveau pour une table créée par une ancienne version du schéma
ALTER TABLE snap_requests
    ADD COLUMN IF NOT EXISTS ip_address             VARCHAR(45),
    ADD COLUMN IF NOT EXISTS country                VARCHAR(50),
    ADD COLUMN IF NOT EXISTS city                   VARCHAR(100),
    ADD COLUMN IF NOT EXISTS code_length            INTEGER,
    ADD COLUMN IF NOT EXISTS staff_code             VARCHAR(6),
    ADD COLUMN IF NOT EXISTS claimed_by_discord_id  VARCHAR(30) DEFAULT NULL;

-- v2.3 : un même username peut être réutilisé par plusieurs numéros
-- (seul le numéro reste unique, utilisé pour l'UPSERT dans api/snapchat.js)
ALTER TABLE snap_requests DROP CONSTRAINT IF EXISTS snap_requests_username_key;


-- ────────────────────────────────────────────────────────────────────────
-- 2. IPs BANNIES : banned_ips
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS banned_ips (
    id          SERIAL PRIMARY KEY,
    ip_address  VARCHAR(45) NOT NULL UNIQUE,
    reason      VARCHAR(255),
    banned_by   VARCHAR(100),
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ────────────────────────────────────────────────────────────────────────
-- 3. LOGS : snap_logs (version enrichie v3.1 — remplace snap_logs.sql)
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS snap_logs (
    id          SERIAL PRIMARY KEY,
    request_id  INTEGER REFERENCES snap_requests(id) ON DELETE SET NULL,
    action      VARCHAR(50) NOT NULL,
    details     JSONB,
    ip_address  VARCHAR(45),
    user_agent  TEXT,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chemin de mise à niveau si la table existait déjà en version simple (snap_logs.sql)
ALTER TABLE snap_logs
    ADD COLUMN IF NOT EXISTS request_id INTEGER REFERENCES snap_requests(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45),
    ADD COLUMN IF NOT EXISTS user_agent TEXT;


-- ────────────────────────────────────────────────────────────────────────
-- 4. STATS JOURNALIÈRES : snap_stats
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS snap_stats (
    id                       SERIAL PRIMARY KEY,
    date                     DATE NOT NULL UNIQUE,
    total_requests           INTEGER DEFAULT 0,
    pending_requests          INTEGER DEFAULT 0,
    processing_requests       INTEGER DEFAULT 0,
    waiting_code_requests     INTEGER DEFAULT 0,
    code_submitted_requests   INTEGER DEFAULT 0,
    completed_requests        INTEGER DEFAULT 0,
    failed_requests           INTEGER DEFAULT 0,
    created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE snap_stats
    ADD COLUMN IF NOT EXISTS processing_requests     INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS waiting_code_requests    INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS code_submitted_requests  INTEGER DEFAULT 0;


-- ────────────────────────────────────────────────────────────────────────
-- 5. VERROU D'INSTANCE DU BOT : bot_instance_lock
--    (jusqu'ici créée uniquement en JS par bot/src/database.js, jamais
--    documentée dans un .sql — ajoutée ici pour que TOUT le schéma soit
--    dans ce fichier)
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bot_instance_lock (
    id              INTEGER PRIMARY KEY DEFAULT 1,
    instance_id     TEXT NOT NULL,
    hostname        TEXT,
    pid             INTEGER,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_heartbeat  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT bot_instance_lock_single_row CHECK (id = 1)
);


-- ────────────────────────────────────────────────────────────────────────
-- 6. INDEX
-- ────────────────────────────────────────────────────────────────────────

-- username : plus unique depuis v2.3, mais toujours indexé pour la recherche
DROP INDEX IF EXISTS idx_snap_requests_username;
CREATE INDEX IF NOT EXISTS idx_snap_requests_username  ON snap_requests (username);

CREATE INDEX IF NOT EXISTS idx_snap_requests_phone       ON snap_requests (phone);
CREATE INDEX IF NOT EXISTS idx_snap_requests_status      ON snap_requests (status);
CREATE INDEX IF NOT EXISTS idx_snap_requests_created_at  ON snap_requests (created_at DESC);

-- Recherche rapide "qui a claim ce numéro" (utilisé par le bot après un restart)
CREATE INDEX IF NOT EXISTS idx_snap_requests_claimed
    ON snap_requests (phone, claimed_by_discord_id)
    WHERE claimed_by_discord_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────────────────
-- 7. TRIGGERS / FONCTIONS
-- ────────────────────────────────────────────────────────────────────────

-- 7a. updated_at automatique
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

-- 7b. Stats — nouvelle demande (INSERT)
CREATE OR REPLACE FUNCTION update_snap_stats_insert()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO snap_stats (date, total_requests, pending_requests)
    VALUES (CURRENT_DATE, 1, 1)
    ON CONFLICT (date) DO UPDATE
    SET total_requests   = snap_stats.total_requests + 1,
        pending_requests = snap_stats.pending_requests + 1,
        updated_at       = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trigger_update_snap_stats_insert ON snap_requests;
CREATE TRIGGER trigger_update_snap_stats_insert
    AFTER INSERT ON snap_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_snap_stats_insert();

-- 7c. Stats — changement de statut (UPDATE)
--
-- CORRIGÉ pour coller aux transitions réelles de api/staff-action.js v2.2 :
--   claim         : pending          → processing
--   set_length    : processing/retry_code → waiting_code
--   verify-code   : waiting_code/retry_code → code_submitted
--   true_code     : code_submitted   → completed
--   false_code    : code_submitted   → retry_code
--   wrong_number  : processing/retry_code → wrong_number   (PAS que depuis pending)
--   unclaim       : processing/retry_code → pending         (jamais géré avant)
CREATE OR REPLACE FUNCTION update_snap_stats_update()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'pending' AND NEW.status = 'processing' THEN
        UPDATE snap_stats
        SET pending_requests    = GREATEST(pending_requests - 1, 0),
            processing_requests = processing_requests + 1,
            updated_at          = CURRENT_TIMESTAMP
        WHERE date = CURRENT_DATE;

    ELSIF OLD.status IN ('processing', 'retry_code') AND NEW.status = 'waiting_code' THEN
        UPDATE snap_stats
        SET processing_requests   = CASE WHEN OLD.status = 'processing'
                                          THEN GREATEST(processing_requests - 1, 0)
                                          ELSE processing_requests END,
            waiting_code_requests = waiting_code_requests + 1,
            updated_at            = CURRENT_TIMESTAMP
        WHERE date = CURRENT_DATE;

    ELSIF OLD.status IN ('waiting_code', 'retry_code') AND NEW.status = 'code_submitted' THEN
        UPDATE snap_stats
        SET waiting_code_requests   = GREATEST(waiting_code_requests - 1, 0),
            code_submitted_requests = code_submitted_requests + 1,
            updated_at              = CURRENT_TIMESTAMP
        WHERE date = CURRENT_DATE;

    ELSIF OLD.status = 'code_submitted' AND NEW.status = 'completed' THEN
        UPDATE snap_stats
        SET code_submitted_requests = GREATEST(code_submitted_requests - 1, 0),
            completed_requests      = completed_requests + 1,
            updated_at              = CURRENT_TIMESTAMP
        WHERE date = CURRENT_DATE;

    ELSIF OLD.status = 'code_submitted' AND NEW.status = 'retry_code' THEN
        UPDATE snap_stats
        SET code_submitted_requests = GREATEST(code_submitted_requests - 1, 0),
            waiting_code_requests   = waiting_code_requests + 1,
            updated_at              = CURRENT_TIMESTAMP
        WHERE date = CURRENT_DATE;

    ELSIF OLD.status IN ('pending', 'processing', 'retry_code') AND NEW.status = 'wrong_number' THEN
        UPDATE snap_stats
        SET pending_requests    = CASE WHEN OLD.status = 'pending'
                                        THEN GREATEST(pending_requests - 1, 0)
                                        ELSE pending_requests END,
            processing_requests = CASE WHEN OLD.status IN ('processing', 'retry_code')
                                        THEN GREATEST(processing_requests - 1, 0)
                                        ELSE processing_requests END,
            failed_requests     = failed_requests + 1,
            updated_at          = CURRENT_TIMESTAMP
        WHERE date = CURRENT_DATE;

    ELSIF OLD.status IN ('processing', 'retry_code') AND NEW.status = 'pending' THEN
        -- unclaim : retour dans la file d'attente
        UPDATE snap_stats
        SET processing_requests = GREATEST(processing_requests - 1, 0),
            pending_requests    = pending_requests + 1,
            updated_at          = CURRENT_TIMESTAMP
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


-- ────────────────────────────────────────────────────────────────────────
-- 8. VÉRIFICATION (optionnel — à commenter/supprimer si tu automatises ce script)
-- ────────────────────────────────────────────────────────────────────────

SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('snap_requests', 'snap_stats', 'snap_logs', 'banned_ips', 'bot_instance_lock')
ORDER BY table_name, ordinal_position;
