import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import './style.css';
import {G,DT,makeBottle,step,difficulty,LEVELS,levelPasses} from './sim.js';

// ---------- UI, levels, rendering ----------
const $=id=>document.getElementById(id);
const ids=['h','d','f','v','a','s','tilt','drop','slope'];
const BASE={h:[10,40],d:[4,12],f:[0,100],v:[0,6],a:[40,140],s:[-6,6],tilt:[-60,60],drop:[0,150],slope:[-10,10]};
const fmt={h:x=>(+x).toFixed(1)+' cm',d:x=>(+x).toFixed(2)+' cm',f:x=>(+x).toFixed(1)+' %',v:x=>(+x).toFixed(2)+' m/s',a:x=>(+x).toFixed(1)+'°',s:x=>(+x).toFixed(2)+' rev/s',tilt:x=>(+x).toFixed(1)+'°',drop:x=>(+x).toFixed(1)+' cm',slope:x=>(+x>0?'+':'')+(+x).toFixed(1)+'°'};
const DEFAULTS={h:22,d:6.5,f:33,v:2.8,a:82,s:3.7,tilt:0,drop:20,slope:0};
const PRESETS={classic:{h:22,d:6.5},tall:{h:33,d:5.5},stubby:{h:13,d:8},jug:{h:30,d:11}};
const SURFACES=['table','trampoline','carpet','ice'];
let surface='table';
let bottle=null,running=false,slow=false,zoomed=false,acc=0,last=0,camX=0,camY=0,camVX=0,camVY=0,camHold=null,camInit=false,levelMix=1,viewH=1.2,confetti=null,confT=0,finale=null;
let best=0,progress={unlocked:1,done:[]};
try{best=+(localStorage.getItem('bfl-best')||0)||0;const pr=JSON.parse(localStorage.getItem('bfl-progress')||'null');if(pr&&pr.unlocked)progress=pr;}catch(e){}
let level=LEVELS[0];

function readParams(){return{h:+$('h').value/100,d:+$('d').value/100,fill:+$('f').value/100,v:+$('v').value,angle:+$('a').value,spin:+$('s').value,tilt:+$('tilt').value,drop:+$('drop').value/100,slope:+$('slope').value,surface};}
function refreshVals(){for(const id of ids)$(id+'V').textContent=fmt[id]($(id).value);}
function clearResult(){runId++;$('share').hidden=true;$('result').className='result';confetti=null;if(!running)$('hudS').textContent='ready';}
function viewFor(p,b){const vy0=p.v*Math.sin(p.angle*Math.PI/180),apex=Math.max(0,vy0*vy0/(2*G));return Math.max(.9,b.y+apex+b.h+.35);}
function placeIdle(){const p=readParams();bottle=makeBottle(p);camY=bottle.y;viewH=viewFor(p,bottle);camHold=null;}

for(const id of ids)$(id).addEventListener('input',()=>{snapAbs(id);refreshVals();cancelPress();if(!running){placeIdle();clearResult();}});
function snapAbs(id){const m=level.minAbs&&level.minAbs[id];if(!m)return;const el=$(id),v=+el.value;if(Math.abs(v)<m){el.value=(v<0||(v===0&&+(el.dataset.prev||1)<0))?-m:m;}el.dataset.prev=el.value;}
$('result').addEventListener('click',e=>{if(e.target.closest('.share'))return;clearResult();});
function setSurface(sf){if(level.surface&&!level.surface.includes(sf))return;surface=sf;for(const btn of $('surfaces').children)btn.classList.toggle('on',btn.dataset.s===sf);if(!running){placeIdle();clearResult();}}
$('surfaces').addEventListener('click',e=>{const sf=e.target.dataset.s;if(sf&&!e.target.disabled)setSurface(sf);});
$('presets').addEventListener('click',e=>{const p=PRESETS[e.target.dataset.p];if(!p||e.target.disabled)return;setVal('h',p.h);setVal('d',p.d);refreshVals();if(!running){placeIdle();clearResult();}});
function setVal(id,v){const el=$(id);el.value=Math.min(+el.max,Math.max(+el.min,v));}
$('reset').addEventListener('click',()=>{runId++;for(const id of ids)$(id).value=DEFAULTS[id];surface='table';applyLevel(level);running=false;placeIdle();clearResult();$('hudS').textContent='ready';});

// ± fine-tune buttons (hold to repeat)
function nudge(id,n){const el=$(id);if(el.disabled)return;const st=+el.step,dec=(el.step.split('.')[1]||'').length;let v=+el.value+n*st;v=Math.min(+el.max,Math.max(+el.min,v));el.value=v.toFixed(dec);el.dispatchEvent(new Event('input'));}
let nudgeTimer=null;function stopNudge(){clearTimeout(nudgeTimer);nudgeTimer=null;}
for(const btn of document.querySelectorAll('.nudge button')){
  const id=btn.dataset.id,n=+btn.dataset.n;
  btn.addEventListener('pointerdown',e=>{e.stopPropagation();e.preventDefault();nudge(id,n);let delay=350;const rep=()=>{nudge(id,n);delay=Math.max(40,delay*.8);nudgeTimer=setTimeout(rep,delay);};nudgeTimer=setTimeout(rep,delay);});
  for(const ev of['pointerup','pointercancel','pointerleave'])btn.addEventListener(ev,stopNudge);
  btn.addEventListener('contextmenu',e=>e.preventDefault());
}

