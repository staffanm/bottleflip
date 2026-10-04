// ---------- Deterministic trig: identical bits in every JavaScript engine ----------
// Math.sin/Math.cos are not required to be bit-identical across engines, and a many-flip throw is chaotic enough
// to care. These use only IEEE-754 +,-,*,/ and floor (all correctly rounded), so every engine computes the same bits.
const D_PI_2_HI=1.5707963267341256, D_PI_2_LO=6.077100506506192e-11, D_PI_2=1.5707963267948966;
function dsincos(x){
  const k=Math.floor(x/D_PI_2+0.5);
  const r=(x-k*D_PI_2_HI)-k*D_PI_2_LO;
  const r2=r*r;
  const s=r*(1+r2*(-1/6+r2*(1/120+r2*(-1/5040+r2*(1/362880+r2*(-1/39916800+r2*(1/6227020800-r2/1307674368000)))))));
  const c=1+r2*(-1/2+r2*(1/24+r2*(-1/720+r2*(1/40320+r2*(-1/3628800+r2*(1/479001600-r2/87178291200))))));
  const q=((k%4)+4)%4;
  return q===0?[s,c]:q===1?[c,-s]:q===2?[-s,-c]:[-c,s];
}
function dsin(x){return dsincos(x)[0];}
function dcos(x){return dsincos(x)[1];}
function dhyp(a,b){return Math.sqrt(a*a+b*b);}
function dtan(x){const sc=dsincos(x);return sc[0]/sc[1];}


// ---------- Physics (SI units; deterministic fixed-step) ----------
const G = 9.81, DT = 1/600, BETA = .25, ITERS = 4;
const SURF = { table:{mu:.45,e:.12}, trampoline:{mu:.6,e:.55}, carpet:{mu:.8,e:.05}, ice:{mu:.05,e:.1} };

function makeBottle(p){
  const h = p.h, R = p.d/2, hc = .014, Rc = Math.min(Math.max(.45*R,.01),.017);
  const Ri = R - .0012, Rn = Math.max(Rc*.85,.008), hs = .78*h;
  const mBody = .022*(R*h)/(.0325*.22), mCap = .0025, M = mBody+mCap;
  const cy = (mBody*h/2 + mCap*(h+hc/2))/M;
  const I = mBody*(R*R/2+h*h/12) + mBody*(h/2-cy)**2 + mCap*(Rc*Rc/2+hc*hc/12) + mCap*(h+hc/2-cy)**2;
  // interior half-planes (COM frame): point q, inward normal n
  const N=(x,y)=>{const l=dhyp(x,y);return[x/l,y/l]};
  const sl=N(h-hs,-(Ri-Rn)), sr=N(-(h-hs),-(Ri-Rn));
  const planes=[
    {qx:0,qy:-cy,nx:0,ny:1},{qx:-Ri,qy:-cy,nx:1,ny:0},{qx:Ri,qy:-cy,nx:-1,ny:0},
    {qx:-Ri,qy:hs-cy,nx:sl[0],ny:sl[1]},{qx:Ri,qy:hs-cy,nx:sr[0],ny:sr[1]},{qx:0,qy:h-cy,nx:0,ny:-1}];
  // collision outline follows the drawn shape: body, tapered shoulder, neck, cap
  const verts=[[-R,-cy],[R,-cy],[R,hs-cy],[-R,hs-cy],[Rn,h-cy],[-Rn,h-cy],[Rc,h-cy],[-Rc,h-cy],[Rc,h+hc-cy],[-Rc,h+hc-cy]];
  // fluid particles
  const area = p.fill*2*Ri*h, vol = p.fill*Math.PI*Ri*Ri*h, mf = 1000*vol;
  const n = p.fill<=0?0:Math.max(2,Math.round(70*p.fill));
  const s = n? Math.sqrt(area/n):.01, mp = n? mf/n:0, rp = s*.45;
  const parts=[];
  if(n){
    const cols=Math.max(1,Math.floor(2*Ri/s)), x0=-Ri+ (2*Ri-cols*s)/2 + s/2;
    for(let k=0;k<n;k++){const i=k%cols,j=Math.floor(k/cols);
      const jit=(((i*7+j*3)%5)-2)*.03*s;
      const px=x0+i*s+jit,py=s/2+j*s-cy;parts.push({x:px,y:py,vx:0,vy:0,lx:px,ly:py});}
  }
  const surf=SURF[p.surface]||SURF.table;
  const th=p.tilt*Math.PI/180, ang=p.angle*Math.PI/180;
  const phi=(p.slope||0)*Math.PI/180,fnx=-dsin(phi),fny=dcos(phi); // surface plane through the origin, tilted by phi
  const b={M,I,cy,h,R,Rc,hc,Ri,Rn,hs,planes,verts,parts,mp,rp,s,phi,fnx,fny,
    mu:surf.mu,e:surf.e,spring:p.surface==='trampoline'?{k:650,c:1.0}:null, x:0,y:0,th,vx:p.v*dcos(ang),vy:p.v*dsin(ang),w:p.spin*2*Math.PI,
    t:0,touched:false,touchT:-1,stable:false,poseTh:0,poseX:0,poseY:0,flipAng:0,settledT:0,done:false,outcome:null,lastAng:th,airAng:0};
  // place so the lowest vertex sits at drop height above the surface (measured along the surface normal at x=0)
  const c=dcos(th),si=dsin(th);let minY=1e9;
  for(const[vx,vy]of verts){const wx=c*vx-si*vy,wy=si*vx+c*vy;const dn=wx*fnx+wy*fny;if(dn<minY)minY=dn;}
  b.y=(p.drop-minY)/fny;
  // the whole bottle (shell + water) rotates rigidly about the system centre of mass at launch
  let sx=0,sy=0;for(const q of parts){const wx=c*q.x-si*q.y,wy=si*q.x+c*q.y;q.x=b.x+wx;q.y=b.y+wy;sx+=wx;sy+=wy;}
  const Mt=M+n*mp,gx=(n?mp*sx:0)/Mt,gy=(n?mp*sy:0)/Mt; // system COM offset from shell COM
  const V0x=b.vx,V0y=b.vy;
  b.vx=V0x+b.w*gy;b.vy=V0y-b.w*gx;
  for(const q of parts){const rx=q.x-b.x-gx,ry=q.y-b.y-gy;q.vx=V0x-b.w*ry;q.vy=V0y+b.w*rx;}
  return b;
}

