import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  const dbPath = process.env.DB_PATH || path.join(__dirname, "../../data/escrow.db");
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  dbInstance = new Database(dbPath);
  dbInstance.pragma("journal_mode = WAL");
  return dbInstance;
}

export function setDb(newDb: Database.Database) {
  dbInstance = newDb;
}

export const db = getDb();

db.pragma("journal_mode = WAL");

export function initSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      ledger_sequence INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      data_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(contract_id, ledger_sequence, event_type)
    );

    CREATE TABLE IF NOT EXISTS indexer_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const initState = db.prepare(
    "INSERT OR IGNORE INTO indexer_state (key, value) VALUES (?, ?)"
  );
  initState.run("last_ledger_sequence", "0");
}

export function getLastIndexedLedger(): number {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM indexer_state WHERE key = 'last_ledger_sequence'")
    .get();
  return row ? parseInt((row as any).value, 10) : 0;
}

export function setLastIndexedLedger(seq: number) {
  const db = getDb();
  const stmt = db.prepare(
    "UPDATE indexer_state SET value = ? WHERE key = 'last_ledger_sequence'"
  );
  stmt.run(seq.toString());
}

export function insertEvent(
  contractId: string,
  eventType: string,
  ledgerSequence: number,
  timestamp: number,
  dataJson: string
) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO events 
    (contract_id, event_type, ledger_sequence, timestamp, data_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(contractId, eventType, ledgerSequence, timestamp, dataJson);
}

export function getEventsByAddress(address: string) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM events 
    WHERE data_json LIKE ?
    ORDER BY ledger_sequence DESC
  `);
  return stmt.all(`%${address}%`);
}
