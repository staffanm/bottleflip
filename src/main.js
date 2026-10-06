import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import './style.css';
import {G,DT,makeBottle,step,difficulty,LEVELS,levelPasses} from './sim.js';
import {runThrow,cancelQueued} from './simpool.js';

// ---------- UI, levels, rendering ----------
const $=id=>document.getElementById(id);
const ids=['h','d','f','v','a','s','tilt','drop','slope'];
const BASE={h:[10,40],d:[4,12],f:[0,100],v:[0,6],a:[40,140],s:[-6,6],tilt:[-60,60],drop:[0,150],slope:[-10,10]};
const fmt={h:x=>(+x).toFixed(1)+' cm',d:x=>(+x).toFixed(2)+' cm',f:x=>(+x).toFixed(1)+' %',v:x=>(+x).toFixed(2)+' m/s',a:x=>(+x).toFixed(1)+'°',s:x=>(+x).toFixed(2)+' rev/s',tilt:x=>(+x).toFixed(1)+'°',drop:x=>(+x).toFixed(1)+' cm',slope:x=>(+x>0?'+':'')+(+x).toFixed(1)+'°'};
const DEFAULTS={h:22,d:6.5,f:33,v:2.8,a:82,s:5.2,tilt:0,drop:20,slope:0};
const PRESETS={classic:{h:22,d:6.5},tall:{h:33,d:5.5},stubby:{h:13,d:8},jug:{h:30,d:11}};
const SURFACES=['table','trampoline','carpet','ice'];
let surface='table';
let bottle=null,running=false,slow=false,zoomed=false,acc=0,last=0,camX=0,camY=0,camVX=0,camVY=0,camHold=null,camInit=false,viewH=1.2,confetti=null,confT=0,finale=null;
let best=0,progress={unlocked:1,done:[]};
try{best=+(localStorage.getItem('bfl-best')||0)||0;const pr=JSON.parse(localStorage.getItem('bfl-progress')||'null');if(pr&&pr.unlocked)progress=pr;}catch(e){}
let level=LEVELS[0];

function readParams(){return{h:+$('h').value/100,d:+$('d').value/100,fill:+$('f').value/100,v:+$('v').value,angle:+$('a').value,spin:+$('s').value,tilt:+$('tilt').value,drop:+$('drop').value/100,slope:+$('slope').value,surface};}
function refreshVals(){for(const id of ids)$(id+'V').textContent=fmt[id]($(id).value);}
function clearResult(){runId++;$('share').hidden=true;$('result').className='result';$('result').dataset.place='';confetti=null;if(!running)$('hudS').textContent='ready';}
function viewFor(p,b){const vy0=p.v*Math.sin(p.angle*Math.PI/180),apex=Math.max(0,vy0*vy0/(2*G));return Math.max(.9,b.y+apex+b.h+.35);}
function placeIdle(){const p=readParams();bottle=makeBottle(p);camY=bottle.y;viewH=viewFor(p,bottle);camHold=null;}