function applyJ(b,rx,ry,jx,jy){b.vx+=jx/b.M;b.vy+=jy/b.M;b.w+=(rx*jy-ry*jx)/b.I;}

function step(b){
  if(b.done)return;
  const dt=DT;
  b.vy-=G*dt; b.x+=b.vx*dt; b.y+=b.vy*dt; b.th+=b.w*dt;
  const P=b.parts, n=P.length;
  for(const q of P){q.vy-=G*dt;q.x+=q.vx*dt;q.y+=q.vy*dt;}
  // particle-particle: incompressibility + viscosity
  const s=b.s;
  for(let it=0;it<2;it++)for(let i=0;i<n;i++){const a=P[i];for(let j=i+1;j<n;j++){const o=P[j];
    let dx=o.x-a.x,dy=o.y-a.y,d2=dx*dx+dy*dy;if(d2>=s*s||d2<1e-12)continue;
    const d=Math.sqrt(d2),ux=dx/d,uy=dy/d,target=BETA*(s-d)/dt;
    const rvx=o.vx-a.vx,rvy=o.vy-a.vy,vn=rvx*ux+rvy*uy;
    if(vn<target){const k=(vn-target)*.5;a.vx+=ux*k;a.vy+=uy*k;o.vx-=ux*k;o.vy-=uy*k;}
    if(it===0){const k=vn*.04;a.vx+=ux*k;a.vy+=uy*k;o.vx-=ux*k;o.vy-=uy*k;}
  }}
  // particle-wall and floor contacts, iterated so the stiff water/shell/floor chain converges
  const c=dcos(b.th),si=dsin(b.th);
  let contact=false;
  const W=[];let minD=1e9;const fnx=b.fnx,fny=b.fny,ftx=fny,fty=-fnx; // normal and tangent of the surface
  for(const[vx,vy]of b.verts){const rx=c*vx-si*vy,ry=si*vx+c*vy;const dn=(b.x+rx)*fnx+(b.y+ry)*fny;W.push([rx,ry,dn]);if(dn<minD)minD=dn;}
  if(!b.spring&&minD<0){b.x-=minD*fnx;b.y-=minD*fny;for(const v of W)v[2]-=minD;}
  for(let iter=0;iter<ITERS;iter++){
  for(const q of P){
    const wx=q.x-b.x,wy=q.y-b.y;
    let lx=c*wx+si*wy, ly=-si*wx+c*wy;
    for(const pl of b.planes){
      const d=(lx-pl.qx)*pl.nx+(ly-pl.qy)*pl.ny-b.rp;
      if(d>=0)continue;
      const nx=c*pl.nx-si*pl.ny, ny=si*pl.nx+c*pl.ny;
      const rx=c*lx-si*ly, ry=si*lx+c*ly;
      const vpx=b.vx-b.w*ry, vpy=b.vy+b.w*rx;
      let rvx=q.vx-vpx,rvy=q.vy-vpy, vn=rvx*nx+rvy*ny;
      const target=BETA*(-d)/dt;
      if(vn<target){const rn=rx*ny-ry*nx,k=1/b.mp+1/b.M+rn*rn/b.I,j=(target-vn)/k;
        q.vx+=j*nx/b.mp;q.vy+=j*ny/b.mp;applyJ(b,rx,ry,-j*nx,-j*ny);
        rvx=q.vx-(b.vx-b.w*ry);rvy=q.vy-(b.vy+b.w*rx);}
      const tx=-ny,ty=nx,vt=rvx*tx+rvy*ty,rt=rx*ty-ry*tx,kt=1/b.mp+1/b.M+rt*rt/b.I,jt=-vt*.12/kt;
      q.vx+=jt*tx/b.mp;q.vy+=jt*ty/b.mp;applyJ(b,rx,ry,-jt*tx,-jt*ty);
    }
    q.lx=lx;q.ly=ly;
  }
  // surface contact (plane with normal fn, tangent ft)
  for(const v of W){const rx=v[0],ry=v[1];const dn=(b.x+rx)*fnx+(b.y+ry)*fny;
    const vpx=b.vx-b.w*ry,vpy=b.vy+b.w*rx;const vn=vpx*fnx+vpy*fny,vt=vpx*ftx+vpy*fty;
    const rn=rx*fny-ry*fnx,rt=rx*fty-ry*ftx;
    if(b.spring){const depth=-dn;if(depth<=0)continue;contact=true;
      if(!b.touched){b.touched=true;b.touchT=b.t;b.airAng=b.flipAng;}
      const j=Math.max(0,(b.spring.k*depth-b.spring.c*vn)*dt/ITERS);applyJ(b,rx,ry,j*fnx,j*fny);
      const kt=1/b.M+rt*rt/b.I;let jt=-vt/kt;const lim=b.mu*j;if(jt>lim)jt=lim;if(jt<-lim)jt=-lim;applyJ(b,rx,ry,jt*ftx,jt*fty);
      continue;}
    if(dn>5e-4)continue;contact=true;
    if(!b.touched){b.touched=true;b.touchT=b.t;b.airAng=b.flipAng;}
    if(vn<0){const eEff=Math.abs(vn)<.35?0:b.e;const k=1/b.M+rn*rn/b.I,j=-(1+eEff)*vn/k;applyJ(b,rx,ry,j*fnx,j*fny);
      const vpx2=b.vx-b.w*ry,vpy2=b.vy+b.w*rx,vt2=vpx2*ftx+vpy2*fty;const kt=1/b.M+rt*rt/b.I;let jt=-vt2/kt;const lim=b.mu*j;if(jt>lim)jt=lim;if(jt<-lim)jt=-lim;applyJ(b,rx,ry,jt*ftx,jt*fty);}
    else{const kt=1/b.M+rt*rt/b.I;let jt=-vt/kt;const lim=b.mu*b.M*G*dt*2;if(jt>lim)jt=lim;if(jt<-lim)jt=-lim;applyJ(b,rx,ry,jt*ftx,jt*fty);}
  }
  }
  // stable only if the whole system's centre of mass sits over the points touching the surface
  let stable=false;
  if(contact){let lo=1e9,hi=-1e9;for(const[rx,ry]of W){const dn=(b.x+rx)*fnx+(b.y+ry)*fny;if(dn<=(b.spring?0:6e-3)){const tproj=(b.x+rx)*ftx+(b.y+ry)*fty;lo=Math.min(lo,tproj);hi=Math.max(hi,tproj);}}
    let cx=b.M*b.x,cy2=b.M*b.y,mt=b.M;for(const q of P){cx+=b.mp*q.x;cy2+=b.mp*q.y;mt+=b.mp;}cx/=mt;cy2/=mt;const ct=cx*ftx+cy2*fty;stable=ct>=lo-1e-3&&ct<=hi+1e-3;}
  b.stable=stable;
  if(contact){const nearRest=stable&&dhyp(b.vx,b.vy)<.15&&Math.abs(b.w)<1.5;const dmp=1-(nearRest?10:2.5)*dt;
    // settle damping acts on spin and the normal component; along the slope only when friction can actually hold the bottle
    const vn=b.vx*fnx+b.vy*fny,vt=b.vx*ftx+b.vy*fty,holds=b.mu>=dtan(Math.abs(b.phi))*1.05;const dmpT=holds?dmp:1-2.5*dt;
    const vn2=vn*dmp,vt2=vt*dmpT;b.vx=vn2*fnx+vt2*ftx;b.vy=vn2*fny+vt2*fty;b.w*=dmp;
    // once on the surface, let the water calm down (viscous settling)
    const kd=(stable?10:4)*dt;for(const q of P){const rx=q.x-b.x,ry=q.y-b.y;q.vx+=((b.vx-b.w*ry)-q.vx)*kd;q.vy+=((b.vy+b.w*rx)-q.vy)*kd;}}
  // bookkeeping
  b.flipAng+=b.th-b.lastAng;b.lastAng=b.th;b.t+=dt;
  // settle test
  let rel=0;for(const q of P)rel+=dhyp(q.vx-b.vx,q.vy-b.vy);rel=n?rel/n:0;
  b.rel=rel;
  // at rest = pose has not changed for a while (the water may still jitter numerically; the bottle's pose is what matters)
  const canHold=b.mu>=dtan(Math.abs(b.phi))*1.05; // on a slope steeper than friction allows, nothing is ever at rest
  const poseMoved=!b.stable||!b.touched||!canHold||Math.abs(b.th-b.poseTh)>.03||Math.abs(b.x-b.poseX)>.01||Math.abs(b.y-b.poseY)>.006;
  if(poseMoved){b.poseTh=b.th;b.poseX=b.x;b.poseY=b.y;b.settledT=0;}else b.settledT+=dt;
  // a bottle that still slides is not at rest yet: give it up to 4 s after touchdown, like a bottle that still rocks
  const atRest=b.stable&&dhyp(b.vx,b.vy)<.05;
  if((b.settledT>.3)||(b.touched&&b.t>b.touchT+(atRest?1.6:4))||b.t>9||(b.x*b.fnx+b.y*b.fny)<-1){b.done=true;b.outcome=judge(b);}
}

