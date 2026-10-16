import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openProject,sync } from '../src/runtime.mjs';
export function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),'agu-v2-test-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>{const r=spawnSync('git',['-C',root,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;};
 git('init','-q');
 writeFileSync(join(root,'README.md'),'# Atlas\nPayment migration is blocked by schema review.\nOwner: engineering.\n');
 writeFileSync(join(root,'service.js'),'export const paymentVersion = 2;\n');
 writeFileSync(join(root,'.env'),'PRIVATE_TOKEN=not-for-context\n');
 writeFileSync(join(root,'untracked.md'),'not indexed\n');
 git('add','README.md','service.js','.env');git('-c','user.name=AGU Test','-c','user.email=test@example.invalid','-c','core.hooksPath=/dev/null','commit','-qm','Fixture');
 const project=openProject(root,{initialize:true});sync(project);return {root,project,git};
}
export function mockModel(factory,observe=()=>{}) {
 return async(url,options)=>{observe(url,options);const body=JSON.parse(options.body), user=JSON.parse((body.messages||body.input)[1].content);const value=typeof factory==='function'?factory(user):factory;
 const envelope=url.includes('openai.com')?{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]}:{done:true,done_reason:'stop',message:{content:JSON.stringify(value)}};
 return new Response(JSON.stringify(envelope),{headers:{'Content-Type':'application/json'}});};
}
export const opts={provider:'ollama',model:'fixture-model',allowModel:true};
export function validAnswer(user) {
 const e=user.evidence.find(e=>e.path==='README.md');return {facts:[{text:'The payment migration awaits schema review.',citations:[{evidence_id:e.id,start_line:2,end_line:2}]}],inferences:[{text:'The review may delay the release.',citations:[{evidence_id:e.id,start_line:2,end_line:2}]}],missing_information:['No release deadline is available.']};
}
export function validPatch(user) {
 const e=user.evidence.find(e=>e.path==='service.js');return {rationale:'Propose the requested payment version change.',edits:[{path:'service.js',old_text:'paymentVersion = 2',new_text:'paymentVersion = 3',citations:[{evidence_id:e.id,start_line:1,end_line:1}]}],suggested_checks:['Run the payment contract tests.'],missing_information:['No deployment verification is included.']};
}
