(() => {
  const root = document.querySelector('#capabilities');
  const desktop = document.querySelector('#retro-desktop');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const gsap = window.gsap;
  const $ = selector => root.querySelector(selector);
  let ambient = null, entrance = null, queryAnimation = null;
  let active = false, inView = false, paused = false;
  const resources = {
    files: ['Local files', 'Architecture, product briefs and decisions. The documents behind the work.'],
    web: ['Web', 'Research, references and API documentation, connected to the decisions they informed.'],
    git: ['GitHub', 'Commits, pull requests and releases. Follow a change back to its original intent.'],
    db: ['PostgreSQL', 'Schema notes and data relationships, linked to the services that depend on them.'],
    notes: ['Notes', 'Meeting notes and team decisions. The why behind what was built.'],
  };
  const memories = {
    working: [['Current conversation','NOW'],['Project Atlas context','11:24'],['Open release review','10:31']],
    episodic: [['Release v4.2 deployed','SEP 28'],['Payment incident opened','SEP 28'],['Architecture review','SEP 24']],
    semantic: [['Atlas service map','PROJECT'],['Payment API contract','SERVICE'],['Team ownership','PEOPLE']],
  };
  const queries = {
    overview: { number:'01', label:'THE CURRENT PICTURE', status:'In progress', summary:'Release 4.2 is in staging. A payment API change connects the latest commits, an open incident and a pending review. The next step is clear.', next:'Review the payment API changes before production rollout.', log:'Context ready. 5 sources connected. Project history in view.' },
    changes: { number:'02', label:'FROM COMMIT TO CONSEQUENCE', status:'In review', summary:'Commit a8f42c introduced the new payment flow. The staging deployment and incident report point to the same change. Three linked sources explain what happened.', next:'Compare the payment contract with commit a8f42c and the staging logs.', log:'Change traced. Commit a8f42c → release v4.2 → staging incident.' },
    decisions: { number:'03', label:'THE REASON BEHIND THE DESIGN', status:'Documented', summary:'The team separated payments from the core service to isolate failures. The architecture note, review discussion and first implementation preserve the decision together.', next:'Open the architecture decision before changing the service boundary.', log:'Decision recovered. architecture.md ↔ team notes ↔ commit dc19e2.' },
  };
  function syncMotion() {
    const running = active && inView && !paused && !document.hidden && !reduced.matches && !$('#desktop-body').hidden;
    if (running) ambient?.resume(); else ambient?.pause();
  }
  function createAmbient() {
    if (!gsap || ambient) return;
    ambient = gsap.timeline({ repeat:-1, paused:true });
    ambient.to('.graph-packet', { attr:{ cy:62 }, opacity:1, duration:1.5, ease:'none' })
      .to('.graph-central rect', { fill:'#9eb7ff', duration:.65, yoyo:true, repeat:1 }, .8)
      .fromTo('.chart-cursor', { opacity:.35 }, { opacity:1, duration:.7, repeat:3, yoyo:true }, 0)
      .to('.graph-packet', { opacity:0, duration:.3 }, 1.5)
      .set('.graph-packet', { attr:{ cy:43 } }, 2.1)
      .to('.terminal-caret', { opacity:0, duration:.01, repeat:5, yoyo:true, repeatDelay:.55 }, 0);
  }
  function reveal() {
    if (!gsap || reduced.matches) return;
    entrance?.kill();
    const panels = [...root.querySelectorAll('.retro-panel')].filter(node => node.getBoundingClientRect().width > 0);
    entrance = gsap.timeline();
    entrance.fromTo('.capability-intro h1>span', { y:28, opacity:0 }, { y:0, opacity:1, duration:.8, stagger:.1, ease:'power3.out', clearProps:'transform,opacity' },0)
      .fromTo('.demo-caption,.retro-desktop,.showcase-note', { y:25, opacity:0 }, { y:0, opacity:1, duration:.75, stagger:.08, ease:'power3.out', clearProps:'transform,opacity' },.15)
      .fromTo(panels, { y:9, opacity:.1 }, { y:0, opacity:1, duration:.55, stagger:.035, clearProps:'transform,opacity' },.35)
      .fromTo('.graph-connections path,.chart-line', { strokeDasharray:1, strokeDashoffset:1 }, { strokeDashoffset:0, duration:1.3, ease:'power2.inOut', clearProps:'strokeDasharray,strokeDashoffset' },.7)
      .fromTo('.evidence-row i,.coverage-fill', { scaleX:0 }, { scaleX:1, duration:.9, stagger:.07, ease:'power3.out', clearProps:'transform' },.8);
  }
  function finishQuery(key) {
    const item = queries[key];
    $('#query-select').value = key;
    $('#result-number').textContent = item.number;
    $('#summary-label').textContent = item.label;
    $('#project-status').textContent = item.status;
    $('#project-summary').textContent = item.summary;
    $('#next-step').textContent = item.next;
    $('#system-log').textContent = `[11:24:14] ${item.log}`;
    $('#console-state').textContent = 'CONTEXT RESOLVED';
    $('#query-execute').disabled = false;
    $('#context-query').setAttribute('aria-busy','false');
    root.querySelectorAll('.pipeline-steps li').forEach(node => node.classList.remove('is-pending','is-running'));
    root.querySelectorAll('[data-query]').forEach(node => node.classList.toggle('is-selected',node.dataset.query === key));
  }
  function runQuery(key) {
    queryAnimation?.kill();
    if (!gsap || reduced.matches || paused) { finishQuery(key); return; }
    const steps = [...root.querySelectorAll('.pipeline-steps li')];
    $('#query-execute').disabled = true;
    $('#context-query').setAttribute('aria-busy','true');
    $('#console-state').textContent = 'TRACING CONTEXT';
    steps.forEach(node => node.classList.add('is-pending'));
    queryAnimation = gsap.timeline();
    steps.forEach((node,index) => {
      queryAnimation.call(() => {
        steps.forEach(step => step.classList.remove('is-running'));
        node.classList.remove('is-pending'); node.classList.add('is-running');
        $('#system-log').textContent = `[11:24:14] ${node.textContent.trim().slice(2).trim()}…`;
      },null,index*.32).fromTo(node, { x:4 }, { x:0, duration:.3, clearProps:'transform' },index*.32);
    });
    queryAnimation.fromTo('.coverage-fill', { scaleX:0 }, { scaleX:1,duration:1.2,ease:'power1.inOut',clearProps:'transform' },0)
      .call(() => finishQuery(key),null,1.28)
      .fromTo('.state-summary,.next-step-panel p', { opacity:.2,y:5 }, { opacity:1,y:0,duration:.4,clearProps:'transform,opacity' },1.28)
      .fromTo('.evidence-row i', { scaleX:.2 }, { scaleX:1,duration:.5,stagger:.06,clearProps:'transform' },1.28);
  }
  $('#context-query').addEventListener('submit',event => { event.preventDefault(); runQuery($('#query-select').value); });
  root.querySelectorAll('[data-query]').forEach(button => button.addEventListener('click',() => runQuery(button.dataset.query)));
  root.querySelectorAll('[data-resource]').forEach(button => button.addEventListener('click',() => {
    root.querySelectorAll('[data-resource]').forEach(node => { const selected = node === button; node.classList.toggle('is-selected',selected); node.setAttribute('aria-pressed',String(selected)); });
    const [name,description] = resources[button.dataset.resource];
    $('#resource-name').textContent=name; $('#resource-description').textContent=description;
    if (gsap && !reduced.matches && !paused) gsap.fromTo('.resource-detail', {opacity:.25,y:4},{opacity:1,y:0,duration:.3,clearProps:'transform,opacity'});
  }));
  root.querySelectorAll('[data-memory]').forEach(button => button.addEventListener('click',() => {
    root.querySelectorAll('[data-memory]').forEach(node => node.setAttribute('aria-selected',String(node===button)));
    $('#memory-items').setAttribute('aria-labelledby',button.id);
    $('#memory-items').replaceChildren(...memories[button.dataset.memory].map(([name,date]) => {
      const row=document.createElement('div'), label=document.createElement('span'), time=document.createElement('time');
      label.textContent=name; time.textContent=date; row.append(label,time); return row;
    }));
    if (gsap && !reduced.matches && !paused) gsap.fromTo('#memory-items>div',{opacity:0,x:5},{opacity:1,x:0,duration:.25,stagger:.06,clearProps:'transform,opacity'});
  }));
  root.querySelectorAll('.mobile-workspace-tabs [data-pane]').forEach(button => button.addEventListener('click',() => {
    desktop.dataset.pane=button.dataset.pane;
    root.querySelectorAll('.mobile-workspace-tabs button').forEach(node => node.setAttribute('aria-selected',String(node===button)));
  }));
  // Arrow-key navigation for both sets of tabs, without trapping normal Tab.
  root.querySelectorAll('[role=tablist]').forEach(list => list.addEventListener('keydown',event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    const buttons=[...list.querySelectorAll('[role=tab]')]; const index=buttons.indexOf(document.activeElement);
    if (index<0) return; event.preventDefault(); event.stopPropagation();
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
    buttons[next].focus(); buttons[next].click();
  }));
  $('#desktop-minimize').addEventListener('click',() => {
    const body=$('#desktop-body'); body.hidden=!body.hidden;
    $('#desktop-minimize').setAttribute('aria-expanded',String(!body.hidden));
    $('#desktop-minimize').setAttribute('aria-label',body.hidden?'Restore preview':'Minimize preview'); syncMotion();
  });
  $('#desktop-expand').addEventListener('click',() => {
    const expanded=$('.workspace-showcase').classList.toggle('is-expanded');
    $('#desktop-expand').setAttribute('aria-pressed',String(expanded));
    $('#desktop-expand').setAttribute('aria-label',expanded?'Restore preview size':'Expand preview');
  });
  $('#console-motion').addEventListener('click',() => {
    paused=!paused; $('#console-motion').setAttribute('aria-pressed',String(paused)); $('#console-motion').textContent=paused?'Resume motion':'Pause motion';
    if(paused){ entrance?.progress(1); queryAnimation?.progress(1); } syncMotion();
  });
  const observer=new IntersectionObserver(entries => { inView=entries[0].isIntersecting; syncMotion(); },{threshold:.05});
  observer.observe(desktop);
  document.addEventListener('visibilitychange',() => { if(document.hidden) queryAnimation?.progress(1); syncMotion(); });
  reduced.addEventListener('change',() => { if(reduced.matches){ entrance?.progress(1); queryAnimation?.progress(1); } syncMotion(); });
  createAmbient();
  window.aguConsole={
    enter(){ active=true; if(!paused) reveal(); syncMotion(); },
    leave(){ active=false; entrance?.progress(1); queryAnimation?.progress(1); syncMotion(); },
  };
})();
