import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import * as runtime from './runtime.mjs';
import { providerConfig, prepareContext, ask } from './model.mjs';
import { planPatch } from './patch.mjs';
import { manifest, listRecords } from './store.mjs';
const ui=new URL('../ui/',import.meta.url);

function applyChild(project,id,approval) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL('../bin/agu.mjs',import.meta.url)),'apply',id,'--approve',approval,'--project',project.root,'--json'],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',size=0;
    child.stdout.on('data',b=>{size+=b.length;if(size>1024*1024)child.kill();else stdout+=b;});
    child.stderr.on('data',b=>{stderr=(stderr+b).slice(-4000);});
    child.on('error',reject);
    child.on('close',()=>{try{resolve(JSON.parse(stdout));}catch{reject(new Error(stderr||'Execution stopped. Inspect the run log before retrying.'));}});
  });
}
export async function startServer(project,{port=4317,provider,model,fetchImpl}={}) {
  const token=randomBytes(32).toString('hex');let origin;
  const configOptions={provider,model};
  let modelBusy=false,applying=false;
  const server=createServer(async(req,res)=>{
    const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    try {
      if(req.headers.host!==new URL(origin).host)return send(403,{error:'Invalid host.'});
      if(req.headers.origin&&req.headers.origin!==origin)return send(403,{error:'Cross-origin access is denied.'});
      const path=new URL(req.url,origin).pathname;
      const assets={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
      if(req.method==='GET'&&assets[path]){const [file,type]=assets[path];res.writeHead(200,{'Content-Type':type});return res.end(readFileSync(new URL(file,ui)));}
      if(!path.startsWith('/api/'))return send(404,{error:'Not found.'});
      const supplied=Buffer.from((req.headers.authorization||'').replace(/^Bearer /,''));
      if(supplied.length!==token.length||!timingSafeEqual(supplied,Buffer.from(token)))return send(401,{error:'Open the full URL printed by agu serve to authorize this browser tab.'});
      if(req.method==='GET'&&path==='/api/workspace') {
        let config=null;try{config=providerConfig(configOptions);}catch{}
        const data=manifest(project);
        return send(200,{...runtime.status(project),files:data.files,notes:data.notes,changes:runtime.history(project),answers:listRecords(project,'answers').slice(0,10),provider:config});
      }
      if(req.method!=='POST')return send(405,{error:'Use POST for this API.'});
      if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'JSON required.'});
      let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>16000)return send(413,{error:'Request too large.'});}
      let body;try{body=JSON.parse(text);}catch{return send(400,{error:'Invalid JSON.'});}
      if(!body||typeof body!=='object'||Array.isArray(body))return send(400,{error:'JSON object required.'});
      if(path==='/api/sync')return send(200,runtime.sync(project));
      if(path==='/api/search')return send(200,runtime.search(project,body.question));
      if(path==='/api/context')return send(200,prepareContext(project,body.question,configOptions));
      if(path==='/api/show')return send(200,runtime.showPlan(project,body.id));
      if(path==='/api/apply') {
        if(applying)return send(409,{error:'An execution is already in progress.'});
        if(typeof body.id!=='string'||typeof body.approval!=='string')throw new Error('Plan ID and exact approval hash are required.');
        applying=true;try{return send(200,await applyChild(project,body.id,body.approval));}finally{applying=false;}
      }
      if(path==='/api/ask'||path==='/api/plan') {
        if(body.allow_model!==true)return send(403,{error:'Explicit model consent is required for each request.'});
        if(modelBusy)return send(409,{error:'A model request is already in progress.'});
        modelBusy=true;
        try {
          const options={...configOptions,allowModel:true,fetchImpl,checks:body.checks||[],image:body.image};
          return send(200,path==='/api/ask'?await ask(project,body.question,options):await planPatch(project,body.question,options));
        }finally{modelBusy=false;}
      }
      return send(404,{error:'Unknown endpoint.'});
    }catch(error){send(400,{error:runtime.plain(error.message)});}
  });
  server.requestTimeout=150000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  return {server,origin,token,url:`${origin}/#token=${token}`};
}