// ---------- levels ----------
function levelRule(L){const bits=[];if(L.lock)bits.push(`bottle locked to ${L.lock.h} × ${L.lock.d} cm`);if(L.min)for(const k in L.min)bits.push(`${labelOf(k)} ≥ ${fmt[k](L.min[k])}`);if(L.max)for(const k in L.max)bits.push(`${labelOf(k)} ≤ ${fmt[k](L.max[k])}`);if(L.minAbs)for(const k in L.minAbs)bits.push(`${labelOf(k)} at least ${L.minAbs[k]}° either way`);if(L.surface)bits.push(`surface: ${L.surface.join(' or ')}`);if(L.minFlips)bits.push(`≥ ${L.minFlips} rotations`);if(L.cap)bits.push('must finish on the cap');return bits;}
function labelOf(k){return{h:'height',d:'diameter',f:'fill',v:'speed',a:'angle',s:'spin',tilt:'tilt',drop:'drop height',slope:'surface tilt'}[k];}
function renderLevels(){$('levelBox').hidden=!(progress.done.length>0||progress.unlocked>1);const box=$('levels');box.innerHTML='';for(const L of LEVELS){const b=document.createElement('button');b.className='lvl'+(L.n===level.n?' on':'')+(progress.done.includes(L.n)?' done':'')+(L.n>progress.unlocked?' locked':'');b.textContent=L.n;b.title=L.name;b.disabled=L.n>progress.unlocked;b.addEventListener('click',()=>{if(L.n<=progress.unlocked)selectLevel(L);});box.appendChild(b);}
  const rules=levelRule(level);$('ldesc').innerHTML=`<b>${level.n}. ${level.name}</b> — ${level.desc}`+(progress.done.includes(level.n)?' <span style="color:var(--gold)">✓ cleared</span>':'')+(rules.length?`<span class="lockline">Locked: ${rules.join(' · ')}</span>`:'');}
function applyLevel(L){
  for(const id of ids){const el=$(id),row=el.closest('.row');let[lo,hi]=BASE[id];if(L.min&&L.min[id]!=null)lo=L.min[id];if(L.max&&L.max[id]!=null)hi=L.max[id];el.min=lo;el.max=hi;
    const locked=!!(L.lock&&L.lock[id]!=null);el.disabled=locked;row.classList.toggle('locked',locked);for(const nb of row.querySelectorAll('.nudge button'))nb.disabled=locked;
    const lim=[];if(L.min&&L.min[id]!=null)lim.push('min '+fmt[id](L.min[id]));if(L.max&&L.max[id]!=null)lim.push('max '+fmt[id](L.max[id]));
    row.classList.toggle('limited',lim.length>0&&!locked);row.querySelector('label').dataset.limit=lim.join(', ');
    if(locked)el.value=L.lock[id];else el.value=Math.min(hi,Math.max(lo,+el.value));
    if(L.minAbs&&L.minAbs[id]){row.classList.add('limited');row.querySelector('label').dataset.limit='≥ '+L.minAbs[id]+'° either way';snapAbs(id);}}
  for(const btn of $('presets').children)btn.disabled=!!L.lock;
  for(const btn of $('surfaces').children)btn.disabled=!!(L.surface&&!L.surface.includes(btn.dataset.s));
  if(L.surface&&!L.surface.includes(surface))surface=L.surface[0];
  for(const btn of $('surfaces').children)btn.classList.toggle('on',btn.dataset.s===surface);
  refreshVals();renderLevels();
}
function selectLevel(L){level=L;applyLevel(L);if(!running){placeIdle();clearResult();}}
function saveProgress(){try{localStorage.setItem('bfl-progress',JSON.stringify(progress));}catch(e){}}

// ---------- stage / canvas ----------
const cv=$('c'),ctx=cv.getContext('2d');
function resize(){const r=cv.getBoundingClientRect(),dpr=window.devicePixelRatio||1;cv.width=Math.round(r.width*dpr);cv.height=Math.round(r.height*dpr);}
window.addEventListener('resize',resize);resize();if(window.ResizeObserver)new ResizeObserver(resize).observe(cv);
$('flip').addEventListener('click',launch);
document.addEventListener('keydown',e=>{if(e.code==='Space'&&e.target.tagName!=='INPUT'){e.preventDefault();launch();}if(e.key==='Escape')showAbout(false);});
$('slow').addEventListener('click',()=>{slow=!slow;$('slow').setAttribute('aria-checked',slow);});
$('zoom').addEventListener('click',()=>{zoomed=!zoomed;$('zoom').setAttribute('aria-checked',zoomed);});
function showAbout(on){$('aboutBox').hidden=!on;$('about').setAttribute('aria-expanded',on);}
$('about').addEventListener('click',()=>showAbout($('aboutBox').hidden));
$('aboutBox').addEventListener('click',e=>{if(e.target.closest('.codebox'))return;showAbout(false);});

function launch(){
  showAbout(false);runId++;const p=readParams();bottle=makeBottle(p);bottle.params=p;bottle.level=level;
  viewH=viewFor(p,bottle);
  running=true;acc=0;confetti=null;finale=null;camHold=null;$('result').className='result';$('share').hidden=true;$('hudS').textContent='flying';
}
function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}

