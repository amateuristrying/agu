import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture,mockModel,validAnswer,validPatch } from './helpers.mjs';
import { startServer } from '../src/server.mjs';

test('local API requires its session token, rejects cross-origin requests, and shows real evidence',async t=>{
 const {project}=fixture(t);const {server,origin,token}=await startServer(project,{port:0,provider:'ollama',model:'fixture-model'});t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const auth={Authorization:'Bearer '+token};
 assert.equal((await fetch(origin+'/api/workspace')).status,401);
 assert.equal((await fetch(origin+'/api/workspace',{headers:{...auth,Origin:'https://untrusted.example'}})).status,403);
 const workspace=await (await fetch(origin+'/api/workspace',{headers:auth})).json();assert.equal(workspace.storage,'user-owned-files');assert.ok(workspace.files.some(f=>f.path==='service.js'));assert.ok(!JSON.stringify(workspace).includes('PRIVATE_TOKEN'));
 const page=await fetch(origin);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 const search=await fetch(origin+'/api/search',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({question:'schema'})});assert.equal((await search.json()).evidence[0].path,'README.md');
});
test('API enforces per-request model consent and supports the real answer flow',async t=>{
 const {project}=fixture(t);let calls=0;const {server,origin,token}=await startServer(project,{port:0,provider:'ollama',model:'fixture-model',fetchImpl:mockModel(validAnswer,()=>calls++)});t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const request=body=>fetch(origin+'/api/ask',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await request({question:'schema'})).status,403);assert.equal(calls,0);
 const response=await request({question:'schema',allow_model:true});assert.equal(response.status,200);assert.equal((await response.json()).facts[0].citations[0].path,'README.md');assert.equal(calls,1);
});


test('API patch review and approved execution reaches an isolated prepared workspace',async t=>{
 const {project}=fixture(t);const {server,origin,token}=await startServer(project,{port:0,provider:'ollama',model:'fixture-model',fetchImpl:mockModel(validPatch)});t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const post=(route,body)=>fetch(origin+'/api/'+route,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const response=await post('plan',{question:'paymentVersion',allow_model:true});assert.equal(response.status,200);const plan=await response.json();assert.match(plan.edits[0].diff,/paymentVersion = 3/);
 assert.equal((await post('apply',{id:plan.id,approval:'wrong'})).status,400);
 const applied=await post('apply',{id:plan.id,approval:plan.approval_hash});assert.equal(applied.status,200);assert.equal((await applied.json()).state,'prepared');
});
