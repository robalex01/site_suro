-- ════════════════════════════════════════════════════════════════════════
--  SNAPTECH — RÉPARATION des tables existantes (les données sont CONSERVÉES)
--
--  Corrige des tables snap_requests / banned_ips / snap_logs déjà créées
--  (par exemple importées depuis l'ancienne base) pour qu'elles collent à ce
--  que le site et le bot attendent :
--    * id en AUTO_INCREMENT (sans ça, chaque INSERT échoue)
--    * updated_at qui se met à jour tout seul (sans ça le bot ne voit jamais
--      les changements de statut)
--    * dates à la milliseconde
--
--  Sans danger si tu le relances : il ne fait que modifier ces colonnes.
--  Les tables doivent déjà exister — sinon utilise schema-mysql.sql.
--  À exécuter dans phpMyAdmin (onglet SQL).
-- ════════════════════════════════════════════════════════════════════════

SET FOREIGN_KEY_CHECKS = 0;

-- Valeurs vides à remplir avant de passer les colonnes en NOT NULL
UPDATE snap_requests SET status     = 'pending' WHERE status     IS NULL;
UPDATE snap_requests SET created_at = NOW()     WHERE created_at IS NULL;
UPDATE snap_requests SET updated_at = NOW()     WHERE updated_at IS NULL;
UPDATE banned_ips    SET created_at = NOW()     WHERE created_at IS NULL;
UPDATE snap_logs     SET created_at = NOW()     WHERE created_at IS NULL;

ALTER TABLE snap_requests
    MODIFY id         INT         NOT NULL AUTO_INCREMENT,
    MODIFY status     VARCHAR(30) NOT NULL DEFAULT 'pending',
    MODIFY created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    MODIFY updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);

ALTER TABLE banned_ips
    MODIFY id         INT         NOT NULL AUTO_INCREMENT,
    MODIFY created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

ALTER TABLE snap_logs
    MODIFY id         INT         NOT NULL AUTO_INCREMENT,
    MODIFY created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

SET FOREIGN_KEY_CHECKS = 1;

-- Vérification : dans "Extra", id doit afficher auto_increment et updated_at
-- "on update current_timestamp(3)".
SHOW COLUMNS FROM snap_requests;
