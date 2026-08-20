const fs = require("node:fs");
const path = require("node:path");

const DB_FILE = "argentum-local.sqlite";

function sqlite() {
  try {
    return require("node:sqlite");
  } catch (error) {
    const wrapped = new Error("Local SQLite support requires a Node runtime with node:sqlite available.");
    wrapped.cause = error;
    throw wrapped;
  }
}

function now() {
  return new Date().toISOString();
}

function databasePath(dataDir) {
  return path.join(dataDir, DB_FILE);
}

function openDatabase(dataDir, options = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const { DatabaseSync } = sqlite();
  const db = new DatabaseSync(databasePath(dataDir));
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
  if (options.initializeJournal === true) {
    // Changing journal mode can checkpoint a large WAL. Do that once during
    // initialization, never on every settings/audit helper call on Electron's
    // main thread.
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA wal_autocheckpoint = 1000;
      PRAGMA journal_size_limit = 67108864;
    `);
  }
  return db;
}

function run(db, sql, params = []) {
  return db.prepare(sql).run(...params);
}

function all(db, sql, params = []) {
  return db.prepare(sql).all(...params);
}

function get(db, sql, params = []) {
  return db.prepare(sql).get(...params);
}

function initializeLocalDatabase(dataDirOrOptions) {
  const dataDir = typeof dataDirOrOptions === "string" ? dataDirOrOptions : dataDirOrOptions?.dataDir;
  if (!dataDir) throw new Error("Local database dataDir is required.");
  const db = openDatabase(dataDir, { initializeJournal: true });
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const migrations = [
      {
        id: "001_local_runtime_core",
        sql: `
          CREATE TABLE IF NOT EXISTS local_audit (
            id TEXT PRIMARY KEY,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            detail TEXT NOT NULL,
            created_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS agent_jobs (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            goal TEXT NOT NULL,
            risk_level TEXT NOT NULL,
            requires_approval INTEGER NOT NULL DEFAULT 0,
            approval_id TEXT,
            result_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS file_workspaces (
            id TEXT PRIMARY KEY,
            folder_path TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL,
            permissions_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS file_access_log (
            id TEXT PRIMARY KEY,
            workspace_id TEXT,
            action TEXT NOT NULL,
            file_path TEXT NOT NULL,
            allowed INTEGER NOT NULL,
            reason TEXT NOT NULL,
            created_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS secret_metadata (
            provider TEXT PRIMARY KEY,
            storage TEXT NOT NULL,
            configured INTEGER NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS local_settings (
            key TEXT PRIMARY KEY,
            value_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `,
      },
      {
        id: "002_stock_intelligence_command_center",
        sql: `
          CREATE TABLE IF NOT EXISTS stock_research_runs (
            id TEXT PRIMARY KEY,
            correlation_id TEXT NOT NULL,
            cycle_type TEXT NOT NULL,
            market_session TEXT NOT NULL,
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            duration_ms INTEGER,
            symbols_scanned INTEGER NOT NULL DEFAULT 0,
            signals_found INTEGER NOT NULL DEFAULT 0,
            error TEXT,
            next_scheduled_at TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}'
          );
          CREATE INDEX IF NOT EXISTS idx_stock_research_runs_completed
            ON stock_research_runs(completed_at DESC);

          CREATE TABLE IF NOT EXISTS stock_research_snapshots (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            symbol TEXT NOT NULL,
            source TEXT NOT NULL,
            observed_at TEXT NOT NULL,
            expires_at TEXT,
            freshness TEXT NOT NULL,
            data_json TEXT NOT NULL,
            FOREIGN KEY(run_id) REFERENCES stock_research_runs(id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_stock_research_snapshots_symbol
            ON stock_research_snapshots(symbol, observed_at DESC);

          CREATE TABLE IF NOT EXISTS stock_opportunities (
            id TEXT PRIMARY KEY,
            symbol TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL,
            overall_score REAL NOT NULL,
            ai_score REAL,
            technical_score REAL,
            mirror_score REAL,
            catalyst_score REAL,
            risk_score REAL,
            confidence TEXT NOT NULL,
            rank INTEGER,
            source TEXT NOT NULL,
            thesis_hash TEXT NOT NULL,
            first_seen_at TEXT NOT NULL,
            last_updated_at TEXT NOT NULL,
            last_researched_at TEXT NOT NULL,
            next_review_at TEXT,
            proposal_id TEXT,
            data_json TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_stock_opportunities_rank
            ON stock_opportunities(status, overall_score DESC, last_updated_at DESC);

          CREATE TABLE IF NOT EXISTS stock_opportunity_evidence (
            id TEXT PRIMARY KEY,
            opportunity_id TEXT NOT NULL,
            evidence_type TEXT NOT NULL,
            direction TEXT NOT NULL,
            label TEXT NOT NULL,
            source TEXT NOT NULL,
            source_url TEXT,
            observed_at TEXT NOT NULL,
            expires_at TEXT,
            data_json TEXT NOT NULL DEFAULT '{}',
            FOREIGN KEY(opportunity_id) REFERENCES stock_opportunities(id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_stock_opportunity_evidence_lookup
            ON stock_opportunity_evidence(opportunity_id, observed_at DESC);

          CREATE TABLE IF NOT EXISTS stock_research_reports (
            id TEXT PRIMARY KEY,
            report_type TEXT NOT NULL,
            report_day TEXT NOT NULL,
            generated_at TEXT NOT NULL,
            market_session TEXT NOT NULL,
            status TEXT NOT NULL,
            data_json TEXT NOT NULL,
            UNIQUE(report_type, report_day)
          );

          CREATE TABLE IF NOT EXISTS stock_trade_proposals (
            id TEXT PRIMARY KEY,
            opportunity_id TEXT,
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            status TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            expires_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            data_json TEXT NOT NULL,
            UNIQUE(fingerprint)
          );

          CREATE TABLE IF NOT EXISTS stock_trade_approvals (
            id TEXT PRIMARY KEY,
            proposal_id TEXT,
            actor_type TEXT NOT NULL,
            actor_id TEXT,
            status TEXT NOT NULL,
            idempotency_key TEXT,
            telegram_message_id TEXT,
            decided_at TEXT,
            created_at TEXT NOT NULL,
            data_json TEXT NOT NULL DEFAULT '{}',
            UNIQUE(idempotency_key)
          );

          CREATE TABLE IF NOT EXISTS stock_mirror_sources (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_url TEXT,
            delay_class TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 0,
            health TEXT NOT NULL,
            last_checked_at TEXT,
            last_event_at TEXT,
            data_json TEXT NOT NULL DEFAULT '{}'
          );

          CREATE TABLE IF NOT EXISTS stock_mirror_events (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            source_event_id TEXT NOT NULL,
            symbol TEXT,
            side TEXT,
            event_time TEXT,
            disclosed_at TEXT NOT NULL,
            received_at TEXT NOT NULL,
            delay_seconds INTEGER,
            source_url TEXT,
            status TEXT NOT NULL,
            data_json TEXT NOT NULL,
            UNIQUE(source_id, source_event_id),
            FOREIGN KEY(source_id) REFERENCES stock_mirror_sources(id)
          );
          CREATE INDEX IF NOT EXISTS idx_stock_mirror_events_recent
            ON stock_mirror_events(received_at DESC);

          CREATE TABLE IF NOT EXISTS stock_mirror_consensus (
            id TEXT PRIMARY KEY,
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            score REAL NOT NULL,
            source_count INTEGER NOT NULL,
            first_seen_at TEXT NOT NULL,
            last_updated_at TEXT NOT NULL,
            expires_at TEXT,
            data_json TEXT NOT NULL,
            UNIQUE(symbol, side)
          );

          CREATE TABLE IF NOT EXISTS stock_telegram_events (
            id TEXT PRIMARY KEY,
            update_id TEXT,
            idempotency_key TEXT,
            event_type TEXT NOT NULL,
            actor_id TEXT,
            chat_id TEXT,
            message_id TEXT,
            proposal_id TEXT,
            approval_id TEXT,
            status TEXT NOT NULL,
            error TEXT,
            created_at TEXT NOT NULL,
            processed_at TEXT,
            data_json TEXT NOT NULL DEFAULT '{}',
            UNIQUE(update_id),
            UNIQUE(idempotency_key)
          );

          CREATE TABLE IF NOT EXISTS stock_system_events (
            id TEXT PRIMARY KEY,
            correlation_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            actor_type TEXT NOT NULL,
            actor_id TEXT,
            symbol TEXT,
            proposal_id TEXT,
            order_id TEXT,
            old_state TEXT,
            new_state TEXT,
            decision TEXT,
            reason TEXT,
            error TEXT,
            created_at TEXT NOT NULL,
            data_json TEXT NOT NULL DEFAULT '{}'
          );
          CREATE INDEX IF NOT EXISTS idx_stock_system_events_recent
            ON stock_system_events(created_at DESC);

          CREATE TABLE IF NOT EXISTS stock_risk_decisions (
            id TEXT PRIMARY KEY,
            correlation_id TEXT NOT NULL,
            proposal_id TEXT,
            symbol TEXT,
            decision TEXT NOT NULL,
            reasons_json TEXT NOT NULL,
            observed_at TEXT NOT NULL,
            data_json TEXT NOT NULL DEFAULT '{}'
          );

          CREATE TABLE IF NOT EXISTS stock_order_audit (
            id TEXT PRIMARY KEY,
            correlation_id TEXT NOT NULL,
            actor_type TEXT NOT NULL,
            actor_id TEXT,
            proposal_id TEXT,
            approval_id TEXT,
            order_id TEXT,
            symbol TEXT,
            side TEXT,
            action TEXT NOT NULL,
            old_state TEXT,
            new_state TEXT,
            reason TEXT,
            broker_response_json TEXT,
            error TEXT,
            telegram_message_id TEXT,
            created_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS stock_worker_heartbeats (
            worker_id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            cycle_type TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            duration_ms INTEGER,
            items_seen INTEGER NOT NULL DEFAULT 0,
            items_created INTEGER NOT NULL DEFAULT 0,
            errors INTEGER NOT NULL DEFAULT 0,
            rate_limits INTEGER NOT NULL DEFAULT 0,
            next_run_at TEXT,
            correlation_id TEXT,
            detail_json TEXT NOT NULL DEFAULT '{}'
          );
        `,
      },
      {
        id: "003_stock_mirror_source_controls",
        sql: `
          ALTER TABLE stock_mirror_sources ADD COLUMN following INTEGER NOT NULL DEFAULT 1;
          ALTER TABLE stock_mirror_sources ADD COLUMN mirror_enabled INTEGER NOT NULL DEFAULT 0;
        `,
      },
      {
        id: "004_stock_signal_and_trade_journals",
        sql: `
          CREATE TABLE IF NOT EXISTS stock_signal_journal (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            opportunity_id TEXT NOT NULL,
            strategy_version TEXT NOT NULL,
            symbol TEXT NOT NULL,
            direction TEXT NOT NULL,
            state TEXT NOT NULL,
            opportunity_score REAL NOT NULL,
            confidence_score REAL,
            market_regime TEXT,
            sector_state TEXT,
            reference_price REAL,
            stop_price REAL,
            target_1 REAL,
            target_2 REAL,
            observed_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            snapshot_hash TEXT NOT NULL,
            data_json TEXT NOT NULL,
            UNIQUE(run_id, opportunity_id),
            FOREIGN KEY(run_id) REFERENCES stock_research_runs(id) ON DELETE RESTRICT
          );
          CREATE INDEX IF NOT EXISTS idx_stock_signal_journal_symbol
            ON stock_signal_journal(symbol, observed_at DESC);

          CREATE TABLE IF NOT EXISTS stock_signal_price_observations (
            id TEXT PRIMARY KEY,
            signal_id TEXT NOT NULL,
            symbol TEXT NOT NULL,
            observed_at TEXT NOT NULL,
            price REAL NOT NULL,
            provider TEXT NOT NULL,
            source_timestamp TEXT,
            provenance TEXT NOT NULL,
            data_json TEXT NOT NULL DEFAULT '{}',
            UNIQUE(signal_id, observed_at, provenance),
            FOREIGN KEY(signal_id) REFERENCES stock_signal_journal(id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_stock_signal_observations_due
            ON stock_signal_price_observations(signal_id, observed_at);

          CREATE TABLE IF NOT EXISTS stock_signal_outcomes (
            id TEXT PRIMARY KEY,
            signal_id TEXT NOT NULL,
            horizon TEXT NOT NULL,
            due_at TEXT NOT NULL,
            observed_at TEXT NOT NULL,
            reference_price REAL NOT NULL,
            outcome_price REAL NOT NULL,
            return_pct REAL NOT NULL,
            maximum_favorable_excursion_pct REAL,
            maximum_adverse_excursion_pct REAL,
            entry_triggered INTEGER,
            stop_triggered INTEGER,
            target_1_triggered INTEGER,
            target_2_triggered INTEGER,
            provenance TEXT NOT NULL,
            locked_at TEXT NOT NULL,
            data_json TEXT NOT NULL DEFAULT '{}',
            UNIQUE(signal_id, horizon),
            FOREIGN KEY(signal_id) REFERENCES stock_signal_journal(id) ON DELETE RESTRICT
          );

          CREATE TABLE IF NOT EXISTS stock_trade_journal (
            id TEXT PRIMARY KEY,
            signal_id TEXT,
            proposal_id TEXT,
            approval_id TEXT,
            broker_order_id TEXT UNIQUE,
            strategy_version TEXT NOT NULL,
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            status TEXT NOT NULL,
            quantity REAL,
            entry_price REAL,
            exit_price REAL,
            fees REAL,
            realized_pnl REAL,
            unrealized_pnl REAL,
            exit_reason TEXT,
            human_intervention TEXT,
            opened_at TEXT,
            closed_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            data_json TEXT NOT NULL DEFAULT '{}',
            FOREIGN KEY(signal_id) REFERENCES stock_signal_journal(id) ON DELETE SET NULL
          );
          CREATE INDEX IF NOT EXISTS idx_stock_trade_journal_recent
            ON stock_trade_journal(updated_at DESC);
        `,
      },
      {
        id: "005_stock_strategy_governance",
        sql: `
          CREATE TABLE IF NOT EXISTS stock_strategy_versions (
            version TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            configuration_hash TEXT NOT NULL,
            configuration_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            activated_at TEXT,
            retired_at TEXT,
            approval_id TEXT,
            notes TEXT
          );

          CREATE TABLE IF NOT EXISTS stock_strategy_change_proposals (
            id TEXT PRIMARY KEY,
            from_version TEXT NOT NULL,
            proposed_version TEXT NOT NULL,
            status TEXT NOT NULL,
            rationale TEXT NOT NULL,
            evidence_json TEXT NOT NULL,
            configuration_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            decided_at TEXT,
            approval_id TEXT,
            UNIQUE(proposed_version)
          );
        `,
      },
      {
        id: "006_stock_performance_indexes",
        sql: `
          CREATE INDEX IF NOT EXISTS idx_stock_signal_journal_observed
            ON stock_signal_journal(observed_at DESC);
          CREATE INDEX IF NOT EXISTS idx_stock_signal_outcomes_signal_due
            ON stock_signal_outcomes(signal_id, due_at ASC);
        `,
      },
    ];

    migrations.forEach((migration) => {
      const applied = get(db, "SELECT id FROM migrations WHERE id = ?", [migration.id]);
      if (applied) return;
      db.exec(migration.sql);
      run(db, "INSERT INTO migrations (id, applied_at) VALUES (?, ?)", [migration.id, now()]);
    });

    return status(dataDir, db);
  } finally {
    db.close();
  }
}

function status(dataDir, existingDb = null) {
  const db = existingDb || openDatabase(dataDir);
  try {
    return {
      engine: "sqlite",
      path: databasePath(dataDir),
      dbPath: databasePath(dataDir),
      migrations: all(db, "SELECT id, applied_at AS appliedAt FROM migrations ORDER BY applied_at ASC"),
      initialized: true,
      available: true,
    };
  } finally {
    if (!existingDb) db.close();
  }
}

function recordLocalAudit(dataDir, { actor = "system", action, detail }) {
  const db = openDatabase(dataDir);
  try {
    const id = `local-audit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    run(db, "INSERT INTO local_audit (id, actor, action, detail, created_at) VALUES (?, ?, ?, ?, ?)", [
      id,
      String(actor || "system").slice(0, 80),
      String(action || "event").slice(0, 160),
      String(detail || "").slice(0, 2000),
      now(),
    ]);
    return { id };
  } finally {
    db.close();
  }
}

function insertAuditLog(dataDir, entry = {}) {
  return recordLocalAudit(dataDir, {
    actor: entry.actor || "system",
    action: entry.title || entry.action || "event",
    detail: entry.body || entry.detail || "",
  });
}

function listLocalAudit(dataDir, limit = 100) {
  const db = openDatabase(dataDir);
  try {
    return all(
      db,
      "SELECT id, actor, action, detail, created_at AS createdAt FROM local_audit ORDER BY created_at DESC LIMIT ?",
      [Math.max(1, Math.min(250, Number(limit) || 100))],
    );
  } finally {
    db.close();
  }
}

function enqueueAgentJob(dataDir, { goal, riskLevel = "low", requiresApproval = false, approvalId = null, status: jobStatus = "queued" }) {
  const db = openDatabase(dataDir);
  try {
    const timestamp = now();
    const id = `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    run(
      db,
      "INSERT INTO agent_jobs (id, status, goal, risk_level, requires_approval, approval_id, result_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, jobStatus, String(goal || "").slice(0, 4000), riskLevel, requiresApproval ? 1 : 0, approvalId, "", timestamp, timestamp],
    );
    return { id, status: jobStatus, goal, riskLevel, requiresApproval, approvalId, createdAt: timestamp, updatedAt: timestamp };
  } finally {
    db.close();
  }
}

function enqueueLocalJob(dataDir, job = {}) {
  return enqueueAgentJob(dataDir, {
    goal: job.goal || job.payload?.goal || job.payload?.message || "",
    riskLevel: job.riskLevel || "low",
    requiresApproval: Boolean(job.requiresApproval),
    approvalId: job.approvalId || null,
    status: job.status || "queued",
  });
}

function listAgentJobs(dataDir, limit = 100) {
  const db = openDatabase(dataDir);
  try {
    return all(
      db,
      "SELECT id, status, goal, risk_level AS riskLevel, requires_approval AS requiresApproval, approval_id AS approvalId, result_json AS resultJson, created_at AS createdAt, updated_at AS updatedAt FROM agent_jobs ORDER BY created_at DESC LIMIT ?",
      [Math.max(1, Math.min(250, Number(limit) || 100))],
    ).map((job) => ({
      ...job,
      requiresApproval: Boolean(job.requiresApproval),
      result: job.resultJson ? JSON.parse(job.resultJson) : null,
      resultJson: undefined,
    }));
  } finally {
    db.close();
  }
}

function listLocalJobs(dataDir, limit = 100) {
  return listAgentJobs(dataDir, limit);
}

function updateAgentJob(dataDir, jobId, updates = {}) {
  const db = openDatabase(dataDir);
  try {
    const current = get(db, "SELECT id FROM agent_jobs WHERE id = ?", [jobId]);
    if (!current) return null;
    run(db, "UPDATE agent_jobs SET status = ?, result_json = ?, updated_at = ? WHERE id = ?", [
      String(updates.status || "complete"),
      updates.result ? JSON.stringify(updates.result) : "",
      now(),
      jobId,
    ]);
    return get(db, "SELECT id, status, goal, risk_level AS riskLevel, requires_approval AS requiresApproval, approval_id AS approvalId, result_json AS resultJson, created_at AS createdAt, updated_at AS updatedAt FROM agent_jobs WHERE id = ?", [jobId]);
  } finally {
    db.close();
  }
}

function upsertFileWorkspace(dataDir, { folderPath, label, permissions }) {
  const db = openDatabase(dataDir);
  try {
    const timestamp = now();
    const id = `workspace-${Buffer.from(folderPath).toString("base64url").slice(0, 36)}`;
    run(
      db,
      `INSERT INTO file_workspaces (id, folder_path, label, permissions_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(folder_path) DO UPDATE SET label = excluded.label, permissions_json = excluded.permissions_json, updated_at = excluded.updated_at`,
      [id, folderPath, label, JSON.stringify(permissions), timestamp, timestamp],
    );
    return getFileWorkspace(dataDir, id);
  } finally {
    db.close();
  }
}

function addFileWorkspace(dataDir, workspace = {}) {
  return upsertFileWorkspace(dataDir, workspace);
}

function listFileWorkspaces(dataDir) {
  const db = openDatabase(dataDir);
  try {
    return all(
      db,
      "SELECT id, folder_path AS folderPath, label, permissions_json AS permissionsJson, created_at AS createdAt, updated_at AS updatedAt FROM file_workspaces ORDER BY updated_at DESC",
    ).map((workspace) => ({
      ...workspace,
      permissions: JSON.parse(workspace.permissionsJson || "{}"),
      permissionsJson: undefined,
    }));
  } finally {
    db.close();
  }
}

function getFileWorkspace(dataDir, id) {
  const db = openDatabase(dataDir);
  try {
    const workspace = get(
      db,
      "SELECT id, folder_path AS folderPath, label, permissions_json AS permissionsJson, created_at AS createdAt, updated_at AS updatedAt FROM file_workspaces WHERE id = ?",
      [id],
    );
    if (!workspace) return null;
    return { ...workspace, permissions: JSON.parse(workspace.permissionsJson || "{}"), permissionsJson: undefined };
  } finally {
    db.close();
  }
}

function removeFileWorkspace(dataDir, id) {
  const db = openDatabase(dataDir);
  try {
    run(db, "DELETE FROM file_workspaces WHERE id = ?", [id]);
    return { removed: true };
  } finally {
    db.close();
  }
}

function logFileAccess(dataDir, { workspaceId = null, action, filePath, targetPath, allowed, status: accessStatus, reason }) {
  const db = openDatabase(dataDir);
  try {
    const id = `file-access-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    run(
      db,
      "INSERT INTO file_access_log (id, workspace_id, action, file_path, allowed, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, workspaceId, action, filePath || targetPath || "", allowed || accessStatus === "allowed" ? 1 : 0, String(reason || accessStatus || "").slice(0, 1000), now()],
    );
    return { id };
  } finally {
    db.close();
  }
}

function upsertSecretMetadata(dataDir, provider, storage, configured) {
  const db = openDatabase(dataDir);
  try {
    run(
      db,
      `INSERT INTO secret_metadata (provider, storage, configured, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET storage = excluded.storage, configured = excluded.configured, updated_at = excluded.updated_at`,
      [provider, storage, configured ? 1 : 0, now()],
    );
  } finally {
    db.close();
  }
}

function getLocalSetting(dataDir, key, fallback = null) {
  const db = openDatabase(dataDir);
  try {
    const row = get(db, "SELECT value_json AS valueJson FROM local_settings WHERE key = ?", [key]);
    return row ? JSON.parse(row.valueJson) : fallback;
  } finally {
    db.close();
  }
}

function setLocalSetting(dataDir, key, value) {
  const db = openDatabase(dataDir);
  try {
    run(
      db,
      `INSERT INTO local_settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value), now()],
    );
    return value;
  } finally {
    db.close();
  }
}

module.exports = {
  addFileWorkspace,
  databasePath,
  enqueueAgentJob,
  enqueueLocalJob,
  getFileWorkspace,
  getLocalSetting,
  initializeLocalDatabase,
  insertAuditLog,
  listAgentJobs,
  listFileWorkspaces,
  listLocalAudit,
  listLocalJobs,
  logFileAccess,
  recordLocalAudit,
  removeFileWorkspace,
  status,
  setLocalSetting,
  updateAgentJob,
  upsertFileWorkspace,
  upsertSecretMetadata,
};
