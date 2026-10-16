import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { prepareContext, requestModel, patchSchema, citations, strings, checkFreshResponse } from './model.mjs';
import { fresh, savePlan, showPlan, assertApproval } from './runtime.mjs';
import { source, locked, writeRecord, readRecord, recordPath, directory } from './store.mjs';
import { sha, time, eligible } from './project.mjs';

export function safeEditPath(path) {
  return typeof path==='string'&&path.length<240&&/^[A-Za-z0-9_./-]+$/.test(path)&&!path.startsWith('/')&&!path.split('/').some(p=>!p||p==='..'||p==='.'||p.startsWith('.'))&&eligible(path);
}
function diffFile(path,before,after) {
  const lines=value=>value.endsWith('\n')?value.slice(0,-1).split('\n'):value.split('\n');
  const a=before?lines(before):[],b=after?lines(after):[];
  return [`diff --git a/${path} b/${path}`,`--- a/${path}`,`+++ b/${path}`,`@@ -${a.length?1:0},${a.length} +${b.length?1:0},${b.length} @@`,...a.map(l=>'-'+l),...(!before.endsWith('\n')&&before?['\\ No newline at end of file']:[]),...b.map(l=>'+'+l),...(!after.endsWith('\n')&&after?['\\ No newline at end of file']:[]),''].join('\n');
}
export function validateChecks(checks) {
  if(!Array.isArray(checks)||checks.length>6)throw new Error('Provide at most six checks as JSON argv arrays.');
  for(const argv of checks) if(!Array.isArray(argv)||!argv.length||argv.length>30||argv.some(v=>typeof v!=='string'||!v||v.length>500||v.includes('\0')))throw new Error('Each check must be a nonempty JSON array of command arguments.');
  return checks;
}
function localDockerEnv() {
  const env={...process.env};
  for(const key of ['DOCKER_CONTEXT','DOCKER_HOST','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
  return env;
}
export function docker(command,args,options={}) {
  const result=spawnSync(command,args,{encoding:'utf8',timeout:15000,maxBuffer:1024*1024,...(args.includes('--host')?{env:localDockerEnv()}:{}),...options});
  if(result.error||result.status!==0)throw new Error('Local Docker is unavailable or the requested image is not installed. No host fallback is allowed.');
  return result.stdout.trim();
}
export function imageIdentity(image) {
  if(typeof image!=='string'||!image||image.startsWith('-'))throw new Error('Specify a locally installed Docker image with --image when checks are requested.');
  const endpoint=process.env.DOCKER_HOST||docker('docker',['context','inspect','--format','{{.Endpoints.docker.Host}}']);
  if(!endpoint.startsWith('unix://'))throw new Error('Only a local Unix-socket Docker engine is supported; remote engines would transmit project files.');
  const id=docker('docker',['--host',endpoint,'image','inspect','--format','{{.Id}}',image]);
  if(!/^sha256:[a-f0-9]{64}$/.test(id))throw new Error('Cannot pin Docker image identity.');
  return {image:id,endpoint};
}
export async function planPatch(project,question,options={}) {
  const prepared=prepareContext(project,question,options);
  if(options.preview)return prepared;
  const checks=validateChecks(options.checks||[]);
  const isolation=checks.length?imageIdentity(options.image):null;
  const proposed=await requestModel(prepared,patchSchema,'Propose a small patch using exact old_text/new_text replacements in existing source files. Explain uncertainty. Do not propose edits to notes. Each old_text must be fully present in its cited excerpt.',options);
  if(typeof proposed.rationale!=='string'||!proposed.rationale.trim()||proposed.rationale.length>4000)throw new Error('Invalid patch rationale.');
  const suggested_checks=strings(proposed.suggested_checks,'suggested checks'), missing_information=strings(proposed.missing_information,'missing information');
  if(!Array.isArray(proposed.edits)||!proposed.edits.length||proposed.edits.length>6)throw new Error('Model must propose 1–6 bounded edits. No patch was created.');
  return locked(project,()=>{
    checkFreshResponse(project,prepared.context);
    const data=fresh(project), seen=new Set();
    const edits=proposed.edits.map(edit=>{
      if(!safeEditPath(edit.path)||seen.has(edit.path))throw new Error('Patch has an unsafe or duplicate target path.');
      seen.add(edit.path);
      const file=data.files.find(f=>f.path===edit.path);
      if(!file)throw new Error('Patch targets an unindexed file.');
      const refs=citations(edit.citations,prepared.context);
      if(!refs.some(c=>c.path===edit.path&&c.hash===file.hash))throw new Error('An edit must cite its own source file.');
      if(typeof edit.old_text!=='string'||!edit.old_text||typeof edit.new_text!=='string'||edit.old_text.length>12000||edit.new_text.length>12000||edit.old_text===edit.new_text)throw new Error('Invalid exact-text edit.');
      if(!prepared.context.evidence.some(e=>e.path===edit.path&&e.hash===file.hash&&e.excerpt.includes(edit.old_text)))throw new Error('Replacement text must come from the provided evidence.');
      const before=source(project,file);
      if(before.length>80000||before.split(edit.old_text).length!==2)throw new Error('Replacement must match exactly once in a source file under 80,000 characters.');
      const after=before.replace(edit.old_text,()=>edit.new_text);
      return {path:edit.path,before_hash:file.hash,after_hash:sha(after),after,citations:refs,diff:diffFile(edit.path,before,after)};
    });
    const id=randomUUID();
    return savePlan(project,{version:2,id,type:'patch',root:project.root,digest:data.snapshot.digest,head:data.snapshot.head,created_at:time(),expires_at:new Date(Date.now()+86400000).toISOString(),question,rationale:proposed.rationale,edits,checks,isolation,suggested_checks,missing_information,provider:prepared.config.provider,model:prepared.config.model});
  });
}
export function dockerArgs(plan,workspace,name,argv) {
  if(/[,\r\n]/.test(workspace))throw new Error('Docker workspace paths cannot contain commas or line breaks.');
  return ['--host',plan.isolation.endpoint,'run','--name',name,'--pull=never','--rm','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=128','--memory=512m','--cpus=1','--user=65534:65534','--tmpfs=/tmp:rw,noexec,nosuid,size=64m','--mount',`type=bind,source=${workspace},target=/workspace,readonly`,'--workdir=/workspace','--env=HOME=/tmp',plan.isolation.image,...argv];
}
function execute(plan,workspace,argv,index) {
  const name=`agu-${plan.id}-${index}`;
  const args=dockerArgs(plan,workspace,name,argv);
  const result=spawnSync('docker',args,{encoding:'utf8',timeout:60000,killSignal:'SIGKILL',maxBuffer:512*1024,env:localDockerEnv()});
  // Killing the Docker CLI does not necessarily kill its container.
  spawnSync('docker',['--host',plan.isolation.endpoint,'rm','--force',name],{stdio:'ignore',timeout:10000,env:localDockerEnv()});
  return {index,argv,exit_code:result.status,passed:!result.error&&result.status===0,error:result.error?'Check timed out, exceeded output limits, or Docker failed.':null,stdout:(result.stdout||'').slice(0,30000),stderr:(result.stderr||'').slice(0,10000)};
}
export function applyPatch(project,id,approval,{runCheck=execute}={}) {
  return locked(project,()=>{
    const plan=showPlan(project,id);
    assertApproval(project,plan,approval);
    if(plan.type!=='patch'||!Array.isArray(plan.edits)||!plan.edits.length)throw new Error('Invalid patch plan.');
    validateChecks(plan.checks);
    const saved=recordPath(project,'runs',id);
    if(existsSync(saved))return {...readRecord(project,'runs',id),reused:true};
    const data=fresh(project), map=new Map(data.files.map(f=>[f.path,f]));
    for(const edit of plan.edits)if(!safeEditPath(edit.path)||map.get(edit.path)?.hash!==edit.before_hash||sha(edit.after)!==edit.after_hash)throw new Error('Patch integrity or target precondition failed.');
    if(plan.checks.length&&(!plan.isolation||!/^sha256:[a-f0-9]{64}$/.test(plan.isolation.image)||!plan.isolation.endpoint.startsWith('unix://')))throw new Error('Checks need a pinned local Docker image.');
    const run={id,plan_id:id,approval_hash:approval,created_at:time(),state:'preparing',workspace:`.agu/runs/${id}/workspace`,checks:[],verification:'No checks have run.'};
    writeRecord(project,'runs',id,run);
    try {
      const runDir=join(project.state,'runs',id); directory(runDir);
      const workspace=join(runDir,'workspace');
      if(existsSync(workspace))throw new Error('Workspace already exists; refusing to reuse unverified files.');
      mkdirSync(workspace,{mode:0o755});
      for(const file of data.files) {
        if(!safeEditPath(file.path))continue;
        const path=join(workspace,file.path);
        mkdirSync(dirname(path),{recursive:true,mode:0o755});
        const edit=plan.edits.find(e=>e.path===file.path);
        writeFileSync(path,edit?edit.after:source(project,file),{flag:'wx',mode:0o644});
      }
      for(const edit of plan.edits)if(sha(readFileSync(join(workspace,edit.path)))!==edit.after_hash)throw new Error('Prepared patch hash mismatch.');
      writeFileSync(join(runDir,'changes.patch'),plan.edits.map(e=>e.diff).join('\n'),{flag:'wx',mode:0o600});
      run.state='prepared';run.verification='Patch bytes verified. No behavioral checks requested.';writeRecord(project,'runs',id,run);
      for(const [index,argv] of plan.checks.entries()) {
        run.state='executing';run.active_container=`agu-${id}-${index}`;writeRecord(project,'runs',id,run);
        const result=runCheck(plan,workspace,argv,index);run.checks.push(result);writeRecord(project,'runs',id,run);
        if(!result.passed)break;
      }
      delete run.active_container;
      if(plan.checks.length) {
        const passed=run.checks.length===plan.checks.length&&run.checks.every(c=>c.passed);
        run.state=passed?'verified':'failed';run.verification=passed?'All approved checks passed in the isolated container. This does not establish production correctness.':'An approved check failed. Inspect logs; the original project was not modified.';
      }
    }catch(error){run.state='failed';run.error=error.message;run.verification='Execution did not complete.';}
    run.finished_at=time();writeRecord(project,'runs',id,run);return run;
  });
}
