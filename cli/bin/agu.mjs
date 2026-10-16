#!/usr/bin/env node
import { resolve } from 'node:path';
import * as runtime from '../src/runtime.mjs';
import { ask } from '../src/model.mjs';
import { planPatch, applyPatch } from '../src/patch.mjs';

const HELP=`AGU local runtime 0.2.0 — your knowledge base, on your machine

agu init                         Create/sync a file-based knowledge base
agu sync | status | history      Refresh or inspect project evidence
agu remember <text-file>         Import a personal/project note
agu search "terms"               Local source search; no model calls
agu ask "question" --preview     Inspect exactly which context is selected
agu ask "question" --allow-model Send selected context to the chosen provider
agu plan "task" --allow-model    Propose a patch with a reviewable diff
agu report "terms"               Propose an evidence report without a model
agu show <plan-id>               Review a saved plan and its approval hash
agu apply <plan-id> --approve <hash>
                                 Prepare patch in isolation; run approved checks
agu serve                       Open the local retro workspace (loopback only)

Options: --project <directory> --json --provider ollama|openai --model <name>
         --preview --allow-model --image <local-docker-image>
         --check '["node","--test","test/example.test.mjs"]' (repeatable)
         --port <1024–65535> (serve; default 4317)

Ollama uses 127.0.0.1:11434. OpenAI requires OPENAI_API_KEY.
No model call occurs without --allow-model. No central context database.
Patch checks require an already-installed local Docker image, pinned at planning.
No GitHub publishing or automatic edits to your original working tree.
`;
export function printResult(command,result) {
  const print=x=>console.log(runtime.plain(x));
  if(command==='ask'&&result.facts) {
    for(const section of ['facts','inferences']) {
      print(`\n${section.toUpperCase()}`);
      for(const claim of result[section])print(`${claim.text}\n${claim.citations.map(c=>`  ${c.path}:${c.start_line}–${c.end_line}`).join('\n')}`);
    }
    print(`\nMISSING INFORMATION\n${result.missing_information.join('\n')||'None reported by the model.'}\n\n${result.validation}`);
  } else if(result.type==='patch'||result.type==='write-evidence-report') {
    print(JSON.stringify(result,null,2));
    if(result.edits)for(const edit of result.edits)print('\n'+edit.diff);
    print(`\nReview first, then approve this exact plan:\nagu apply ${result.id} --approve ${result.approval_hash}`);
  } else print(JSON.stringify(result,null,2));
}
async function main() {
  const raw=process.argv.slice(2);
  if(!raw.length||raw.includes('--help')||raw[0]==='help'){console.log(HELP);return;}
  if(raw[0]==='--version'){console.log('0.2.0');return;}
  const command=raw.shift(), args=[],options={checks:[]};let cwd=process.cwd(),json=false,approval,port=4317;
  while(raw.length) {
    const token=raw.shift();
    if(token==='--json')json=true;
    else if(token==='--preview')options.preview=true;
    else if(token==='--allow-model')options.allowModel=true;
    else if(['--project','--approve','--provider','--model','--check','--image','--port'].includes(token)) {
      const value=raw.shift();if(!value||value.startsWith('--'))throw new Error(`${token} requires a value.`);
      if(token==='--project')cwd=resolve(value);
      else if(token==='--approve')approval=value;
      else if(token==='--port')port=Number(value);
      else if(token==='--check'){try{options.checks.push(JSON.parse(value));}catch{throw new Error('--check must be a JSON argv array.');}}
      else options[token.slice(2)]=value;
    } else if(token.startsWith('--'))throw new Error(`Unknown option: ${token}`);else args.push(token);
  }
  const expected={init:0,sync:0,status:0,history:0,remember:1,search:1,ask:1,plan:1,report:1,show:1,apply:1,serve:0};
  if(!Object.hasOwn(expected,command)||args.length!==expected[command])throw new Error('Unknown command or wrong number of arguments. Use agu --help; quote multiword questions.');
  if(approval&&command!=='apply')throw new Error('--approve is only valid for apply.');
  const project=runtime.openProject(cwd,{initialize:command==='init'});
  try {
    let result;
    if(command==='init'||command==='sync')result=runtime.sync(project);
    if(command==='status')result=runtime.status(project);
    if(command==='history')result=runtime.history(project);
    if(command==='remember')result=runtime.remember(project,resolve(args[0]));
    if(command==='search')result=runtime.search(project,args[0]);
    if(command==='ask')result=await ask(project,args[0],options);
    if(command==='plan')result=await planPatch(project,args[0],options);
    if(command==='report')result=runtime.planReport(project,args[0]);
    if(command==='show')result=runtime.showPlan(project,args[0]);
    if(command==='apply')result=runtime.showPlan(project,args[0]).type==='patch'?applyPatch(project,args[0],approval):runtime.applyPlan(project,args[0],approval);
    if(command==='serve') {
      if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Use a port from 1024 to 65535.');
      const {startServer}=await import('../src/server.mjs');
      const server=await startServer(project,{port,provider:options.provider,model:options.model});
      console.log(`AGU local workspace: ${server.url}\nKeep this terminal running. The URL contains this session’s access token; do not share it.`);return;
    }
    if(json)console.log(JSON.stringify(result,null,2));else printResult(command,result);
    if(command==='apply'&&result.state==='failed')process.exitCode=1;
  }finally{project.close();}
}
main().catch(error=>{console.error(`AGU: ${runtime.plain(error.message).replace(/[\r\n]/g,' ')}`);process.exitCode=1;});