function finish(){
  running=false;bottle.endT=bottle.t;const b=bottle,o=b.outcome,p=b.params,L=b.level;
  const flips=Math.abs(b.airAng)/(2*Math.PI);
  const ok=o!=='flop';const passed=ok&&levelPasses(L,b,p);const diff=difficulty(p,o);
  const levelF=1+.3*(L.n-1);const diffRel=diff.total/DEF_DIFF*levelF;
  const firstClear=passed&&!progress.done.includes(L.n);
  const vd=$('verdict');vd.textContent=!ok?'Flop':!passed?'Landed':L.n===10&&firstClear?'Ladder complete':o==='cap'?'Cap landing':'Landed';
  vd.className='verdict'+(!ok?' flop':!passed?' flop':L.n===10&&firstClear?' gold':o==='cap'?' cap':'');
  $('hudS').textContent=!ok?'try again':passed?'cleared':'landed';
  const need=!ok?'':!passed?(L.cap?' — but this level needs a cap landing':L.minFlips?` — but this level needs ${L.minFlips}+ rotations`:L.minAbs?' — but this level needs the surface tilted at least 5°':''):'';
  $('rTitle').textContent=(o==='upright'?`Landed upright after ${flips.toFixed(1)} flips`:o==='cap'?`Balanced on the cap after ${flips.toFixed(1)} flips`:`Fell over after ${flips.toFixed(1)} flips`)+need;
  const chip=(l,f)=>`<span>${l} <b>×${f.toFixed(2)}</b></span>`;
  const diffChips=chip('level '+L.n,levelF)+chip('spin',diff.spinF)+chip('shape',diff.aspF)+chip('fill',diff.fillF)+chip('height',diff.dropF)+chip('speed',diff.speedF)+chip('surface',diff.surfF)+(diff.slopeF>1?chip('slope',diff.slopeF):'')+(o==='cap'?chip('on the cap',diff.capF):'');
  $('rChips').innerHTML=diffChips;
  $('rBest').textContent=best?`Your best so far: ${best} pts`:'';
  $('result').className='result show';$('share').hidden=true;$('shareNote').textContent='';
  if(passed){if(firstClear){progress.done.push(L.n);if(L.n<10)progress.unlocked=Math.max(progress.unlocked,L.n+1);saveProgress();renderLevels();
      if(L.n===10){finale={t:0,rnd:mulberry(1010),bursts:[],sparks:[]};$('rTitle').textContent+=' — all ten levels cleared!';}
      else $('rTitle').textContent+=L.n===1?' — the ladder is open: level 2 unlocked':` — level ${L.n+1} unlocked`;}
    const rnd=mulberry(42+L.n);confetti=[];const cols=['#2b8fe6','#0f766e','#e2b652','#7c3aed','#c2410c'];
    for(let i=0;i<70;i++)confetti.push({x:.5+(rnd()-.5)*.3,y:.35,vx:(rnd()-.5)*1.6,vy:-rnd()*1.4-.3,c:cols[i%5],r:rnd()*6.28,w:rnd()*.6+.4});confT=0;}
  if(!ok){$('rScore').textContent='0 pts';$('rStars').textContent='☆☆☆☆☆';lastScore=0;$('share').hidden=false;if(challenge!==null)$('rTitle').textContent+=challenge>0?` — the ${challenge} pt challenge stands`:'';return;}
  $('rScore').textContent='…';$('rStars').textContent='measuring tolerance';
  const myRun=++runId;
  measureTolerance(p).then(tol=>{
    if(myRun!==runId)return;
    const pr=DEF_TAU/tol.tau,precision=pr*Math.sqrt(pr);
    const score=Math.max(10,Math.round(100*diffRel*precision));
    $('rScore').textContent=score+' pts';
    const stars=score<150?1:score<400?2:score<1000?3:score<3000?4:5;
    $('rStars').textContent='★'.repeat(stars)+'☆'.repeat(5-stars);
    const pct=(tol.tau*100).toFixed(1);
    $('rChips').innerHTML=`<span>tolerance ${tol.tau>=.4?'wide':'±'+pct+'% of range on '+tol.worst} <b>×${precision.toFixed(1)}</b></span>`+diffChips;
    if(score>best){best=score;try{localStorage.setItem('bfl-best',best);}catch(e){}}
    $('rBest').textContent=`Your best so far: ${best} pts`;
    lastScore=score;$('share').hidden=false;
    if(challenge!==null&&challenge>0){$('rTitle').textContent+=score>challenge?` — you beat the ${challenge} pt challenge!`:score===challenge?` — you matched the ${challenge} pt challenge`:` — short of the ${challenge} pt challenge`;}
  });
}

// After the verdict the bottle keeps moving until it comes to rest. The outcome is already decided and stays as it is.
// A flop keeps the full physics (it rolls and settles). A landing only slides along the surface, upright,
// and friction slows it down: the full physics could still tip a bottle that the verdict counted as balanced.
function coast(b){b.coastT=(b.coastT||0)+DT;
  if(b.outcome==='flop'){b.done=false;step(b);b.done=true;b.outcome='flop';}
  else{const tx=b.fny,ty=-b.fnx,dv=b.mu*G*DT;let vt=b.vx*tx+b.vy*ty;vt=Math.abs(vt)<=dv?0:vt-Math.sign(vt)*dv;
    b.vx=vt*tx;b.vy=vt*ty;b.w=0;b.x+=b.vx*DT;b.y+=b.vy*DT;b.t+=DT;}
  if(b.coastT>8||(Math.hypot(b.vx,b.vy)<.005&&Math.abs(b.w)<.02))b.rested=true;}
function frame(ts){
  requestAnimationFrame(frame);
  const dtReal=Math.min(.05,(ts-last)/1000||0);last=ts;
  if(running){acc+=dtReal*(slow?.2:1);let steps=0;while(acc>=DT&&steps<40){step(bottle);acc-=DT;steps++;if(bottle.done){finish();acc=0;break;}}if(running&&bottle.touched)$('hudS').textContent='settling';}
  else if(bottle&&bottle.done&&!bottle.rested){acc+=dtReal*(slow?.2:1);let steps=0;while(acc>=DT&&steps<40){coast(bottle);acc-=DT;steps++;}}
  if(confetti){confT+=dtReal;for(const q of confetti){q.vy+=2.2*dtReal;q.x+=q.vx*dtReal;q.y+=q.vy*dtReal;q.r+=3*dtReal;}if(confT>3)confetti=null;}
  draw(dtReal);
}
requestAnimationFrame(frame);

// ---------- fluid rendering (metaball threshold of the particle field) ----------
const off=document.createElement('canvas'),octx=off.getContext('2d',{willReadFrequently:true});
function renderFluid(b,ppm){
  const n=b.parts.length;if(!n)return null;
  const w=Math.max(4,Math.min(256,Math.round(2*b.R*ppm))),hh=Math.max(4,Math.min(640,Math.round(b.h*ppm)));
  if(off.width!==w||off.height!==hh){off.width=w;off.height=hh;}
  const sx=w/(2*b.R),sy=hh/b.h;
  octx.clearRect(0,0,w,hh);octx.globalCompositeOperation='lighter';
  const rr=b.s*1.25*sx;
  for(const q of b.parts){const px=(q.lx+b.R)*sx,py=hh-(q.ly+b.cy)*sy;
    const g=octx.createRadialGradient(px,py,0,px,py,rr);g.addColorStop(0,'rgba(255,255,255,.95)');g.addColorStop(.55,'rgba(255,255,255,.5)');g.addColorStop(1,'rgba(255,255,255,0)');
    octx.fillStyle=g;octx.beginPath();octx.arc(px,py,rr,0,6.283);octx.fill();}
  octx.globalCompositeOperation='source-over';
  const img=octx.getImageData(0,0,w,hh),d=img.data;
  for(let i=0;i<d.length;i+=4){const a=d[i+3];
    if(a<105){d[i+3]=0;}
    else if(a<150){d[i]=150;d[i+1]=210;d[i+2]=250;d[i+3]=225;}
    else{d[i]=33;d[i+1]=133;d[i+2]=222;d[i+3]=215;}}
  octx.putImageData(img,0,0);return off;
}

