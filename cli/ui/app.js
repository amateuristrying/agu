(() => {
  const $=s=>document.querySelector(s);
  const hash=new URLSearchParams(location.hash.slice(1));
  let token=hash.get('token')||sessionStorage.getItem('agu-session');
  if(hash.has('token')){sessionStorage.setItem('agu-session',token);history.replaceState(null,'',location.pathname);}
  let plan=null,busy=false;
  const status=text=>$('#status').textContent=text;
  const el=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
  async function api(path,body) {
    const response=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Request failed.');return data;
  }
  async function work(fn) {
    if(busy)return;busy=true;$('#submit').disabled=true;$('#apply').disabled=true;
    try{await fn();}catch(error){status(error.message);}finally{busy=false;$('#submit').disabled=false;$('#apply').disabled=false;}
  }
  function list(selector,items,format) {const target=$(selector);target.replaceChildren();items.forEach(item=>target.append(el('li',format(item))));if(!items.length)target.append(el('li','No records yet.'));}
  async function refresh() {
    const data=await api('workspace');
    $('#project-path').textContent=data.root;$('#connection').textContent='● LOCAL CONNECTION';
    $('#freshness').textContent=data.stale?'Evidence changed — sync before asking or planning.':'Evidence is current.';
    $('#counts').textContent=`${data.files.length} source files · ${data.notes.length} notes · snapshot ${data.snapshot?.id||0}`;
    $('#provider').textContent=data.provider?`Provider: ${data.provider.provider} / ${data.provider.model} → ${data.provider.destination}`:'No model configured. Restart agu serve with --model and optionally --provider.';
    list('#sources',[...data.files,...data.notes],f=>f.title||f.path);
    list('#changes',data.changes.slice(0,12),c=>`${c.kind.toUpperCase()} · ${c.path}`);
    $('#plans').replaceChildren();data.plans.forEach(p=>{const li=el('li',''),button=el('button',`${p.type} · ${p.id.slice(0,8)}`);button.onclick=()=>work(async()=>review(await api('show',{id:p.id})));li.append(button);$('#plans').append(li);});
    $('#runs').replaceChildren();data.runs.slice(0,6).forEach(run=>{const details=el('details','');details.append(el('summary',`${run.state.toUpperCase()} · ${run.id.slice(0,8)}`),el('pre',JSON.stringify(run,null,2)));$('#runs').append(details);});
    status('Knowledge base loaded. All project data is stored locally.');
  }
  function results(data) {
    const target=$('#result');target.replaceChildren();
    if(data.facts) {
      for(const key of ['facts','inferences']){target.append(el('h3',key.toUpperCase()));data[key].forEach(c=>{target.append(el('p',c.text),el('code',c.citations.map(r=>`${r.path}:${r.start_line}–${r.end_line}`).join(' · ')));});}
      target.append(el('h3','MISSING INFORMATION'));data.missing_information.forEach(t=>target.append(el('p',t)));target.append(el('p',data.validation));
    }else if(data.evidence){data.evidence.forEach(e=>target.append(el('h3',`${e.path}:${e.line}–${e.end_line}`),el('pre',e.excerpt)));if(!data.evidence.length)target.append(el('p','No matching evidence.'));}
    else target.append(el('pre',JSON.stringify(data,null,2)));
  }
  function review(value) {
    if(value.type!=='patch'){results(value);return;}
    plan=value;$('#plan-panel').hidden=false;$('#plan-summary').textContent=value.rationale;
    $('#diff').textContent=value.edits.map(e=>e.diff).join('\n');
    $('#plan-checks').textContent=`Checks: ${JSON.stringify(value.checks)}\nImage: ${value.isolation?.image||'None — patch preparation only'}\nSuggested (not executed): ${value.suggested_checks.join('; ')}\nMissing information: ${value.missing_information.join('; ')}`;
    $('#approval-hash').textContent=value.approval_hash;$('#approval').value='';status('Review the exact patch and checks before approving.');
  }
  $('#refresh').onclick=()=>work(refresh);
  $('#sync').onclick=()=>work(async()=>{await api('sync',{});await refresh();});
  $('#preview').onclick=()=>work(async()=>{results(await api('context',{question:$('#question').value}));status('Context preview only. Nothing was sent to a model.');});
  $('#question').oninput=()=>{$('#consent').checked=false;};$('#mode').onchange=()=>{$('#consent').checked=false;};
  $('#query-form').onsubmit=event=>{event.preventDefault();work(async()=>{
    const mode=$('#mode').value,question=$('#question').value;
    if(mode!=='search'&&!$('#consent').checked)throw new Error('Preview the selected context and allow this model request first.');
    let checks=[];if(mode==='plan'&&$('#checks').value.trim()){try{checks=JSON.parse($('#checks').value);}catch{throw new Error('Checks must be valid JSON.');}}
    const allow_model=$('#consent').checked;$('#consent').checked=false;
    status(mode==='search'?'Searching local evidence…':'Waiting for the selected model…');
    const data=await api(mode,{question,allow_model,checks,image:$('#image').value});
    if(mode==='plan'){await refresh();review(data);}else{results(data);status('Request complete.');}
  });};
  $('#apply').onclick=()=>work(async()=>{
    if(!plan||$('#approval').value!==plan.approval_hash)throw new Error('Paste the exact approval hash after reviewing the patch.');
    status('Preparing an isolated workspace and running only approved checks…');
    const data=await api('apply',{id:plan.id,approval:$('#approval').value});$('#approval').value='';await refresh();results(data);status(`Run ${data.state}. ${data.verification||''}`);
  });
  work(refresh);
})();
