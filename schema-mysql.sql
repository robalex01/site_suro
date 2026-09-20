-- ════════════════════════════════════════════════════════════════════════
--  SNAPTECH — SCHÉMA MySQL / MariaDB
--  Remplace neon.sql / schema-complet.sql / fix-db*.sql / migration_*.sql
--  (Postgres). À exécuter une fois dans phpMyAdmin (onglet SQL) sur la base
--  partagée par le site (Vercel) et le bot Discord.
--
--  Idempotent : CREATE TABLE IF NOT EXISTS.
--
--  Notes :
--   * DATETIME(3) = précision à la milliseconde. Important : le bot détecte
--     les nouveautés avec "updated_at > dernier curseur"; avec une précision à
--     la seconde, deux demandes modifiées dans la même seconde pourraient être
--     manquées.
--   * updated_at se met à jour tout seul à chaque UPDATE (remplace le trigger
--     Postgres update_updated_at_column).
--   * snap_stats et ses triggers ne sont pas recréés : plus rien dans le site
--     ni le bot ne les lit.
--   * Les tables bot_* et staff_preferences sont créées par le bot lui-même au
--     démarrage (l'utilisateur MySQL doit avoir le droit CREATE).
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS snap_requests (
    id                    INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username              VARCHAR(100) NOT NULL,
    phone                 VARCHAR(20)  NOT NULL,
    location              VARCHAR(50)  NOT NULL,
    operator              VARCHAR(50)  NOT NULL,
    lang                  VARCHAR(10)  NOT NULL,
    status                VARCHAR(30)  NOT NULL DEFAULT 'pending',
    ip_address            VARCHAR(45)  NULL,
    country               VARCHAR(50)  NULL,
    city                  VARCHAR(100) NULL,
    code_length           INT          NULL,
    staff_code            VARCHAR(6)   NULL,
    claimed_by_discord_id VARCHAR(30)  NULL DEFAULT NULL,
    created_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_snap_requests_phone (phone),           -- clé de l'UPSERT (api/snapchat.js)
    KEY idx_snap_requests_username   (username),
    KEY idx_snap_requests_status     (status),
    KEY idx_snap_requests_created_at (created_at),
    KEY idx_snap_requests_updated_at (updated_at),       -- polling du bot
    KEY idx_snap_requests_claimed    (claimed_by_discord_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS banned_ips (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    ip_address  VARCHAR(45)  NOT NULL,
    reason      VARCHAR(255) NULL,
    banned_by   VARCHAR(100) NULL,
    created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_banned_ips_ip (ip_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS snap_logs (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    request_id  INT UNSIGNED NULL,
    action      VARCHAR(50)  NOT NULL,
    details     JSON         NULL,        -- {"phone": "...", "staff_tag": "...", "discord_user_id": "..."}
    ip_address  VARCHAR(45)  NULL,
    user_agent  TEXT         NULL,
    created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_snap_logs_action  (action),
    KEY idx_snap_logs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ────────────────────────────────────────────────────────────────────────
--  SI TES TABLES EXISTENT DÉJÀ (créées avec une précision à la seconde) :
--  décommente et exécute ces lignes pour passer à la milliseconde.
-- ────────────────────────────────────────────────────────────────────────
-- ALTER TABLE snap_requests
--     MODIFY created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
--     MODIFY updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
--
-- Et vérifie qu'elles ont bien les colonnes claimed_by_discord_id (VARCHAR(30)),
-- une clé UNIQUE sur phone, et PAS de clé UNIQUE sur username.
