import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync,readFileSync,existsSync,rmSync,mkdirSync,symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './helpers.mjs';
import { sync,search,status,history,remember,planReport,applyPlan,openProject } from '../src/runtime.mjs';
import { manifest,source,recordPath,readJSON,atomic } from '../src/store.mjs';

test('knowledge base uses readable files, never creates SQLite, and ignores private state',t=>{
 const {project,root,git}=fixture(t);assert.equal(status(project).snapshot.file_count,2);assert.equal(existsSync(join(root,'.agu/project.sqlite')),false);
 assert.ok(existsSync(join(root,'.agu/knowledge/README.md')));assert.equal(search(project,'PRIVATE_TOKEN').evidence.length,0);
 assert.equal(search(project,'not indexed').evidence.length,0);assert.ok(!git('status','--porcelain','--untracked-files=all').includes('.agu/'));
 assert.equal(sync(project).unchanged,true);const e=search(project,'schema review').evidence[0];assert.equal(e.path,'README.md');assert.ok(e.line<=2&&e.end_line>=2);
});
test('changed and removed sources require sync; source history remains locally available',t=>{
 const {project,root}=fixture(t);const old=manifest(project).files.find(f=>f.path==='README.md');writeFileSync(join(root,'README.md'),'# Atlas\nRelease ready.\n');
 assert.equal(status(project).stale,true);assert.throws(()=>search(project,'schema'),/changed/);sync(project);assert.equal(search(project,'schema').evidence.length,0);assert.equal(history(project)[0].kind,'updated');assert.match(source(project,old),/schema review/);
 rmSync(join(root,'service.js'));sync(project);assert.equal(history(project)[0].kind,'removed');
});
test('personal notes are owned files and join the evidence set',t=>{
 const {project,root}=fixture(t);const note=join(root,'decision.md');writeFileSync(note,'We chose the zebra protocol for consistency.\n');
 remember(project,note);assert.equal(search(project,'zebra').evidence.length,1);assert.equal(status(project).notes,1);remember(project,note);assert.equal(status(project).notes,1);
});
test('symlinks and oversized sources are excluded',t=>{
 const {project,root,git}=fixture(t);symlinkSync('README.md',join(root,'linked.md'));writeFileSync(join(root,'large.txt'),'x'.repeat(512*1024+1));git('add','linked.md','large.txt');
 assert.equal(sync(project).file_count,2);
});
test('exact approved reports are idempotent and conflict-safe',t=>{
 const {project,root}=fixture(t);const plan=planReport(project,'schema');assert.throws(()=>applyPlan(project,plan.id,'wrong'),/Exact approval/);
 assert.equal(applyPlan(project,plan.id,plan.approval_hash).state,'verified');assert.equal(applyPlan(project,plan.id,plan.approval_hash).reused,true);
 writeFileSync(join(root,plan.output),'user content');assert.throws(()=>applyPlan(project,plan.id,plan.approval_hash),/unexpected content/);
});
test('source and plan tampering is detected, and tracked private state is rejected',t=>{
 const {project,root,git}=fixture(t);const p=planReport(project,'schema');const path=recordPath(project,'plans',p.id);const record=readJSON(path);record.payload.output='../escape.md';atomic(path,JSON.stringify(record));assert.throws(()=>applyPlan(project,p.id,p.approval_hash),/integrity/);
 const f=manifest(project).files[0];writeFileSync(join(project.state,'knowledge','sources',f.hash+'.txt'),'modified');assert.throws(()=>search(project,'schema'),/integrity/);
 git('add','--force','.agu/knowledge/manifest.json');assert.throws(()=>openProject(root),/remain untracked/);
});
test('legacy SQLite is preserved but is not used by the new runtime',t=>{
 const {root}=fixture(t);const old=join(root,'.agu/project.sqlite');writeFileSync(old,'legacy data');openProject(root,{initialize:true});assert.equal(readFileSync(old,'utf8'),'legacy data');
});


test('hand-edited Markdown notes can be resynced and removed from active retrieval',t=>{
 const {project}=fixture(t);const path=join(project.state,'knowledge','notes','decision.md');writeFileSync(path,'Zebra protocol was chosen.\n');sync(project);assert.equal(search(project,'zebra').evidence.length,1);
 writeFileSync(path,'Falcon protocol replaced it.\n');assert.equal(status(project).stale,true);sync(project);assert.equal(search(project,'zebra').evidence.length,0);assert.equal(search(project,'falcon').evidence.length,1);
 rmSync(path);sync(project);assert.equal(search(project,'falcon').evidence.length,0);
});