function judge(b){
  if((b.x*b.fnx+b.y*b.fny)<-1)return'flop';
  if(Math.abs(b.phi)>.005&&Math.abs(b.vx*b.fny-b.vy*b.fnx)>.08)return'flop'; // still sliding down the surface: that is not a landing
  let a=(b.th-b.phi)%(2*Math.PI);if(a>Math.PI)a-=2*Math.PI;if(a<-Math.PI)a+=2*Math.PI;
  const cos=dcos(a);
  if(cos>.93)return'upright';
  if(cos<-.93)return'cap';
  return'flop';
}

function difficulty(p,outcome){
  const spinF=1+Math.abs(p.spin)/2;
  const ar=Math.max(.5,(p.h/p.d)/3.4),ar4=Math.sqrt(Math.sqrt(ar));const aspF=ar*ar4*Math.sqrt(Math.sqrt(ar4)); // ar^1.3125 via square roots only (engine-independent)
  const fillF=1+1.5*Math.abs(p.fill-.33);
  const dropF=1+p.drop;
  const speedF=1+p.v/3;
  const capF=outcome==='cap'?4:1;
  const surfF={table:1,trampoline:2.5,carpet:.8,ice:2}[p.surface]||1;
  const slopeF=1+Math.abs(p.slope||0)/8;
  const total=spinF*aspF*fillF*dropF*speedF*capF*surfF*slopeF;
  return{spinF,aspF,fillF,dropF,speedF,capF,surfF,slopeF,total,score:Math.round(100*total)};
}
const LEVELS=[
 {n:1,name:'Warm-up',desc:'Land it. Any bottle, any throw, any surface.'},
 {n:2,name:'Trampoline',desc:'Land it on the trampoline.',surface:['trampoline']},
 {n:3,name:'Tall boy',desc:'Bottle locked to the tall boy. Land it.',lock:{h:33,d:5.5}},
 {n:4,name:'High drop',desc:'Release at least 1 m above the surface.',min:{drop:100}},
 {n:5,name:'On the slope',desc:'The surface is tilted at least 5° either way. Land it on the slope.',minAbs:{slope:5}},
 {n:6,name:'On ice',desc:'Land it on ice.',surface:['ice']},
 {n:7,name:'Big jug',desc:'Big jug, at least 60 % full.',lock:{h:30,d:11},min:{f:60}},
 {n:8,name:'Side arm',desc:'Launch angle 55° or flatter, on the table.',max:{a:55},surface:['table']},
 {n:9,name:'Double',desc:'At least two full rotations before touchdown.',minFlips:1.9},
 {n:10,name:'Cap it',desc:'Finish balanced on the cap, from at least 60 cm up.',min:{drop:60},cap:true},
];
function levelPasses(L,b,p){if(b.outcome==='flop')return false;if(L.minAbs){for(const k in L.minAbs){const v=k==='slope'?(p.slope||0):p[k];if(Math.abs(v)<L.minAbs[k]-1e-9)return false;}}if(L.cap&&b.outcome!=='cap')return false;if(L.minFlips&&Math.abs(b.airAng)/(2*Math.PI)<L.minFlips)return false;return true;}
export{G,DT,makeBottle,step,judge,difficulty,LEVELS,levelPasses};