function draw(dt){
  const b=bottle,W=cv.width,H=cv.height,dpr=window.devicePixelRatio||1;
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,W,H);
  // camera planning: start the bottle off-centre, let it cross the frame, pan only as it nears the far edge, centre once it lands
  const marginPx=46*dpr;let scale,ox,oy;
  scale=zoomed?.42*H/b.h:(H-marginPx-14*dpr)/viewH;
  const vw=W/scale;
  const pp=b.params||readParams(),vx0=pp.v*Math.cos(pp.angle*Math.PI/180),dir=Math.abs(vx0)<.05?0:Math.sign(vx0);
  let target;
  if(zoomed){target=b.x;}
  else if(!running||b.touched||dir===0){target=b.x;}
  else{const startFrac=dir>0?.24:.76,edgeFrac=dir>0?.74:.26;
    if(camHold===null)camHold=b.x-(startFrac-.5)*vw;
    const lead=b.vx*.12,follow=b.x+lead-(edgeFrac-.5)*vw;
    target=dir>0?Math.max(camHold,follow):Math.min(camHold,follow);}
  if(!running&&!b.touched&&dir!==0&&!zoomed){target=b.x-((dir>0?.24:.76)-.5)*vw;camHold=null;}
  // critically damped spring with bounded acceleration: smooth starts and stops, never a jerk
  if(zoomed){camX=b.x;camY=b.y;camVX=0;camVY=0;} // close-up: lock dead centre on the bottle, no lag
  else{const k=30,c=2*Math.sqrt(k),amax=3*vw;let ax=k*(target-camX)-c*camVX;ax=Math.max(-amax,Math.min(amax,ax));camVX+=ax*dt;camX+=camVX*dt;camY=b.y;camVY=0;}
  if(!camInit||!isFinite(camX)){camX=target;camVX=0;camInit=true;}
  ox=W/2-camX*scale;oy=zoomed?H*.55+camY*scale:H-marginPx;
  // backdrop grid (lab wall)
  ctx.strokeStyle='rgba(90,70,40,.07)';ctx.lineWidth=1*dpr;const gs=.1*scale;
  if(gs>8*dpr){ctx.beginPath();for(let x=ox%gs;x<W;x+=gs){ctx.moveTo(x,0);ctx.lineTo(x,Math.min(H,oy));}for(let y=oy;y>0;y-=gs){ctx.moveTo(0,y);ctx.lineTo(W,y);}ctx.stroke();}
  // surface
  drawSurface(b,W,H,dpr,scale,ox,oy);
  // contact shadow (projected onto the possibly tilted surface)
  {const dn=b.x*b.fnx+b.y*b.fny+minVertexY(b);const sh=Math.max(0,1-dn*2.2);if(sh>0){const tcoord=b.x*b.fny-b.y*b.fnx;ctx.save();ctx.translate(ox,oy);ctx.rotate(-b.phi);ctx.translate(tcoord*scale,0);ctx.scale(1,.28);ctx.fillStyle=`rgba(60,40,10,${.22*sh})`;ctx.beginPath();ctx.arc(0,0,b.h*.6*scale*(1-sh*.3),0,6.283);ctx.fill();ctx.restore();}}
  // bottle
  ctx.save();ctx.translate(ox,oy);ctx.scale(scale,-scale);
  ctx.translate(b.x,b.y);ctx.rotate(b.th);ctx.translate(0,-b.cy);
  const lw=1.6*dpr/scale,R=b.R,h=b.h,Rc=b.Rc,hc=b.hc,hs=b.hs,Rn=b.Rn;
  function bottlePath(){ctx.beginPath();ctx.moveTo(-R+.006,0);ctx.lineTo(R-.006,0);ctx.quadraticCurveTo(R,0,R,.006);ctx.lineTo(R,hs);
    ctx.quadraticCurveTo(R,hs+(h-hs)*.4,Rn,h);ctx.lineTo(-Rn,h);ctx.quadraticCurveTo(-R,hs+(h-hs)*.4,-R,hs);ctx.lineTo(-R,.006);ctx.quadraticCurveTo(-R,0,-R+.006,0);ctx.closePath();}
  // body: translucent plastic
  const gb=ctx.createLinearGradient(-R,0,R,0);gb.addColorStop(0,'rgba(255,255,255,.55)');gb.addColorStop(.35,'rgba(255,255,255,.25)');gb.addColorStop(.6,'rgba(220,230,240,.35)');gb.addColorStop(1,'rgba(180,195,215,.45)');
  bottlePath();ctx.fillStyle=gb;ctx.fill();
  // water: sloshing particle field in flight, blending into a hydrostatic level pool as it comes to rest
  // calm means the water moves with the bottle; the bottle itself may still slide
  {const idle=!running&&!b.touched,calm=idle||b.done||(b.touched&&b.stable&&(b.rel||0)<.15&&Math.abs(b.w)<1);
   levelMix+=((calm?1:0)-levelMix)*Math.min(1,dt*(calm?3:8));if(idle)levelMix=1;
   if(levelMix<.995){const fl=renderFluid(b,scale);if(fl){ctx.save();ctx.globalAlpha=1-levelMix;bottlePath();ctx.clip();ctx.scale(1,-1);ctx.drawImage(fl,-R,-h,2*R,h);ctx.restore();}}
   if(levelMix>.005&&b.parts.length){ctx.save();ctx.globalAlpha=levelMix;bottlePath();ctx.clip();drawLevelPool(b,ox,oy,scale,lw);ctx.restore();}}
  // shell outline + highlights
  bottlePath();ctx.lineWidth=lw;ctx.strokeStyle='rgba(30,41,59,.8)';ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,.75)';ctx.beginPath();ctx.roundRect(-R*.78,h*.06,R*.14,h*.66,R*.07);ctx.fill();
  ctx.fillStyle='rgba(255,255,255,.4)';ctx.beginPath();ctx.roundRect(R*.55,h*.1,R*.1,h*.55,R*.05);ctx.fill();
  // cap
  ctx.fillStyle='#1c1a17';ctx.beginPath();ctx.roundRect(-Rc,h,2*Rc,hc,.002);ctx.fill();ctx.lineWidth=lw;ctx.strokeStyle='rgba(30,41,59,.8)';ctx.stroke();
  ctx.fillStyle='#e2b652';ctx.fillRect(-Rc,h,2*Rc,hc*.22);
  ctx.fillStyle='rgba(255,255,255,.18)';for(let i=0;i<4;i++)ctx.fillRect(-Rc+Rc*.3+i*Rc*.4,h+hc*.35,Rc*.1,hc*.55);
  ctx.restore();
  // keep the result card off the bottle: top band if the bottle sits below it, otherwise the side the bottle is not on
  {const res=$('result');if(res.classList.contains('show')){const c=Math.cos(b.th),si=Math.sin(b.th);let top=-1e9;for(const[vx,vy]of b.verts){const ry=si*vx+c*vy;if(ry>top)top=ry;}
    const bottleTopPx=(oy-(b.y+top)*scale)/dpr,bottleXFrac=(ox+b.x*scale)/W,cardBottom=42+res.offsetHeight+8;
    const clash=bottleTopPx<cardBottom;res.classList.toggle('side-right',clash&&bottleXFrac<.5);res.classList.toggle('side-left',clash&&bottleXFrac>=.5);}}
  // HUD
  $('hudT').textContent=(b.endT??b.t).toFixed(2)+' s'; // stops at the verdict; the bottle may still slide after it
  $('hudF').textContent=(Math.abs(running?b.flipAng:(b.touched?b.airAng:b.flipAng))/(2*Math.PI)).toFixed(1)+' flips';
  if(confetti){for(const q of confetti){ctx.save();ctx.translate(q.x*W,q.y*H);ctx.rotate(q.r);ctx.fillStyle=q.c;ctx.fillRect(-4*dpr,-2.5*dpr*q.w,8*dpr,5*dpr*q.w);ctx.restore();}}
  if(finale)drawFinale(dt,W,H,dpr);
}
// Slosh of the settled water: the surface tilts towards the effective gravity (gravity minus the bottle's acceleration)
// and swings about it as a damped oscillator at the first slosh mode of a cylinder. Drawing only; the physics never reads it.
function updateSlosh(b){
  const s=b.slosh||(b.slosh={a:0,w:0,vx:b.vx,vy:b.vy,t:b.t,ax:0,ay:0});
  const dt=b.t-s.t;if(dt<=0)return s;
  const lim=3*G,ax=Math.max(-lim,Math.min(lim,(b.vx-s.vx)/dt)),ay=Math.max(-lim,Math.min(lim,(b.vy-s.vy)/dt));
  s.vx=b.vx;s.vy=b.vy;s.t=b.t;
  if(!b.touched){s.a=0;s.w=0;s.ax=0;s.ay=0;return s;} // in free fall the water has no down
  // smooth the acceleration over 0.15 s so that small contact jitter on the surface does not keep the water rocking
  const k=Math.min(1,dt/.15);s.ax+=(ax-s.ax)*k;s.ay+=(ay-s.ay)*k;
  const target=Math.max(-.6,Math.min(.6,Math.atan2(s.ax,G+s.ay)));
  const D=2*b.Ri,hw=Math.max(.005,(b.params?b.params.fill:.33)*b.h),om=Math.sqrt(Math.PI*G/D*Math.tanh(Math.PI*hw/D)),z=.06;
  const n=Math.ceil(dt*om*8),hs=dt/n;
  for(let i=0;i<n;i++){s.w+=(-om*om*(s.a-target)-2*z*om*s.w)*hs;s.a+=s.w*hs;}
  s.a=Math.max(-.7,Math.min(.7,s.a));
  return s;
}
function drawLevelPool(b,ox,oy,scale,lw){
  const c=Math.cos(b.th),si=Math.sin(b.th);
  const loc=[[-b.Ri,-b.cy],[b.Ri,-b.cy],[b.Ri,b.hs-b.cy],[b.Rn,b.h-b.cy],[-b.Rn,b.h-b.cy],[-b.Ri,b.hs-b.cy]];
  // work in a frame centred on the bottle and turned so that the sloshing surface is level
  const al=updateSlosh(b).a,ca=Math.cos(al),sa=Math.sin(al);
  const poly=loc.map(([lx,ly])=>{const x=c*lx-si*ly,y=si*lx+c*ly;return[ca*x-sa*y,sa*x+ca*y];});
  const area=P=>{let a=0;for(let i=0;i<P.length;i++){const[x1,y1]=P[i],[x2,y2]=P[(i+1)%P.length];a+=x1*y2-x2*y1;}return Math.abs(a)/2;};
  const clipBelow=(P,yl)=>{const out=[];for(let i=0;i<P.length;i++){const A=P[i],B=P[(i+1)%P.length];const ina=A[1]<=yl,inb=B[1]<=yl;
    if(ina)out.push(A);if(ina!==inb){const t=(yl-A[1])/(B[1]-A[1]);out.push([A[0]+t*(B[0]-A[0]),yl]);}}return out;};
  const target=b.params?b.params.fill*2*b.Ri*b.h:(b.parts.length*b.s*b.s);
  let lo=Math.min(...poly.map(p=>p[1])),hi=Math.max(...poly.map(p=>p[1]));
  for(let i=0;i<22;i++){const mid=(lo+hi)/2;if(area(clipBelow(poly,mid))<target)lo=mid;else hi=mid;}
  const yl=(lo+hi)/2,pool=clipBelow(poly,yl);if(pool.length<3)return;
  ctx.setTransform(1,0,0,1,0,0);ctx.translate(ox,oy);ctx.scale(scale,-scale);ctx.translate(b.x,b.y);ctx.rotate(-al);
  const g=ctx.createLinearGradient(0,yl,0,Math.min(...pool.map(p=>p[1])));g.addColorStop(0,'rgba(33,133,222,.78)');g.addColorStop(1,'rgba(20,100,190,.9)');
  ctx.beginPath();pool.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fillStyle=g;ctx.fill();
  // meniscus line
  ctx.strokeStyle='rgba(190,225,255,.9)';ctx.lineWidth=lw*1.2;ctx.beginPath();let first=true;for(const[x,y]of pool){if(Math.abs(y-yl)<1e-6){first?ctx.moveTo(x,y):ctx.lineTo(x,y);first=false;}}ctx.stroke();
}
function minVertexY(b){const c=Math.cos(b.th),si=Math.sin(b.th);let m=1e9;for(const[vx,vy]of b.verts){const ry=si*vx+c*vy;if(ry<m)m=ry;}return m;}
function drawSurface(b,W,H,dpr,scale,ox,oy){
  if(oy>H+200)return;
  // draw in the surface's own frame: origin at the world origin on the surface, x along the slope, y into the ground
  ctx.save();ctx.translate(ox,oy);ctx.rotate(-b.phi);
  // cover the visible screen, wherever the camera is: after a long throw in zoom the world origin is far off screen
  const bx=(b.x*b.fny-b.y*b.fnx)*scale;const Wc=W,X0=-ox-2*Wc,X1=-ox+3*Wc;oy=0;W=X1-X0;
  const span_=(st,f)=>{for(let i=Math.floor(X0/st);i<=Math.ceil(X1/st);i++)f(i);};
  const fillBand=(y0,h2,style)=>{ctx.fillStyle=style;ctx.fillRect(X0,y0,W,h2);};
  if(surface==='trampoline'){
    const sag=-Math.max(0,Math.min(.08,-(b.x*b.fnx+b.y*b.fny+minVertexY(b))))*scale;const span=Wc/4;
    fillBand(12*dpr,H*3,'#cfc4ad');
    ctx.fillStyle='#6b645a';span_(Wc/5,i=>ctx.fillRect(i*(Wc/5)-4*dpr,8*dpr,8*dpr,H*3));
    ctx.strokeStyle='#8a8276';ctx.lineWidth=1.5*dpr;
    span_(Wc/14,i=>{const x=(i+.5)*(Wc/14),s2=Math.max(0,1-Math.abs(x-bx)/span),dy=-sag*s2;
      ctx.beginPath();ctx.moveTo(x,10*dpr);for(let k=1;k<=5;k++)ctx.lineTo(x+(k%2?5:-5)*dpr,10*dpr-dy*(1-k/5)-(k/5)*8*dpr);ctx.stroke();});
    const prof=x=>-sag*Math.sin(Math.max(0,1-Math.abs(x-bx)/span)*Math.PI/2);
    ctx.beginPath();ctx.moveTo(X0,0);for(let x=X0;x<=X1;x+=8*dpr)ctx.lineTo(x,prof(x));ctx.lineTo(X1,6*dpr);ctx.lineTo(X0,6*dpr);ctx.closePath();ctx.fillStyle='#1c1a17';ctx.fill();
    ctx.strokeStyle='#0f766e';ctx.lineWidth=2.5*dpr;ctx.beginPath();let f0=true;for(let x=X0;x<=X1;x+=8*dpr){const y=prof(x);f0?ctx.moveTo(x,y):ctx.lineTo(x,y);f0=false;}ctx.stroke();
    ctx.restore();return;}
  const look={table:['#8a6a4a','#c49a6c','#e2c39b'],carpet:['#6b3f5a','#a0607f','#c08aa5'],ice:['#9ad8f0','#dff6ff','#ffffff']}[surface]||['#8a6a4a','#c49a6c','#e2c39b'];
  const g=ctx.createLinearGradient(0,0,0,120*dpr);g.addColorStop(0,look[1]);g.addColorStop(1,look[0]);
  fillBand(0,H*3,g);
  fillBand(0,3*dpr,look[2]);
  if(surface==='table'){ctx.strokeStyle='rgba(0,0,0,.18)';ctx.lineWidth=1*dpr;ctx.beginPath();for(let i=1;i<6;i++){ctx.moveTo(X0,i*7*dpr+3*dpr);ctx.lineTo(X1,i*7*dpr+3*dpr);}ctx.stroke();}
  else if(surface==='carpet'){ctx.fillStyle='rgba(255,255,255,.08)';for(let x=X0;x<X1;x+=7*dpr)ctx.fillRect(x,6*dpr+(Math.abs(Math.round(x/(7*dpr)))%2)*5*dpr,3*dpr,3*dpr);}
  else if(surface==='ice'){ctx.fillStyle='rgba(255,255,255,.45)';span_(Wc/7,i=>ctx.fillRect(i*(Wc/7),(8+(((i%5)+5)%5)*6)*dpr,Wc/14,1.5*dpr));}
  // reflection of the bottle on hard surfaces (mirrored across the surface plane)
  if(surface!=='carpet'){const dn=b.x*b.fnx+b.y*b.fny;ctx.save();ctx.globalAlpha=surface==='ice'?.22:.08;ctx.scale(scale,scale);ctx.translate(bx/scale,dn);ctx.rotate(-(b.th-b.phi));ctx.translate(0,-b.cy);
    ctx.fillStyle='#38bdf8';ctx.beginPath();ctx.rect(-b.R,0,2*b.R,b.h);ctx.fill();ctx.restore();}
  ctx.restore();
}
// ---------- finale: fireworks over the lab ----------
function drawFinale(dt,W,H,dpr){
  const F=finale;F.t+=dt;const rnd=F.rnd;
  const schedule=[.1,.5,.8,1.3,1.6,2.0,2.4,2.9,3.3,3.8];
  while(F.bursts.length<schedule.length&&F.t>=schedule[F.bursts.length]){
    const hue=[190,140,40,270,0,60][F.bursts.length%6],cx=(.15+rnd()*.7)*W,cy=(.15+rnd()*.35)*H;F.bursts.push(1);
    for(let i=0;i<90;i++){const a=rnd()*6.283,sp=(.25+rnd()*.55)*H;F.sparks.push({x:cx,y:cy,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:1,hue:hue+rnd()*30,r:(1.2+rnd()*1.6)*dpr});}}
  ctx.save();ctx.globalCompositeOperation='lighter';
  for(const s of F.sparks){s.vy+=.35*H*dt;s.x+=s.vx*dt;s.y+=s.vy*dt;s.vx*=1-1.4*dt;s.vy*=1-1.4*dt;s.life-=dt*.55;if(s.life<=0)continue;
    ctx.fillStyle=`hsla(${s.hue},95%,${55+s.life*25}%,${Math.min(1,s.life*1.4)})`;ctx.beginPath();ctx.arc(s.x,s.y,s.r*(0.6+s.life),0,6.283);ctx.fill();}
  ctx.restore();F.sparks=F.sparks.filter(s=>s.life>0);
  if(F.t>8&&!F.sparks.length)finale=null;
}

