import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
test('Sites v12 profile preserves populated history and converges to mainline schema',()=>{
 const output=execFileSync(process.execPath,['scripts/verify-sites-v12-profile.mjs'],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
 const result=JSON.parse(output);
 for(const key of ['passed','originalMigrationsImmutable','actualD1MigratorUsed','allExistingRowsPreserved','ownerReceiptPreserved','repeatMigrationNoop','freshProfileMatchesMainSchema'])assert.equal(result[key],true,key);
 assert.equal(result.productionAccess,false);
});
