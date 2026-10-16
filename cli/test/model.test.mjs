import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture,mockModel,opts,validAnswer } from './helpers.mjs';
import { ask,providerConfig } from '../src/model.mjs';
import { listRecords } from '../src/store.mjs';

test('no model call without consent; preview reveals selected context without credentials',async t=>{
 const {project}=fixture(t);let calls=0;const fetchImpl=mockModel(validAnswer,()=>calls++);
 await assert.rejects(ask(project,'schema',{...opts,allowModel:false,fetchImpl}),/No context was sent/);assert.equal(calls,0);
 const preview=await ask(project,'schema',{...opts,preview:true,fetchImpl});assert.equal(calls,0);assert.ok(preview.context.evidence.length);assert.ok(!JSON.stringify(preview).includes('PRIVATE_TOKEN'));
});
test('answers distinguish facts and inferences and preserve validated source references',async t=>{
 const {project}=fixture(t);const a=await ask(project,'payment',{...opts,fetchImpl:mockModel(validAnswer)});assert.equal(a.facts[0].citations[0].path,'README.md');assert.equal(a.inferences.length,1);assert.equal(a.missing_information.length,1);assert.equal(listRecords(project,'answers').length,1);
});
test('nonexistent citations and out-of-range lines are rejected without saving answers',async t=>{
 const {project}=fixture(t);for(const invalid of [{evidence_id:'E999',start_line:1,end_line:1},{evidence_id:'E1',start_line:999,end_line:999}]) {
 await assert.rejects(ask(project,'payment',{...opts,fetchImpl:mockModel({facts:[{text:'Unsupported',citations:[invalid]}],inferences:[],missing_information:[]})}),/nonexistent/);
 }assert.equal(listRecords(project,'answers').length,0);
});
test('changed evidence during a model call invalidates the response',async t=>{
 const {project,root}=fixture(t);await assert.rejects(ask(project,'schema',{...opts,fetchImpl:mockModel(validAnswer,()=>writeFileSync(join(root,'README.md'),'changed\n'))}),/changed/);assert.equal(listRecords(project,'answers').length,0);
});
test('OpenAI request uses the fixed endpoint and disables response storage',async t=>{
 const {project}=fixture(t);const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture-only-key';t.after(()=>{if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;});
 let observed;await ask(project,'schema',{...opts,provider:'openai',fetchImpl:mockModel(validAnswer,(url,options)=>{observed={url,...options};})});
 assert.equal(observed.url,'https://api.openai.com/v1/responses');const body=JSON.parse(observed.body);assert.equal(body.store,false);assert.equal(body.text.format.type,'json_schema');assert.equal(observed.redirect,'error');assert.ok(!JSON.stringify(listRecords(project,'answers')).includes('fixture-only-key'));
});
test('provider errors and malformed output do not become valid answers',async t=>{
 const {project}=fixture(t);await assert.rejects(ask(project,'schema',{...opts,fetchImpl:async()=>new Response('private provider error',{status:500})}),/HTTP 500/);
 await assert.rejects(ask(project,'schema',{...opts,fetchImpl:async()=>new Response(JSON.stringify({done:true,message:{content:'not JSON'}}))}),/not valid JSON/);
 assert.throws(()=>providerConfig({provider:'arbitrary',model:'x'}),/Choose provider/);
});
