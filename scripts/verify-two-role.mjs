import {writeFileSync} from 'node:fs';
import {runTwoRoleScenario} from '../tests/helpers/two-role-scenario.mjs';
const result=await runTwoRoleScenario();console.log(JSON.stringify(result,null,2));
if(process.argv.includes('--write'))writeFileSync(new URL('../docs/two-role-verification.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