// ---------- long-press "solve" ----------
function simOutcome(p){const b=makeBottle(p);while(!b.done)step(b);return b;}
function passes(b,p){return b.outcome!=='flop'&&levelPasses(level,b,p);}
const tick=()=>new Promise(r=>setTimeout(r,0));
let solving=false;
function paramsWith(id,val){const vals={};for(const i of ids)vals[i]=+$(i).value;vals[id]=val;
  return{h:vals.h/100,d:vals.d/100,fill:vals.f/100,v:vals.v,angle:vals.a,spin:vals.s,tilt:vals.tilt,drop:vals.drop/100,slope:vals.slope,surface};}
async function solveSlider(id){
  if(solving||running)return;const el=$(id);if(el.disabled)return;solving=true;
  const row=el.closest('.row'),min=+el.min,max=+el.max,st=+el.step,cur=+el.value;
  row.classList.add('solving');const valEl=$(id+'V');const dec=(st+'').split('.')[1]?.length||0;
  const snap=x=>+(Math.round((x-min)/st)*st+min).toFixed(dec);
  const ok=v=>{const p=paramsWith(id,v);return passes(simOutcome(p),p);};
  let found=null;
  try{
    if(ok(cur)){found=cur;}
    else{
      const cs=Math.max(st,(max-min)/24);let k=1,dirHit=0,kHit=0;
      while(cur+k*cs<=max+1e-9||cur-k*cs>=min-1e-9){
        for(const dir of[1,-1]){const v=snap(cur+dir*k*cs);if(v<min||v>max)continue;
          valEl.textContent='solving '+fmt[id](v)+'…';await tick();
          if(ok(v)){dirHit=dir;kHit=k;break;}}
        if(dirHit)break;k++;
      }
      if(dirHit){let hit=snap(cur+dirHit*kHit*cs),miss=cur+dirHit*(kHit-1)*cs;found=hit;
        while(Math.abs(hit-miss)>st*1.5){const mid=snap((hit+miss)/2);if(mid===hit||mid===miss)break;
          valEl.textContent='solving '+fmt[id](mid)+'…';await tick();if(ok(mid)){hit=mid;found=mid;}else miss=mid;}}
    }
  }finally{
    row.classList.remove('solving');
    if(found===null){row.classList.add('impossible');valEl.textContent='impossible';setTimeout(()=>{row.classList.remove('impossible');refreshVals();},1800);}
    else{el.value=found;refreshVals();placeIdle();clearResult();}
    solving=false;
  }
}
async function solveSurface(){
  if(solving||running)return;solving=true;const box=$('surfaces');box.classList.add('solving');
  let found=null;const allowed=level.surface||SURFACES;
  try{for(const sf of[surface,...allowed]){if(!allowed.includes(sf))continue;await tick();
      const p=readParams();p.surface=sf;if(passes(simOutcome(p),p)){found=sf;break;}}}
  finally{box.classList.remove('solving');
    if(found)setSurface(found);else{const l=$('surfLabel');l.textContent='impossible';setTimeout(()=>l.textContent='Surface',1800);}
    solving=false;}
}
let pressTimer=null,pressX=0,pressY=0;
function cancelPress(){if(pressTimer){clearTimeout(pressTimer);pressTimer=null;}}
function armPress(target,fire){
  target.addEventListener('contextmenu',e=>e.preventDefault());
  target.addEventListener('pointerdown',e=>{cancelPress();if(level.n>1)return; // the lab only helps on level 1
    pressX=e.clientX;pressY=e.clientY;
    pressTimer=setTimeout(()=>{pressTimer=null;if(navigator.vibrate)navigator.vibrate(20);fire();},550);});
  target.addEventListener('pointermove',e=>{if(Math.hypot(e.clientX-pressX,e.clientY-pressY)>10)cancelPress();});
  for(const ev of['pointerup','pointercancel','pointerleave'])target.addEventListener(ev,cancelPress);
}
for(const id of ids)armPress($(id).closest('.row'),()=>solveSlider(id));
armPress($('surfaces').parentElement,solveSurface);

