import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { fixture,mockModel,opts,validPatch } from './helpers.mjs';
import { planPatch,applyPatch,dockerArgs } from '../src/patch.mjs';
import { savePlan,sync } from '../src/runtime.mjs';
import { recordPath,readJSON } from '../src/store.mjs';

test('plan contains a real diff; approved application changes only the isolated copy',async t=>{
 const {project,root}=fixture(t);const plan=await planPatch(project,'paymentVersion',{...opts,fetchImpl:mockModel(validPatch)});
 assert.match(plan.edits[0].diff,/-export const paymentVersion = 2;/);assert.match(plan.edits[0].diff,/\+export const paymentVersion = 3;/);
 assert.throws(()=>applyPatch(project,plan.id,'wrong'),/Exact approval/);const run=applyPatch(project,plan.id,plan.approval_hash);
 assert.equal(run.state,'prepared');assert.match(readFileSync(join(root,'service.js'),'utf8'),/= 2/);assert.match(readFileSync(join(root,run.workspace,'service.js'),'utf8'),/= 3/);assert.equal(existsSync(join(root,run.workspace,'.env')),false);
 assert.equal(applyPatch(project,plan.id,plan.approval_hash).reused,true);
});
test('arbitrary paths, new files and invented replacement text are rejected',async t=>{
 const {project}=fixture(t);for(const mutation of [{path:'../outside.js'},{path:'.env'},{path:'new.js'},{old_text:'not present'}]) {
 await assert.rejects(planPatch(project,'paymentVersion',{...opts,fetchImpl:mockModel(user=>{const p=validPatch(user);Object.assign(p.edits[0],mutation);return p;})}));
 }
});
test('stale patches are rejected after files change or sync',async t=>{
 const {project,root}=fixture(t);const plan=await planPatch(project,'paymentVersion',{...opts,fetchImpl:mockModel(validPatch)});
 writeFileSync(join(root,'service.js'),'export const paymentVersion = 9;\n');assert.throws(()=>applyPatch(project,plan.id,plan.approval_hash),/changed/);sync(project);assert.throws(()=>applyPatch(project,plan.id,plan.approval_hash),/stale/);
});
function withChecks(project,plan) {
 const row=readJSON(recordPath(project,'plans',plan.id));row.payload.checks=[['node','--test']];row.payload.isolation={image:'sha256:'+'a'.repeat(64),endpoint:'unix:///fixture/docker.sock'};return savePlan(project,row.payload);
}
test('verification records passed and failed check outcomes; failure never becomes success',async t=>{
 for(const passed of [true,false]) {
 const {project}=fixture(t);let plan=await planPatch(project,'paymentVersion',{...opts,fetchImpl:mockModel(validPatch)});plan=withChecks(project,plan);
 const run=applyPatch(project,plan.id,plan.approval_hash,{runCheck:()=>({passed,exit_code:passed?0:1,stdout:'fixture',stderr:passed?'':'assertion failed'})});assert.equal(run.state,passed?'verified':'failed');assert.equal(run.checks[0].exit_code,passed?0:1);
 }
});
test('container command enforces isolation and never passes model keys',()=>{
 const plan={isolation:{endpoint:'unix:///docker.sock',image:'sha256:'+'a'.repeat(64)}};const args=dockerArgs(plan,'/tmp/workspace','agu-fixture',['node','--test']);
 for(const flag of ['--pull=never','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=128','--memory=512m','--cpus=1','--user=65534:65534'])assert.ok(args.includes(flag));
 assert.ok(args.includes('type=bind,source=/tmp/workspace,target=/workspace,readonly'));assert.ok(!args.join(' ').includes('OPENAI_API_KEY'));assert.throws(()=>dockerArgs(plan,'/tmp/,source=/etc','agu-fixture',[]),/commas/);
});

test('an unavailable container engine is recorded as failure with no host execution fallback',async t=>{
 const {project,root}=fixture(t);let plan=await planPatch(project,'paymentVersion',{...opts,fetchImpl:mockModel(validPatch)});plan=withChecks(project,plan);
 const run=applyPatch(project,plan.id,plan.approval_hash);
 assert.equal(run.state,'failed');assert.equal(run.checks[0].passed,false);assert.match(readFileSync(join(root,'service.js'),'utf8'),/= 2/);
});
