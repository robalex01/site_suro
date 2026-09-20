-- ════════════════════════════════════════════════════════════════════════
--  SNAPTECH — SCHÉMA MySQL / MariaDB  (installation propre)
--
--  ⚠️  CE SCRIPT SUPPRIME puis recrée snap_requests, banned_ips et snap_logs :
--      TOUTES LEURS DONNÉES SONT PERDUES. À utiliser sur une base vide ou pour
--      repartir de zéro. Pour CORRIGER des tables existantes en gardant les
--      données, utilise plutôt repair-mysql.sql.
--
--  À exécuter dans phpMyAdmin (onglet SQL) sur la base partagée par le site
--  (Vercel) et le bot Discord.
--
--  Notes :
--   * DATETIME(3) = précision à la milliseconde. Le bot détecte les
--     nouveautés avec "updated_at > dernier curseur" : avec une précision à la
--     seconde, deux demandes modifiées dans la même seconde pourraient être
--     manquées.
--   * updated_at se met à jour tout seul à chaque UPDATE.
--   * Les tables du bot (bot_instance_lock, bot_request_messages,
--     bot_static_messages, staff_preferences) sont créées ci-dessous SANS être
--     supprimées (IF NOT EXISTS) : le bot les crée de toute façon lui-même au
--     démarrage, avec exactement la même structure.
-- ════════════════════════════════════════════════════════════════════════

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS snap_logs;
DROP TABLE IF EXISTS banned_ips;
DROP TABLE IF EXISTS snap_requests;
SET FOREIGN_KEY_CHECKS = 1;


-- ────────────────────────────────────────────────────────────────────────
--  1. Demandes
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE snap_requests (
    id                    INT          NOT NULL AUTO_INCREMENT,
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
    PRIMARY KEY (id),
    UNIQUE KEY uq_snap_requests_phone (phone),           -- clé de l'UPSERT (api/snapchat.js)
    KEY idx_snap_requests_username   (username),
    KEY idx_snap_requests_status     (status),
    KEY idx_snap_requests_created_at (created_at),
    KEY idx_snap_requests_updated_at (updated_at),       -- polling du bot
    KEY idx_snap_requests_claimed    (claimed_by_discord_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ────────────────────────────────────────────────────────────────────────
--  2. IP bannies
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE banned_ips (
    id          INT          NOT NULL AUTO_INCREMENT,
    ip_address  VARCHAR(45)  NOT NULL,
    reason      VARCHAR(255) NULL,
    banned_by   VARCHAR(100) NULL,
    created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_banned_ips_ip (ip_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ────────────────────────────────────────────────────────────────────────
--  3. Journal des actions staff
--     details = JSON {"phone": "...", "staff_tag": "...", "discord_user_id": "..."}
--     (sur MariaDB le type JSON est un alias de LONGTEXT : c'est normal)
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE snap_logs (
    id          INT          NOT NULL AUTO_INCREMENT,
    request_id  INT          NULL,
    action      VARCHAR(50)  NOT NULL,
    details     JSON         NULL,
    ip_address  VARCHAR(45)  NULL,
    user_agent  TEXT         NULL,
    created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_snap_logs_action  (action),
    KEY idx_snap_logs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ────────────────────────────────────────────────────────────────────────
--  4. Tables du bot (non supprimées, créées seulement si absentes)
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_instance_lock (
    id             INT NOT NULL PRIMARY KEY DEFAULT 1,
    instance_id    VARCHAR(64) NOT NULL,
    hostname       VARCHAR(255) NULL,
    pid            INT NULL,
    started_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bot_request_messages (
    phone      VARCHAR(32) NOT NULL PRIMARY KEY,
    channel_id VARCHAR(32) NOT NULL,
    message_id VARCHAR(32) NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bot_static_messages (
    name       VARCHAR(100) NOT NULL PRIMARY KEY,
    channel_id VARCHAR(32) NOT NULL,
    message_id VARCHAR(32) NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS staff_preferences (
    discord_user_id        VARCHAR(32) NOT NULL PRIMARY KEY,
    language               VARCHAR(8) NOT NULL DEFAULT 'en',
    receive_pings          TINYINT(1) NOT NULL DEFAULT 1,
    dm_alert_operators     VARCHAR(255) NULL,
    snooze_until           DATETIME NULL,
    daily_summary          TINYINT(1) NOT NULL DEFAULT 0,
    last_summary_sent_date DATE NULL,
    updated_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
