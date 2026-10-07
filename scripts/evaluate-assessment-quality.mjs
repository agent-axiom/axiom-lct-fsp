// Dedicated content/threshold/exposure evaluation; does not rewrite the v3 baseline.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const script=fileURLToPath(new URL('../tests/fixtures/assessment-quality/evaluate-quality.mjs',import.meta.url));
const result=spawnSync(process.execPath,[script,root,'--after-fix'],{stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