// ---------- tolerance scoring ----------
const RANGES={h:[.10,.40,'height'],d:[.04,.12,'diameter'],fill:[0,1,'fill'],v:[0,6,'speed'],angle:[40,140,'angle'],spin:[-6,6,'spin'],tilt:[-60,60,'tilt'],drop:[0,1.5,'drop height'],slope:[-10,10,'surface tilt']};
const LADDER=[.005,.015,.04,.1,.25];
const DEF_PARAMS={h:.22,d:.065,fill:.33,v:2.8,angle:82,spin:3.4,tilt:0,drop:.2,slope:0,surface:'table'};
const DEF_DIFF=difficulty(DEF_PARAMS,'upright').total;
const DEF_TAU=.04;
let runId=0;
async function measureTolerance(p){
  let tau=.4,worst='';
  for(const k in RANGES){const[lo,hi,name]=RANGES[k],span=hi-lo;
    for(const dir of[1,-1])for(const f of LADDER){if(f>=tau)break;const v=p[k]+dir*f*span;if(v<lo||v>hi)break;
      await tick();if(simOutcome({...p,[k]:v}).outcome==='flop'){if(f<tau){tau=f;worst=name;}break;}}}
  return{tau,worst};
}

// ---------- share links ----------
const SURF_CODE={table:'t',trampoline:'r',carpet:'c',ice:'i'},CODE_SURF={t:'table',r:'trampoline',c:'carpet',i:'ice'};
let lastScore=null,challenge=null;
const SHARE_URL=location.origin+location.pathname;
// compact code: every setting packed at slider resolution into 107 bits, base64url (18 chars), prefixed with a version letter
const B64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const FIELDS=[['h',10,0.1,9],['d',4,0.05,8],['f',0,0.5,8],['v',0,0.01,10],['a',40,0.5,8],['s',-6,0.01,11],['tilt',-60,0.5,8],['drop',0,0.5,9],['slope',-10,0.5,6]]; // [id, min, step, bits]
function packCode(score){let bits=0n,n=0;const put=(val,w)=>{bits=(bits<<BigInt(w))|BigInt(val);n+=w;};
  for(const[id,min,st,w]of FIELDS)put(Math.max(0,Math.min((1<<w)-1,Math.round((+$(id).value-min)/st))),w);
  put(SURFACES.indexOf(surface)>=0?SURFACES.indexOf(surface):0,2);put(level.n,4);put(Math.min(16777215,Math.max(0,score|0)),24);
  let out='';const total=Math.ceil(n/6)*6;bits<<=BigInt(total-n);for(let i=total-6;i>=0;i-=6)out+=B64[Number((bits>>BigInt(i))&63n)];
  return 'F'+out;}
