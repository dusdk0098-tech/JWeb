import type { Db } from "./db.js";
// Schema 81: QR participation also for 교육일지 (routes live with the TBM ones in tbm-join.ts).
// SQLite cannot widen a CHECK in place, so the two tables that name the activity kind are rebuilt: new table, copy every row
// with its id, drop the old one, rename. db.ts runs this with foreign_keys=OFF (the pragma is ignored inside a transaction),
// so the references are checked here before the version is set. Triggers and the index are re-created with their original text.
export function migrateEducationJoin(db: Db) {
  const has = (name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  const rebuild = (table: string, columns: string, after: string) => {
    db.exec(`CREATE TABLE ${table}_81(${columns});`);
    if (has(table)) db.exec(`INSERT INTO ${table}_81 SELECT * FROM ${table}; DROP TABLE ${table};`);
    db.exec(`ALTER TABLE ${table}_81 RENAME TO ${table};${after}`);
  };
  db.exec("DROP TRIGGER IF EXISTS signature_needs_grant;"); // it reads consent_records, which is rebuilt below
  rebuild(
    "activity_invitations",
    `id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),kind TEXT NOT NULL CHECK(kind IN('tbm','education')),activity_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,document_hash TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL`,
    `
 CREATE INDEX activity_invitations_activity ON activity_invitations(activity_id,created_at);
 CREATE TRIGGER activity_invitation_fixed BEFORE UPDATE ON activity_invitations WHEN
  OLD.revoked_at IS NOT NULL OR NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.activity_id IS NOT OLD.activity_id OR NEW.token_hash IS NOT OLD.token_hash OR
  NEW.document_hash IS NOT OLD.document_hash OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
 BEGIN SELECT RAISE(ABORT,'Invitation fixed; revoke once'); END;
 CREATE TRIGGER activity_invitation_retained BEFORE DELETE ON activity_invitations BEGIN SELECT RAISE(ABORT,'Invitation retained'); END;`,
  );
  rebuild(
    "consent_records",
    `id TEXT PRIMARY KEY,participation_id TEXT NOT NULL UNIQUE REFERENCES participation_events(id),site_id TEXT NOT NULL REFERENCES sites(id),
  purpose TEXT NOT NULL CHECK(purpose IN('tbm_signature','education_signature')),text_version TEXT NOT NULL,decision TEXT NOT NULL CHECK(decision IN('grant','deny')),at TEXT NOT NULL,retain_until TEXT NOT NULL`,
    `
 CREATE TRIGGER consent_record_fixed BEFORE UPDATE ON consent_records BEGIN SELECT RAISE(ABORT,'Consent immutable'); END;
 CREATE TRIGGER consent_record_retained BEFORE DELETE ON consent_records BEGIN SELECT RAISE(ABORT,'Consent retained'); END;`,
  );
  if (has("signature_records"))
    db.exec(`CREATE TRIGGER signature_needs_grant BEFORE INSERT ON signature_records WHEN NOT EXISTS(
  SELECT 1 FROM consent_records WHERE participation_id=NEW.participation_id AND decision='grant')
 BEGIN SELECT RAISE(ABORT,'Signature requires a granted consent'); END;`);
  for (const table of ["activity_invitations", "participation_events", "consent_records", "signature_records"])
    if (has(table) && db.prepare(`PRAGMA foreign_key_check(${table})`).all().length) throw new Error(`Schema 81: ${table} has rows that point at a missing record.`);
  db.exec("PRAGMA user_version=81");
}
