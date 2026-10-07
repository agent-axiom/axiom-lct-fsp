import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runTwoRoleScenario} from './helpers/two-role-scenario.mjs';
test('Two synthetic HTTP roles preserve evidence, consent and target-employer contact boundaries',async()=>{
 const result=await runTwoRoleScenario();assert.ok(result.checksPassed>=20);assert.equal(result.externalTransportCalls,0);
});