for(const id of ids)$(id).addEventListener('input',()=>{snapAbs(id);refreshVals();cancelPress();if(!running){placeIdle();clearResult();}});
// Sliders move only when a drag starts on the thumb: a tap elsewhere on the track (easy to hit when aiming for the
// -/+ buttons of the setting below) does not jump the value. The thumb position assumes a thumb about 20 px wide;
// the grab zone is 22 px either side of its centre.
for(const id of ids){const el=$(id);
  const offThumb=x=>{const r=el.getBoundingClientRect(),tw=20,f=(+el.value-+el.min)/(+el.max-+el.min);return Math.abs(x-(r.left+tw/2+f*(r.width-tw)))>22;};
  el.addEventListener('mousedown',e=>{if(offThumb(e.clientX))e.preventDefault();});
  el.addEventListener('touchstart',e=>{if(e.touches.length===1&&offThumb(e.touches[0].clientX))e.preventDefault();},{passive:false});}
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
// freeW: the canvas width the camera frames the bottle in. On desktop the controls cover the right side of the canvas.
let freeW=1;
function resize(){const r=cv.getBoundingClientRect(),dpr=window.devicePixelRatio||1;cv.width=Math.round(r.width*dpr);cv.height=Math.round(r.height*dpr);
  const p=document.querySelector('.panel'),pr=p.getBoundingClientRect(),over=getComputedStyle(p).position==='absolute';
  freeW=over?Math.max(cv.width*.4,(pr.left-r.left-14)*dpr):cv.width;}
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
  running=true;acc=0;confetti=null;finale=null;camHold=null;$('result').className='result';$('result').dataset.place='';$('share').hidden=true;$('hudS').textContent='flying';
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
  $('result').className='result show';$('result').dataset.place='';$('share').hidden=true;$('shareNote').textContent='';
  if(passed){if(firstClear){progress.done.push(L.n);if(L.n<10)progress.unlocked=Math.max(progress.unlocked,L.n+1);saveProgress();renderLevels();
      if(L.n===10){finale={t:0,rnd:mulberry(1010),bursts:[],sparks:[]};$('rTitle').textContent+=' — all ten levels cleared!';}
      else $('rTitle').textContent+=L.n===1?' — the ladder is open: level 2 unlocked':` — level ${L.n+1} unlocked`;}
    const rnd=mulberry(42+L.n);confetti=[];const cols=['#2b8fe6','#0f766e','#e2b652','#7c3aed','#c2410c'];
    for(let i=0;i<70;i++)confetti.push({x:.5+(rnd()-.5)*.3,y:.35,vx:(rnd()-.5)*1.6,vy:-rnd()*1.4-.3,c:cols[i%5],r:rnd()*6.28,w:rnd()*.6+.4});confT=0;}
  if(!ok){$('rScore').textContent='0 pts';$('rStars').textContent='☆☆☆☆☆';lastScore=0;$('share').hidden=false;if(challenge!==null)$('rTitle').textContent+=challenge>0?` — the ${challenge} pt challenge stands`:'';return;}
  $('rScore').textContent='…';$('rStars').textContent='measuring tolerance';
  const myRun=++runId;
  measureTolerance(p,()=>myRun===runId).then(tol=>{
    if(!tol||myRun!==runId)return;
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

// After the verdict the full physics keeps running, water included, until the bottle and the water come to rest.
// The outcome is already decided and stays as it is. The water counts as still when its particles travel less than
// 0.1 mm on average in 0.3 s; their velocities are no guide, because each step leaves one step of gravity in them.
function coast(b){const o=b.outcome;b.done=false;step(b);b.done=true;b.outcome=o;b.coastT=(b.coastT||0)+DT;
  b.coastN=(b.coastN||0)+1;if(b.coastN%180)return;
  const P=b.parts,snap=b.restSnap;let travel=0;
  if(snap)for(let i=0;i<P.length;i++)travel+=Math.hypot(P[i].lx-snap[2*i],P[i].ly-snap[2*i+1]);
  b.restSnap=P.flatMap(q=>[q.lx,q.ly]);
  const still=snap&&(!P.length||travel/P.length<1e-4)&&Math.hypot(b.vx,b.vy)<.005&&Math.abs(b.w)<.02;
  if(still||b.coastT>15)b.rested=true;}
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
// Water drawn from the particles as a 2D body of water, not as dots:
// - a smooth density field (radius FR particle spacings) on a grid half a spacing wide;
// - each particle's blob is stretched along its motion relative to the bottle (the distance of about STREAK seconds),
//   so moving water reads as streams and streaks;
// - marching squares at two levels: the low level joins thin, scattered water into pale sheets, the high level FT
//   (half a spacing above the top row of resting particles) is the solid body with a light rim.
// No pixel read-back, so it stays cheap.
const FR=2.5,STREAK=.02,FT_THIN=.4,SPRAY=.6; // SPRAY: below this share of the body level a particle counts as spray
const FT=(()=>{let sum=0;for(let k=0;k<4;k++){const ox=k/4;let f=0;
  for(let i=-8;i<=8;i++)for(let j=0;j<8;j++){const dx=i+ox,dy=.5+j,q=(dx*dx+dy*dy)/(FR*FR);if(q<1){const t=1-q;f+=t*t;}}sum+=f;}return sum/4;})();
let field=new Float32Array(0),thinField=new Float32Array(0),spd=new Float32Array(0),dirx=spd,diry=spd;
// one contour level: filled region and its outline
function contour(f,nx,ny,T,x0,y0,cs){
  const body=new Path2D(),rim=new Path2D(),X=i=>x0+i*cs,Y=j=>y0+j*cs;
  for(let j=0;j<ny-1;j++){let run=-1;
    for(let i=0;i<nx-1;i++){const a=f[j*nx+i],bb=f[j*nx+i+1],c=f[(j+1)*nx+i+1],d=f[(j+1)*nx+i];
      if(a>=T&&bb>=T&&c>=T&&d>=T){if(run<0)run=i;continue;}
      if(run>=0){body.rect(X(run),Y(j),(i-run)*cs,cs);run=-1;}
      if(a<T&&bb<T&&c<T&&d<T)continue;
      // corners in order: bottom-left, bottom-right, top-right, top-left; crossings on the edges between them
      const cv=[a,bb,c,d],cx=[X(i),X(i+1),X(i+1),X(i)],cy=[Y(j),Y(j),Y(j+1),Y(j+1)],poly=[],cross=[];
      for(let e=0;e<4;e++){const e2=(e+1)&3;if(cv[e]>=T)poly.push(cx[e],cy[e]);
        if((cv[e]>=T)!==(cv[e2]>=T)){const t=(T-cv[e])/(cv[e2]-cv[e]),qx=cx[e]+t*(cx[e2]-cx[e]),qy=cy[e]+t*(cy[e2]-cy[e]);poly.push(qx,qy);cross.push(qx,qy);}}
      body.moveTo(poly[0],poly[1]);for(let q=2;q<poly.length;q+=2)body.lineTo(poly[q],poly[q+1]);body.closePath();
      for(let q=0;q+3<cross.length;q+=4){rim.moveTo(cross[q],cross[q+1]);rim.lineTo(cross[q+2],cross[q+3]);}}
    if(run>=0)body.rect(X(run),Y(j),(nx-1-run)*cs,cs);}
  return{body,rim};
}
function drawFluid(b){
  const P=b.parts,n=P.length;if(!n)return;
  const cs=b.s*.5,rr=FR*b.s,pad=rr*2,x0=-b.R-pad,y0=-pad,nx=Math.ceil((2*b.R+2*pad)/cs)+1,ny=Math.ceil((b.h+b.hc+2*pad)/cs)+1;
  if(field.length<nx*ny)field=new Float32Array(nx*ny);const f=field;f.fill(0,0,nx*ny);
  const c=Math.cos(b.th),si=Math.sin(b.th),rr2=rr*rr;
  if(spd.length<n){spd=new Float32Array(n);dirx=new Float32Array(n);diry=new Float32Array(n);}
  for(let m=0;m<n;m++){const q=P[m];
    // velocity relative to the bottle, in the bottle's frame
    const wx=q.x-b.x,wy=q.y-b.y,rvx=q.vx-(b.vx-b.w*wy),rvy=q.vy-(b.vy+b.w*wx),lvx=c*rvx+si*rvy,lvy=-si*rvx+c*rvy;
    const sp=Math.hypot(lvx,lvy),st=1+Math.min(2,sp*STREAK/rr),ux=sp>1e-6?lvx/sp:1,uy=sp>1e-6?lvy/sp:0;spd[m]=sp;dirx[m]=ux;diry[m]=uy;
    const px=q.lx-x0,py=q.ly+b.cy-y0,ext=rr*st,ci=Math.round(px/cs),cj=Math.round(py/cs),k=Math.ceil(ext/cs);
    for(let j=Math.max(0,cj-k);j<=Math.min(ny-1,cj+k);j++){const dy=j*cs-py;
      for(let i=Math.max(0,ci-k);i<=Math.min(nx-1,ci+k);i++){const dx=i*cs-px,along=(dx*ux+dy*uy)/st,across=-dx*uy+dy*ux,r2=along*along+across*across;
        if(r2<rr2){const t=1-r2/rr2;f[j*nx+i]+=t*t;}}}}
  const main=contour(f,nx,ny,FT,x0,y0,cs);
  // the pale layer comes only from particles well outside the solid body (spray and thin sheets), so still water has none
  if(thinField.length<nx*ny)thinField=new Float32Array(nx*ny);const g=thinField;g.fill(0,0,nx*ny);let any=false;
  for(let m=0;m<n;m++){const q=P[m],px=q.lx-x0,py=q.ly+b.cy-y0,ci=Math.round(px/cs),cj=Math.round(py/cs);
    if(ci<0||cj<0||ci>=nx||cj>=ny||f[cj*nx+ci]>=SPRAY*FT)continue;any=true;
    const sp=spd[m],st=1+Math.min(2,sp*STREAK/rr),ux=sp>1e-6?dirx[m]:1,uy=sp>1e-6?diry[m]:0,ext=rr*st,k=Math.ceil(ext/cs);
    for(let j=Math.max(0,cj-k);j<=Math.min(ny-1,cj+k);j++){const dy=j*cs-py;
      for(let i=Math.max(0,ci-k);i<=Math.min(nx-1,ci+k);i++){const dx=i*cs-px,along=(dx*ux+dy*uy)/st,across=-dx*uy+dy*ux,r2=along*along+across*across;
        if(r2<rr2){const t=1-r2/rr2;g[j*nx+i]+=t*t;}}}}
  const thin=any?contour(g,nx,ny,FT_THIN,x0,y0,cs):{body:new Path2D(),rim:new Path2D()};
  ctx.fillStyle='rgba(70,155,232,.38)';ctx.fill(thin.body);
  ctx.strokeStyle='rgba(150,205,245,.55)';ctx.lineWidth=b.s*.3;ctx.lineCap='round';ctx.stroke(thin.rim);
  ctx.fillStyle='rgba(33,133,222,.85)';ctx.fill(main.body);
  ctx.strokeStyle='rgba(175,222,252,.95)';ctx.lineWidth=b.s*.4;ctx.stroke(main.rim);
}

function draw(dt){
  const b=bottle,W=cv.width,H=cv.height,dpr=window.devicePixelRatio||1;
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,W,H);
  // camera planning: start the bottle off-centre, let it cross the frame, pan only as it nears the far edge, centre once it lands
  const marginPx=46*dpr;let scale,ox,oy;
  scale=zoomed?.42*H/b.h:(H-marginPx-14*dpr)/viewH;
  const vw=freeW/scale;
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
  ox=freeW/2-camX*scale;oy=zoomed?H*.55+camY*scale:H-marginPx;
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
  // water: drawn from the simulated particles the whole time
  ctx.save();bottlePath();ctx.clip();drawFluid(b);ctx.restore();
  // shell outline + highlights
  bottlePath();ctx.lineWidth=lw;ctx.strokeStyle='rgba(30,41,59,.8)';ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,.75)';ctx.beginPath();ctx.roundRect(-R*.78,h*.06,R*.14,h*.66,R*.07);ctx.fill();
  ctx.fillStyle='rgba(255,255,255,.4)';ctx.beginPath();ctx.roundRect(R*.55,h*.1,R*.1,h*.55,R*.05);ctx.fill();
  // cap
  ctx.fillStyle='#1c1a17';ctx.beginPath();ctx.roundRect(-Rc,h,2*Rc,hc,.002);ctx.fill();ctx.lineWidth=lw;ctx.strokeStyle='rgba(30,41,59,.8)';ctx.stroke();
  ctx.fillStyle='#e2b652';ctx.fillRect(-Rc,h,2*Rc,hc*.22);
  ctx.fillStyle='rgba(255,255,255,.18)';for(let i=0;i<4;i++)ctx.fillRect(-Rc+Rc*.3+i*Rc*.4,h+hc*.35,Rc*.1,hc*.55);
  ctx.restore();
  // keep the result card off the bottle
  {const res=$('result');if(res.classList.contains('show')){const c=Math.cos(b.th),si=Math.sin(b.th);let l=1e9,r=-1e9,t=1e9,bt=-1e9;
    for(const[vx,vy]of b.verts){const px=(ox+(b.x+c*vx-si*vy)*scale)/dpr,py=(oy-(b.y+si*vx+c*vy)*scale)/dpr;l=Math.min(l,px);r=Math.max(r,px);t=Math.min(t,py);bt=Math.max(bt,py);}
    placeResult(res,{l:l-6,r:r+6,t:t-6,b:bt+6});}}
  // HUD
  $('hudT').textContent=(b.endT??b.t).toFixed(2)+' s'; // stops at the verdict; the bottle may still slide after it
  $('hudF').textContent=(Math.abs(running?b.flipAng:(b.touched?b.airAng:b.flipAng))/(2*Math.PI)).toFixed(1)+' flips';
  if(confetti){for(const q of confetti){ctx.save();ctx.translate(q.x*W,q.y*H);ctx.rotate(q.r);ctx.fillStyle=q.c;ctx.fillRect(-4*dpr,-2.5*dpr*q.w,8*dpr,5*dpr*q.w);ctx.restore();}}
  if(finale)drawFinale(dt,W,H,dpr);
}
// Result card placement: keep the current place while it leaves the bottle free; otherwise take the first place that
// does: top, top without the detail chips, then the side away from the bottle (full, then compact). Places are measured
// on a hidden copy of the card, at most every 150 ms, so the card never jumps back and forth or mid-transition.
const PLACES=['','compact','side-right','side-left','side-right compact','side-left compact'];
let placeT=0;
function placeResult(res,box){
  const now=performance.now();if(now-placeT<150)return;placeT=now;
  const probe=res.cloneNode(true);probe.removeAttribute('id');probe.style.visibility='hidden';probe.style.transition='none';res.parentNode.appendChild(probe);
  const rectFor=pl=>{probe.className='result show'+(pl?' '+pl:'');return{l:probe.offsetLeft,t:probe.offsetTop,r:probe.offsetLeft+probe.offsetWidth,b:probe.offsetTop+probe.offsetHeight};};
  const free=pl=>{const q=rectFor(pl);return q.r<box.l||q.l>box.r||q.b<box.t||q.t>box.b;};
  const cur=res.dataset.place||'';let pick=cur;
  if(!free(cur)){pick=PLACES.find(free);if(pick===undefined)pick='compact';}
  probe.remove();
  if(pick!==cur||!res.className.endsWith(pick)){res.dataset.place=pick;res.className='result show'+(pick?' '+pick:'');}
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
function passes(r,p){return r.outcome!=='flop'&&levelPasses(level,r,p);}
let solving=false;
function paramsWith(id,val){const vals={};for(const i of ids)vals[i]=+$(i).value;vals[id]=val;
  return{h:vals.h/100,d:vals.d/100,fill:vals.f/100,v:vals.v,angle:vals.a,spin:vals.s,tilt:vals.tilt,drop:vals.drop/100,slope:vals.slope,surface};}
async function solveSlider(id){
  if(solving||running)return;const el=$(id);if(el.disabled)return;solving=true;
  const row=el.closest('.row'),min=+el.min,max=+el.max,st=+el.step,cur=+el.value;
  row.classList.add('solving');const valEl=$(id+'V');const dec=(st+'').split('.')[1]?.length||0;
  const snap=x=>+(Math.round((x-min)/st)*st+min).toFixed(dec);
  const ok=async v=>{const p=paramsWith(id,v);return passes(await runThrow(p),p);};
  let found=null;
  try{
    if(await ok(cur)){found=cur;}
    else{
      const cs=Math.max(st,(max-min)/24);let k=1,dirHit=0,kHit=0;
      while(cur+k*cs<=max+1e-9||cur-k*cs>=min-1e-9){
        // both directions at once
        const tries=[1,-1].map(dir=>{const v=snap(cur+dir*k*cs);return v<min||v>max?null:{dir,v};}).filter(Boolean);
        valEl.textContent='solving '+tries.map(t=>fmt[id](t.v)).join(' / ')+'…';
        const res=await Promise.all(tries.map(t=>ok(t.v)));
        const hitAt=res.indexOf(true);if(hitAt>=0){dirHit=tries[hitAt].dir;kHit=k;}
        if(dirHit)break;k++;
      }
      if(dirHit){let hit=snap(cur+dirHit*kHit*cs),miss=cur+dirHit*(kHit-1)*cs;found=hit;
        while(Math.abs(hit-miss)>st*1.5){const mid=snap((hit+miss)/2);if(mid===hit||mid===miss)break;
          valEl.textContent='solving '+fmt[id](mid)+'…';if(await ok(mid)){hit=mid;found=mid;}else miss=mid;}}
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
  try{const order=[surface,...allowed.filter(s=>s!==surface)].filter(sf=>allowed.includes(sf));
    const res=await Promise.all(order.map(sf=>{const p=readParams();p.surface=sf;return runThrow(p).then(r=>passes(r,p));}));
    const at=res.indexOf(true);if(at>=0)found=order[at];}
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
const DEF_PARAMS={h:.22,d:.065,fill:.33,v:2.8,angle:82,spin:4.6,tilt:0,drop:.2,slope:0,surface:'table'};
const DEF_DIFF=difficulty(DEF_PARAMS,'upright').total;
const DEF_TAU=.04;
let runId=0;
// The score's tolerance: the smallest step (share of a setting's range) at which changing any one setting turns the
// landing into a flop. All settings are tried at the smallest step first, in parallel; the first step with a flop
// ends the search, and the throws still queued for it are dropped. Returns null if a newer flip replaced this one.
async function measureTolerance(p,stillCurrent){
  let live=Object.keys(RANGES).flatMap(k=>[[k,1],[k,-1]]);
  for(const f of LADDER){
    live=live.filter(([k,dir])=>{const[lo,hi]=RANGES[k],v=p[k]+dir*f*(hi-lo);return v>=lo&&v<=hi;});
    if(!live.length)break;
    const hit=await new Promise(resolve=>{let left=live.length,over=false;
      live.forEach(([k,dir],i)=>{const[lo,hi]=RANGES[k];runThrow({...p,[k]:p[k]+dir*f*(hi-lo)}).then(r=>{if(over)return;
        if(r&&r.outcome==='flop'){over=true;cancelQueued();resolve(i);return;}
        if(--left===0){over=true;resolve(-1);}});});});
    if(!stillCurrent())return null;
    if(hit>=0)return{tau:f,worst:RANGES[live[hit][0]][2]};
  }
  return{tau:.4,worst:''};
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