function unpackCode(str){if(!/^F[A-Za-z0-9_-]{18}$/.test(str))return null;let bits=0n;for(const ch of str.slice(1)){const v=B64.indexOf(ch);if(v<0)return null;bits=(bits<<6n)|BigInt(v);}
  const n=FIELDS.reduce((a,f)=>a+f[3],0)+30,total=18*6;bits>>=BigInt(total-n);
  const take=w=>{const v=Number(bits&((1n<<BigInt(w))-1n));bits>>=BigInt(w);return v;};
  const score=take(24),lvl=take(4),sf=take(2);const vals={};for(let i=FIELDS.length-1;i>=0;i--){const[id,min,st]=FIELDS[i];const dec=(st+'').split('.')[1]?.length||0;vals[id]=+(min+take(FIELDS[i][3])*st).toFixed(dec);}
  return{vals,surface:SURFACES[sf]||'table',score,level:Math.min(10,Math.max(1,lvl||1))};}
function makeHash(score){return '#'+packCode(score);}
function parseHash(str){const h=(str!==undefined?str:location.hash).replace(/^.*#/,'').trim();if(!h)return null;
  if(h[0]==='F'&&h.indexOf(',')<0)return unpackCode(h);
  // legacy comma codes
  const parts=h.split(',');if(parts.length<10)return null;
  const old=/^[a-z]$/.test(parts[8]);if(old)parts.splice(8,0,'0');
  const vals={};for(let i=0;i<ids.length;i++){const n=parseFloat(parts[i]);if(!isFinite(n))return null;vals[ids[i]]=n;}
  return{vals,surface:CODE_SURF[parts[9]]||'table',score:parseInt(parts[10])||0,level:Math.min(10,Math.max(1,parseInt(parts[11])||1))};}
function applyShared(sh){level=LEVELS[sh.level-1];surface=sh.surface;applyLevel(level);for(const id of ids)if(!$(id).disabled)setVal(id,sh.vals[id]);refreshVals();if(level.surface&&!level.surface.includes(surface))surface=level.surface[0];
  for(const btn of $('surfaces').children)btn.classList.toggle('on',btn.dataset.s===surface);
  challenge=sh.score;const c=$('hudC');c.hidden=false;c.textContent=sh.score>0?`beat ${sh.score} pts`:'they flopped — can you land it?';placeIdle();}
function shareText(score){const code=makeHash(score).slice(1);return (score>0?`${score} pt bottle flip on level ${level.n} — think you can beat it? Same bottle, same throw, same physics.`:`I flopped this bottle flip. Can you land it?`)+` (If the settings don't load, paste this flip code under About: ${code})`;}
async function shareFlip(){const score=lastScore|0;const code=makeHash(score);const url=SHARE_URL+code;
  try{history.replaceState(null,'',code);}catch(e){}
  const title=score>0?`${score} pt bottle flip`:'Bottle flip challenge';const note=$('shareNote');
  if(navigator.share){try{await navigator.share({title,text:shareText(score),url});note.textContent='';return;}catch(e){if(e.name==='AbortError')return;}}
  try{await navigator.clipboard.writeText(url);note.textContent='Link copied';}catch(e){note.textContent=url;}
  setTimeout(()=>{if(note.textContent==='Link copied')note.textContent='';},2500);}
$('share').addEventListener('click',shareFlip);
$('codeGo').addEventListener('click',()=>{const sh=parseHash($('codeIn').value);if(!sh){$('codeIn').value='';$('codeIn').placeholder='That code did not parse';return;}showAbout(false);applyShared(sh);setTimeout(launch,300);});
$('codeIn').addEventListener('keydown',e=>{if(e.key==='Enter')$('codeGo').click();});

// ---------- boot ----------
level=LEVELS[Math.min(progress.unlocked,10)-1];
applyLevel(level);placeIdle();
(function(){const sh=parseHash();if(!sh)return;applyShared(sh);document.title=(sh.score>0?sh.score+' pt bottle flip':'Bottle flip challenge')+' — Bottle Flip Simulator';setTimeout(launch,700);})();
