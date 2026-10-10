import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync, mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {drizzle} from 'drizzle-orm/d1';
import {migrate} from 'drizzle-orm/d1/migrator';
const root=new URL('../',import.meta.url).pathname;
const scratch=mkdtempSync(path.join(os.tmpdir(),'fsp-profile-test-'));
const profile=path.join(scratch,'profile/'),v12=path.join(scratch,'v12/'),main=path.join(root,'drizzle/');
const manifest=JSON.parse(readFileSync(path.join(root,'migration-profiles/sites-v12/manifest.json'),'utf8'));
for(const entry of manifest.files){
 const input=path.join(root,entry.source),relative=entry.destination.replace(/^drizzle\//,'');
 assert.equal(createHash('sha256').update(readFileSync(input)).digest('hex'),entry.sha256);
 for(const directory of [profile,v12]){const dest=path.join(directory,relative);mkdirSync(path.dirname(dest),{recursive:true});cpSync(input,dest);}
}
const baseline=JSON.parse(readFileSync(v12+'meta/_journal.json','utf8'));baseline.entries=baseline.entries.slice(0,5);writeFileSync(v12+'meta/_journal.json',JSON.stringify(baseline));
rmSync(v12+'0005_align_mainline_email_columns.sql');rmSync(v12+'meta/0005_snapshot.json');
const json=p=>JSON.parse(readFileSync(p,'utf8'));
const originalJournal=json(v12+'meta/_journal.json'),profileJournal=json(profile+'meta/_journal.json');
assert.deepEqual(profileJournal.entries.slice(0,5),originalJournal.entries);
assert.ok(profileJournal.entries[5].when>originalJournal.entries[4].when);
for(const path of [...readdirSync(v12).filter(f=>f.endsWith('.sql')), ...readdirSync(v12+'meta').filter(f=>f!=='_journal.json').map(f=>'meta/'+f)]) assert.deepEqual(readFileSync(profile+path),readFileSync(v12+path));
function fixture(){
 const db=new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
 const execute=(sql,values)=>{const stmt=db.prepare(sql);if(/^\s*(SELECT|PRAGMA|WITH)/i.test(sql))return {results:stmt.all(...values),success:true,meta:{changes:0}};const r=stmt.run(...values);return {results:[],success:true,meta:{changes:Number(r.changes)}};};
 const client={prepare(sql){let values=[]; const q={bind(...args){values=args;return q;},async run(){return execute(sql,values);},async all(){return execute(sql,values);},async raw(){const s=db.prepare(sql);s.setReturnArrays(true);return s.all(...values);},execute(){return execute(sql,values);}};return q;},async batch(qs){db.exec('BEGIN IMMEDIATE');try{const rs=qs.map(q=>q.execute());db.exec('COMMIT');return rs;}catch(e){db.exec('ROLLBACK');throw e;}}};
 return {db,orm:drizzle(client)};
}
const tables=db=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='__drizzle_migrations' ORDER BY name").all().map(r=>r.name);
const snapshot=db=>Object.fromEntries(tables(db).map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]));
const f=fixture();await migrate(f.orm,{migrationsFolder:v12});
f.db.exec(`INSERT INTO workspaces VALUES('synthetic-workspace','{}',7);
INSERT INTO owner_email_tests VALUES('synthetic-receipt','synthetic-principal-hash','synthetic-payload-hash','accepted',1,2,'synthetic-provider-id',NULL);
INSERT INTO real_accounts VALUES('synthetic-account','synthetic-issuer','synthetic-subject','candidate','synthetic@example.test','Synthetic',1,'synthetic-v1',NULL,1);
INSERT INTO real_email_challenges VALUES('synthetic-challenge','synthetic-account','synthetic@example.test','synthetic-token-hash',1,9999999999999,NULL,0,'pending');
INSERT INTO real_email_outbox VALUES('synthetic-job','synthetic-challenge','queued',0,1,NULL,NULL,NULL,NULL,1,NULL);`);
const before=snapshot(f.db);await migrate(f.orm,{migrationsFolder:profile});const after=snapshot(f.db);
for(const row of after.real_email_outbox){assert.equal(row.email_transport,'resend');assert.equal(row.payload_hash,null);delete row.email_transport;delete row.payload_hash;}
assert.deepEqual(after,before);
const ledger=f.db.prepare('SELECT * FROM __drizzle_migrations ORDER BY created_at').all();assert.equal(ledger.length,6);
await migrate(f.orm,{migrationsFolder:profile});assert.deepEqual(f.db.prepare('SELECT * FROM __drizzle_migrations ORDER BY created_at').all(),ledger);
const clean=fixture();await migrate(clean.orm,{migrationsFolder:profile});const canonical=fixture();await migrate(canonical.orm,{migrationsFolder:main});
const shape=db=>Object.fromEntries(tables(db).map(t=>[t,{columns:db.prepare(`PRAGMA table_info(${t})`).all().map(row=>{const copy={...row};delete copy.cid;return copy;}).sort((a,b)=>a.name.localeCompare(b.name)),indexes:db.prepare(`PRAGMA index_list(${t})`).all().map(row=>{const copy={...row};delete copy.seq;return copy;}).sort((a,b)=>a.name.localeCompare(b.name))}]));
assert.deepEqual(shape(clean.db),shape(canonical.db));
console.log(JSON.stringify({passed:true,originalMigrationsImmutable:true,actualD1MigratorUsed:true,populatedV12Upgrade:'passed',allExistingRowsPreserved:true,ownerReceiptPreserved:true,outboxLegacyDefaults:{email_transport:'resend',payload_hash:null},repeatMigrationNoop:true,freshProfileMatchesMainSchema:true,profileMigration:profileJournal.entries[5],newSQLSHA256:createHash('sha256').update(readFileSync(profile+'0005_align_mainline_email_columns.sql')).digest('hex'),productionAccess:false},null,2));
for(const x of [f,clean,canonical])x.db.close();

rmSync(scratch,{recursive:true});
