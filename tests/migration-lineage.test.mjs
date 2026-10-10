import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
const migration = name => readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8');
const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
const ownerTag = '0006_mature_lady_mastermind';
const ownerIndex = journal.entries.findIndex(entry => entry.tag === ownerTag);
assert.equal(ownerIndex, 6);
const ownerMigration = ownerTag + '.sql';
test('mainline owner diagnostic migration is additive and preserves populated prior tables', () => {
 const db = new DatabaseSync(':memory:');
 try {
  for (const e of journal.entries.slice(0,ownerIndex)) db.exec(migration(e.tag + '.sql'));
  db.exec("INSERT INTO workspaces (id,state,revision) VALUES ('synthetic-owner','{}',1)");
  const before = db.prepare('SELECT * FROM workspaces').all();
  db.exec(migration(ownerMigration));
  assert.deepEqual(db.prepare('SELECT * FROM workspaces').all(),before);
  const columns = db.prepare('PRAGMA table_info(real_email_outbox)').all().map(c=>c.name);
  assert.ok(columns.includes('payload_hash'));assert.ok(columns.includes('email_transport'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM owner_email_tests').get().n,0);
 } finally { db.close(); }
});
test('deployed v12 lineage is explicitly incompatible with blind mainline replay', () => {
 const db = new DatabaseSync(':memory:');
 try {
  for (const e of journal.entries.slice(0,4)) db.exec(migration(e.tag + '.sql'));
  // v12 created the same owner table under a different 0004 migration.
  db.exec(migration(ownerMigration));
  const deployedLastTimestamp=1791602601644;
  assert.ok(journal.entries[4].when<deployedLastTimestamp);
  assert.ok(journal.entries[5].when<deployedLastTimestamp);
  assert.ok(journal.entries[ownerIndex].when>deployedLastTimestamp);
  const columns=db.prepare('PRAGMA table_info(real_email_outbox)').all().map(c=>c.name);
  assert.ok(!columns.includes('payload_hash'));assert.ok(!columns.includes('email_transport'));
  assert.throws(()=>db.exec(migration(ownerMigration)),/already exists/);
  const guidance=readFileSync(new URL('../docs/deployment-lineage.md',import.meta.url),'utf8');
  assert.ok(guidance.includes('DEPLOYMENT BLOCKED'));
 } finally {db.close();}
});
