import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/db.js";
import { hashBackupFile } from "../scripts/local-backup.js";
function cli(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/local-backup-cli.ts", ...args], { cwd: process.cwd(), encoding: "utf8", timeout: 30000 });
}
test("local backup CLI exports, verifies and lists only manifest metadata without source changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pedit-cli-"));
  try {
    const source = join(dir, "source.sqlite"), bundle = join(dir, "bundle");
    const db = openDatabase(source);
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run("synthetic-user", "private@example.test", "Private fixture name", "synthetic-secret-hash");
    const bytes = Buffer.from("%PDF-1.7\nsynthetic unparsed bytes");
    const hash = createHash("sha256").update(bytes).digest("hex");
    db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run("synthetic-site", "Private site");
    db.prepare("INSERT INTO minutes VALUES(?,?,?,?,?,?,?)").run("synthetic-minutes", "synthetic-site", "{}", 1, "synthetic-user", "2026-10-28T00:00:00Z", "2026-10-28T00:00:00Z");
    db.prepare("INSERT INTO minutes_attachments VALUES(?,?,?,?,?,?,?,?,?,?,?)").run("synthetic-attachment", "synthetic-site", "synthetic-minutes", "private.pdf", "application/pdf", bytes.length, hash, bytes, 1, "synthetic-user", "2026-10-28T00:00:00Z");
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("synthetic-private-session", "{}", 9999999999999);
    const authBefore = db.prepare("SELECT * FROM account_auth").all();
    db.close();
    const before = await hashBackupFile(source);
    const exported = cli(["export", "--source", source, "--destination", bundle, "--writers-stopped"]);
    assert.equal(exported.status, 0, exported.stderr);
    assert.equal(JSON.parse(exported.stdout).verified, true);
    if (process.platform !== "win32") { // Windows has no POSIX permission bits.
      assert.equal((await stat(bundle)).mode & 0o777, 0o700);
      assert.equal((await stat(join(bundle, "database.sqlite"))).mode & 0o777, 0o600);
    }
    assert.deepEqual(await hashBackupFile(source), before);
    const copied = new DatabaseSync(join(bundle, "database.sqlite"), { readOnly: true });
    try {
      assert.deepEqual(copied.prepare("SELECT * FROM account_auth").all(), authBefore);
      assert.equal(copied.prepare("SELECT count(*) n FROM sessions").get()?.n, 1);
      const original = copied.prepare("SELECT bytes,sha256 FROM minutes_attachments").get()!;
      assert.deepEqual(Buffer.from(original.bytes as Uint8Array), bytes);
      assert.equal(original.sha256, hash);
    } finally { copied.close(); }
    assert.equal(cli(["verify", "--bundle", bundle]).status, 0);
    const listed = cli(["list", "--bundle", bundle]);
    assert.equal(listed.status, 0);
    assert.equal(JSON.parse(listed.stdout).manifest.counts.users, 1);
    assert.doesNotMatch(listed.stdout + listed.stderr, /private@example|Private fixture|synthetic-secret/);
    assert.equal(cli(["export", "--source", source, "--destination", bundle, "--writers-stopped"]).status, 1);
    const manifest = await readFile(join(bundle, "manifest.json"), "utf8");
    await writeFile(join(bundle, "database.sqlite-wal"), "synthetic overlay");
    const bad = cli(["list", "--bundle", bundle]);
    assert.equal(bad.status, 1);
    assert.equal(bad.stdout, "");
    assert.equal(await readFile(join(bundle, "manifest.json"), "utf8"), manifest);
    assert.deepEqual(await hashBackupFile(source), before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("local backup CLI has no implicit source, restore, overwrite or environment operation", () => {
  for (const args of [[], ["restore"], ["export", "--source", "/missing", "--destination", "/missing-new"], ["verify", "--bundle", "/a", "--bundle", "/b"], ["list", "--bundle", "/a", "--force"], ["export", "--writers-stopped", "--writers-stopped"]]) {
    const result = cli(args);
    assert.equal(result.status, 2, JSON.stringify(args));
    assert.equal(result.stdout, "");
  }
  assert.equal(cli(["verify", "--bundle", "relative-path"]).status, 1);
  assert.equal(cli(["--help"]).status, 0);
});

test("current schema source matches actual database and backup without migration during CLI", async () => {
  const { CURRENT_SCHEMA_VERSION } = await import("../server/schema-version.js");
  const { BACKUP_SCHEMA_VERSION } = await import("../scripts/local-backup.js");
  const { DatabaseSync } = await import("node:sqlite");
  assert.equal(CURRENT_SCHEMA_VERSION, 79); // Independent current release expectation.
  assert.equal(BACKUP_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);
  const dir = await mkdtemp(join(tmpdir(), "pedit-cli-schema-"));
  try {
    const source = join(dir, "source.sqlite");
    const db = openDatabase(source);
    assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, CURRENT_SCHEMA_VERSION);
    db.close();
    for (const version of [CURRENT_SCHEMA_VERSION - 1, CURRENT_SCHEMA_VERSION + 1]) {
      const edit = new DatabaseSync(source);
      edit.exec(`PRAGMA user_version=${version}`);
      edit.close();
      const before = await hashBackupFile(source);
      const result = cli(["export", "--source", source, "--destination", join(dir, `bundle-${version}`), "--writers-stopped"]);
      // Older schemas export as-is (restore leaves migration to the app); newer ones are refused.
      assert.equal(result.status, version < CURRENT_SCHEMA_VERSION ? 0 : 1);
      if (version > CURRENT_SCHEMA_VERSION) assert.equal(result.stdout, "");
      assert.deepEqual(await hashBackupFile(source), before);
    }
    assert.throws(() => openDatabase(source), /newer|supported|version/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("CLI rejects tampered metadata and unsafe paths without printing input or private rows", async () => {
  const { symlink, access } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "pedit-cli-errors-"));
  try {
    const source = join(dir, "source.sqlite"), bundle = join(dir, "bundle");
    const db = openDatabase(source); db.close();
    assert.equal(cli(["export", "--source", source, "--destination", bundle, "--writers-stopped"]).status, 0);
    const mp = join(bundle, "manifest.json"), original = await readFile(mp, "utf8");
    for (const text of ["synthetic-private-malformed", JSON.stringify({ ...JSON.parse(original), sha256: "0".repeat(64) }), JSON.stringify({ ...JSON.parse(original), secret: "synthetic-private-field" })]) {
      await writeFile(mp, text);
      const result = cli(["list", "--bundle", bundle]);
      assert.equal(result.status, 1); assert.equal(result.stdout, "");
      assert.doesNotMatch(result.stderr, /synthetic-private/);
    }
    await writeFile(mp, original);
    const link = join(dir, "source-link");
    // Windows needs Developer Mode/admin for symlinks; the other unsafe paths still run.
    const linked = await symlink(source, link).then(() => true, (e) => { if (e.code !== "EPERM") throw e; return false; });
    for (const path of [...(linked ? [link] : []), `${dir}/../${dir.split("/").pop()}/source.sqlite`, `${dir}/synthetic-private-missing`]) {
      const result = cli(["export", "--source", path, "--destination", join(dir, "never"), "--writers-stopped"]);
      assert.equal(result.status, 1); assert.equal(result.stdout, "");
      assert.doesNotMatch(result.stderr, /synthetic-private/);
      await assert.rejects(access(join(dir, "never")));
    }
    assert.equal(cli(["verify", "--bundle", bundle]).status, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
