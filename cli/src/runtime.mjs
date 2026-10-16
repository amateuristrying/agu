import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, lstatSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { scan, sha, time, plain, regularPath } from './project.mjs';
import { locked, manifest, saveManifest, source, putSource, writeRecord, readRecord, listRecords, directory, atomic } from './store.mjs';
export { openProject } from './store.mjs';
export { plain } from './project.mjs';

export function sync(project) {
  return locked(project, () => {
    const current = scan(project.root), data = manifest(project);
    const notesDir=join(project.state,'knowledge','notes'); directory(notesDir);
    const previousNotes=new Map(data.notes.map(n=>[n.filename,n]));
    const notes=readdirSync(notesDir).filter(name=>/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.md$/.test(name)).sort().map(filename=>{
      if(!regularPath(notesDir,filename)||lstatSync(join(notesDir,filename)).size>512*1024)throw new Error('Notes must be regular text files under 512 KiB.');
      const content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(readFileSync(join(notesDir,filename)));
      if(content.includes('\0'))throw new Error('Notes must be text.');
      return {path:`note:${filename}`,filename,title:previousNotes.get(filename)?.title||filename,hash:putSource(project,content),lines:content.split('\n').length};
    });
    const priorNotes=data.notes; data.notes=notes;
    const digest = sha(JSON.stringify({ project: current.digest, notes: data.notes.map(n => [n.path,n.hash]) }));
    if (data.snapshot?.digest === digest) return { ...data.snapshot, changed: 0, unchanged: true };
    const id = (data.snapshot?.id || 0) + 1, created_at = time();
    const old = new Map(data.files.map(file => [file.path,file.hash]));
    const changes = [];
    const files = current.files.map(file => {
      const hash = putSource(project,file.content);
      if (old.get(file.path) !== hash) changes.push({ snapshot_id:id, path:file.path, kind:old.has(file.path)?'updated':'added', old_hash:old.get(file.path)||null, new_hash:hash, created_at, head:current.head });
      old.delete(file.path);
      return { path:file.path, hash, lines:file.content.split('\n').length };
    });
    const oldNotes=new Map(priorNotes.map(n=>[n.path,n.hash]));
    for(const note of notes){if(oldNotes.get(note.path)!==note.hash)changes.push({snapshot_id:id,path:note.path,kind:oldNotes.has(note.path)?'updated':'added',old_hash:oldNotes.get(note.path)||null,new_hash:note.hash,created_at,head:current.head});oldNotes.delete(note.path);}
    for(const [path,hash] of oldNotes)changes.push({snapshot_id:id,path,kind:'removed',old_hash:hash,new_hash:null,created_at,head:current.head});
    for (const [path,hash] of old) changes.push({ snapshot_id:id,path,kind:'removed',old_hash:hash,new_hash:null,created_at,head:current.head });
    data.snapshot = { id, digest, project_digest:current.digest, head:current.head, created_at, file_count:files.length, skipped:current.skipped };
    data.files=files; data.changes.push(...changes);
    saveManifest(project,data);
    return {...data.snapshot,changed:changes.length,unchanged:false};
  });
}
export function fresh(project) {
  const data=manifest(project);
  if (!data.snapshot) throw new Error('Run agu sync first.');
  const digest = sha(JSON.stringify({ project:scan(project.root).digest, notes:data.notes.map(n=>[n.path,n.hash]) }));
  if(digest!==data.snapshot.digest) throw new Error('Project evidence has changed. Run agu sync and create a new plan.');
  for(const note of data.notes) {
    const file=join(project.state,'knowledge','notes',note.filename);
    if(!regularPath(join(project.state,'knowledge','notes'),note.filename)||sha(readFileSync(file))!==note.hash) throw new Error('A knowledge note changed. Run agu sync.');
  }
  return data;
}
export function status(project) {
  const data=manifest(project);
  let stale=false; try { fresh(project); } catch { stale=true; }
  return { root:project.root, storage:'user-owned-files', knowledge_base:join(project.state,'knowledge'), snapshot:data.snapshot, stale, notes:data.notes.length, plans:listRecords(project,'plans').map(p=>({id:p.payload.id,type:p.payload.type,created_at:p.created_at})).slice(0,20), runs:listRecords(project,'runs').slice(0,20) };
}
export function history(project) { return manifest(project).changes.slice(-50).reverse(); }
export function remember(project, path) {
  if(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()||lstatSync(path).size>512*1024) throw new Error('Import a regular UTF-8 text file up to 512 KiB.');
  const bytes=readFileSync(path);
  if(bytes.includes(0)) throw new Error('Notes must be text.');
  const content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes), hash=sha(content);
  const result=locked(project,()=>{
    const data=manifest(project);
    if(data.notes.some(n=>n.hash===hash)) return data.notes.find(n=>n.hash===hash);
    const filename=`${randomUUID()}.md`, note={path:`note:${filename}`,filename,title:basename(path),hash,lines:content.split('\n').length};
    atomic(join(project.state,'knowledge','notes',filename),content); putSource(project,content);
    data.notes.push(note);saveManifest(project,data);return note;
  });
  sync(project); return result;
}
const stop=new Set('what when where why how the a an is are was were and or to of in for this that might changed break fix issue'.split(' '));
export function search(project, query, { limit=8, context=false }={}) {
  if(typeof query!=='string'||!query.trim()||query.length>1000) throw new Error('Enter a question of 1–1,000 characters.');
  const data=fresh(project);
  const words=[...new Set(query.toLowerCase().match(/[\p{L}\p{N}_]+/gu)||[])].filter(w=>!stop.has(w)).slice(0,24);
  const changed=new Set(data.changes.filter(c=>c.snapshot_id===data.snapshot.id).map(c=>c.path));
  const chunks=[];
  for(const file of [...data.files,...data.notes]) {
    const lines=source(project,file).split(/\r?\n/);
    for(let i=0;i<lines.length;i+=24) {
      const excerpt=lines.slice(i,i+24).join('\n');
      if(excerpt.length>7000) continue;
      const text=excerpt.toLowerCase(), name=file.path.toLowerCase();
      let score=words.reduce((n,w)=>n+(text.includes(w)?2:0)+(name.includes(w)?3:0),0);
      if(context) score+=(changed.has(file.path)?1:0)+(/readme|architecture/i.test(file.path)?1:0);
      if(score>0) chunks.push({path:file.path,hash:file.hash,line:i+1,end_line:Math.min(i+24,lines.length),excerpt,score});
    }
  }
  chunks.sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path)||a.line-b.line);
  let budget=0; const counts=new Map(),selected=[];
  for(const chunk of chunks){if(selected.length>=limit)break;if((counts.get(chunk.path)||0)>=2||budget+chunk.excerpt.length>30000)continue;selected.push(chunk);counts.set(chunk.path,(counts.get(chunk.path)||0)+1);budget+=chunk.excerpt.length;}
  const evidence=selected.map(({score,...item},i)=>({id:`E${i+1}`,...item}));
  return {query,snapshot:data.snapshot.id,digest:data.snapshot.digest,head:data.snapshot.head,evidence,changes:context?history(project).slice(0,12):[],method:'Local lexical retrieval; source excerpts are not an AI answer.'};
}
export function savePlan(project, payload) {
  const serialized=JSON.stringify(payload), hash=sha(serialized);
  writeRecord(project,'plans',payload.id,{hash,payload,created_at:payload.created_at});
  return {...payload,approval_hash:hash,status:'proposed'};
}
export function showPlan(project,id) {
  const row=readRecord(project,'plans',id);
  if(sha(JSON.stringify(row.payload))!==row.hash||row.payload.id!==id) throw new Error('Plan integrity check failed.');
  return {...row.payload,approval_hash:row.hash,status:'proposed'};
}
export function planReport(project,query) {
  return locked(project,()=>{
    const results=search(project,query);
    if(!results.evidence.length) throw new Error('No matching evidence.');
    const id=randomUUID();
    return savePlan(project,{version:2,id,type:'write-evidence-report',root:project.root,digest:results.digest,created_at:time(),expires_at:new Date(Date.now()+86400000).toISOString(),output:`.agu/reports/${id}.md`,results});
  });
}
export function assertApproval(project,plan,approval) {
  if(approval!==plan.approval_hash) throw new Error('Exact approval required. Review agu show <id>, then pass --approve <approval_hash>.');
  if(plan.root!==project.root) throw new Error('Plan belongs to a different project.');
  if(!Number.isFinite(Date.parse(plan.expires_at))||Date.now()>Date.parse(plan.expires_at)) throw new Error('Plan expired.');
  if(fresh(project).snapshot.digest!==plan.digest) throw new Error('Plan is stale. Create a new plan.');
}
export function applyPlan(project,id,approval) {
  return locked(project,()=>{
    const plan=showPlan(project,id);
    assertApproval(project,plan,approval);
    if(plan.type!=='write-evidence-report'||plan.output!==`.agu/reports/${id}.md`) throw new Error('Unsupported report action.');
    const output=join(project.root,plan.output);
    directory(join(project.state,'reports'));
    const report=['# AGU evidence report','',`Query: ${JSON.stringify(plan.results.query)}`,'',...plan.results.evidence.flatMap(e=>[`${JSON.stringify(e.path)}:${e.line}–${e.end_line}`,`SHA-256: ${e.hash}`,...e.excerpt.split('\n').map(l=>'    '+l),''])].join('\n');
    let reused=false;
    if(existsSync(output)) {
      if(!regularPath(project.root,plan.output)||readFileSync(output,'utf8')!==report) throw new Error('Report already exists with unexpected content.');
      reused=true;
    } else writeFileSync(output,report,{flag:'wx',mode:0o600});
    if(readFileSync(output,'utf8')!==report) throw new Error('Report verification failed.');
    const result={id,created_at:time(),state:'verified',output:plan.output,reused};
    writeRecord(project,'runs',id,result);return result;
  });
}
