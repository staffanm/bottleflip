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
const G = 9.81, DT = 1/600, ITERS = 4;
// Water: Position Based Fluids (Macklin and Muller 2013). Every step the particles are moved so that the density around
// each one stays at the rest density (incompressible), then a little XSPH smoothing evens out their velocities.
// N: number of water particles (cost grows with it). HK: kernel radius in particle spacings.
// ITER: density iterations per step. EPS: relaxation of the density constraint. SCORR_K: small repulsion that keeps
// particles from clumping. CMIN: lowest density error the solver acts on (below 0: the water holds together a little).
// XSPH: share of the velocity difference to neighbours removed per step.
// WALL_MU: drag of the water along the inside of the bottle (1/s, so it does not depend on the time step).
const FLUID = { N: 200, HK: 2.25, ITER: 2, EPS: .5, SCORR_K: .1, XSPH: .02, WALL_MU: 20, CMIN: 0 };
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
  // a fixed count: the particle size follows the amount of water, so a small change of a setting is a small change of the throw
  const n = p.fill<=0?0:FLUID.N;
  const s = n? Math.sqrt(area/n):.01, mp = n? mf/n:0, rp = s*.5;
  // kernel radius and the rest density of a square lattice at spacing s (the water's packing at rest)
  // kernel W = (h^2-r^2)^3 (poly6 without its constant), rest density and the size of the constraint gradient for a
  // particle inside a square lattice at spacing s; EPS and SCORR_K are relative to that size, so they do not depend on s
  const kh = FLUID.HK*s;let rho0=0,g2=0;
  for(let i=-3;i<=3;i++)for(let j=-3;j<=3;j++){const r2=(i*i+j*j)*s*s;if(r2<kh*kh){const u=kh*kh-r2;rho0+=u*u*u;g2+=36*u*u*u*u*r2;}}
  const den0=g2/(rho0*rho0);
  // wall density: what rows of particles behind a wall would add to a particle at distance d from it (d from 0 to h),
  // as density and as its derivative along the wall normal. 33 samples, interpolated linearly.
  const WT=33,wrho=new Float64Array(WT),wgrad=new Float64Array(WT);
  for(let t=0;t<WT;t++){const d=kh*t/(WT-1);let r=0,gr=0;
    for(let m=0;m<8;m++){const gy=-(s/2+m*s)-d;for(let i=-8;i<=8;i++){const gx=i*s,r2=gx*gx+gy*gy;if(r2>=kh*kh)continue;const u=kh*kh-r2;r+=u*u*u;gr+=6*u*u*(-gy);}}
    wrho[t]=r;wgrad[t]=gr;}
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
  const b={M,I,cy,h,R,Rc,hc,Ri,Rn,hs,planes,verts,parts,mp,rp,s,kh,rho0,den0,wrho,wgrad,phi,fnx,fny,
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

// Neighbour pairs from a grid in the bottle's own frame (the water stays inside the bottle), cells one kernel radius wide.
// Each cell checks itself and four of its neighbours, so each pair is found once. Arrays are reused between steps.
// The order depends only on particle order, so every engine finds the same pairs in the same order.
function buildPairs(b){
  const P=b.parts,n=P.length,kh=b.kh,kh2=kh*kh;
  let W=b.work;
  if(!W){const gx=Math.ceil(2*b.R/kh)+3,gy=Math.ceil((b.h+.02)/kh)+3;
    W=b.work={gx,gy,head:new Int32Array(gx*gy),next:new Int32Array(n),cell:new Int32Array(n),
      pi:new Int32Array(n*12),pj:new Int32Array(n*12),np:0,dx:new Float64Array(n),dy:new Float64Array(n),rho:new Float64Array(n),rhn:new Float64Array(n),px:new Float64Array(n),py:new Float64Array(n)};}
  const gx=W.gx,gy=W.gy,head=W.head,next=W.next,c=dcos(b.th),si=dsin(b.th),x0=-b.R-kh,y0=-b.cy-kh;
  head.fill(-1);
  for(let i=n-1;i>=0;i--){const wx=P[i].x-b.x,wy=P[i].y-b.y;
    let ix=Math.floor((c*wx+si*wy-x0)/kh),iy=Math.floor((-si*wx+c*wy-y0)/kh);
    ix=ix<0?0:ix>=gx?gx-1:ix;iy=iy<0?0:iy>=gy?gy-1:iy;const cl=iy*gx+ix;W.cell[i]=cl;next[i]=head[cl];head[cl]=i;}
  let np=0;
  for(let i=0;i<n;i++){const a=P[i],cl=W.cell[i],ix=cl%gx,iy=(cl-ix)/gx;
    for(let k=0;k<5;k++){const ox=k===0?0:k===1?1:k===2?-1:k===3?0:1,oy=k===0?0:k===1?0:1;const jx=ix+ox,jy=iy+oy;
      if(jx<0||jx>=gx||jy>=gy)continue;
      for(let j=head[jy*gx+jx];j>=0;j=next[j]){if(k===0&&j<=i)continue;
        const dx=P[j].x-a.x,dy=P[j].y-a.y;if(dx*dx+dy*dy>=kh2)continue;
        if(np>=W.pi.length){const g=2*W.pi.length;const a1=new Int32Array(g),a2=new Int32Array(g);a1.set(W.pi);a2.set(W.pj);W.pi=a1;W.pj=a2;}
        W.pi[np]=i;W.pj[np]=j;np++;}}}
  W.np=np;return W;
}
function fluid(b,dt){
  const P=b.parts,n=P.length,kh=b.kh,kh2=kh*kh,F=FLUID,rho0=b.rho0,eps=F.EPS*b.den0;
  const wq=kh2-.04*kh2,wq3=wq*wq*wq,sk=F.SCORR_K/b.den0; // artificial pressure: reference distance 0.2 h
  const W=b.work||buildPairs(b);
  for(let i=0;i<n;i++){const q=P[i];q.vy-=G*dt;W.px[i]=q.x;W.py[i]=q.y;q.x+=q.vx*dt;q.y+=q.vy*dt;}
  buildPairs(b);
  const rho=W.rho,lam=W.rhn,GX=W.dx,GY=W.dy;
  for(let it=0;it<F.ITER;it++){
    // density, and the gradient of the density constraint (sum vector and sum of squares per particle)
    const sq=lam;for(let i=0;i<n;i++){rho[i]=kh2*kh2*kh2;GX[i]=0;GY[i]=0;sq[i]=0;}
    // walls: density from the rows of particles a wall stands for, and its gradient (pointing into the water)
    {const c=dcos(b.th),si=dsin(b.th),pl=b.planes,WT=b.wrho.length-1;
     for(let i=0;i<n;i++){const wx=P[i].x-b.x,wy=P[i].y-b.y,lx=c*wx+si*wy,ly=-si*wx+c*wy;
      for(let k=0;k<pl.length;k++){const L=pl[k];let d=(lx-L.qx)*L.nx+(ly-L.qy)*L.ny;if(d>=kh)continue;if(d<0)d=0;
        const f=d/kh*WT,t0=Math.floor(f),t1=t0<WT?t0+1:WT,a=f-t0,wr=b.wrho[t0]*(1-a)+b.wrho[t1]*a,wg=b.wgrad[t0]*(1-a)+b.wgrad[t1]*a;
        const nx=c*L.nx-si*L.ny,ny=si*L.nx+c*L.ny;rho[i]+=wr;GX[i]-=wg*nx;GY[i]-=wg*ny;sq[i]+=wg*wg;}}}
    for(let k=0;k<W.np;k++){const i=W.pi[k],j=W.pj[k];const dx=P[j].x-P[i].x,dy=P[j].y-P[i].y,r2=dx*dx+dy*dy;if(r2>=kh2)continue;
      const u=kh2-r2,w=u*u*u;rho[i]+=w;rho[j]+=w;
      const f=6*u*u,gx=f*dx,gy=f*dy,gg=f*f*r2; // gradient of W(x_i-x_j) with respect to x_i, pointing from i towards j
      GX[i]+=gx;GY[i]+=gy;GX[j]-=gx;GY[j]-=gy;sq[i]+=gg;sq[j]+=gg;}
    // lambda: how far to move along the gradient to restore the rest density (and, down to CMIN, where it is stretched)
    for(let i=0;i<n;i++){const C0=rho[i]/rho0-1,C=C0>F.CMIN?C0:F.CMIN;lam[i]=C!==0?-C/((GX[i]*GX[i]+GY[i]*GY[i]+sq[i])/(rho0*rho0)+eps):0;}
    for(let i=0;i<n;i++){GX[i]=0;GY[i]=0;}
    for(let k=0;k<W.np;k++){const i=W.pi[k],j=W.pj[k];const dx=P[j].x-P[i].x,dy=P[j].y-P[i].y,r2=dx*dx+dy*dy;if(r2>=kh2)continue;
      const u=kh2-r2,w=u*u*u/wq3,w2=w*w,corr=-sk*w2*w2;
      const f=6*u*u*(lam[i]+lam[j]+corr)/rho0;GX[i]+=f*dx;GY[i]+=f*dy;GX[j]-=f*dx;GY[j]-=f*dy;}
    {const c=dcos(b.th),si=dsin(b.th),pl=b.planes,WT=b.wrho.length-1;
     for(let i=0;i<n;i++){if(lam[i]>=0)continue; // a wall only pushes: cohesion must not glue water to it
      const wx=P[i].x-b.x,wy=P[i].y-b.y,lx=c*wx+si*wy,ly=-si*wx+c*wy;
      for(let k=0;k<pl.length;k++){const L=pl[k];let d=(lx-L.qx)*L.nx+(ly-L.qy)*L.ny;if(d>=kh)continue;if(d<0)d=0;
        const f=d/kh*WT,t0=Math.floor(f),t1=t0<WT?t0+1:WT,a=f-t0,wg=b.wgrad[t0]*(1-a)+b.wgrad[t1]*a;
        const nx=c*L.nx-si*L.ny,ny=si*L.nx+c*L.ny,m=-lam[i]*wg/rho0;GX[i]+=m*nx;GY[i]+=m*ny;
        // the wall pushes the water, so the water pushes the bottle back: equal and opposite impulse at the particle
        const jx=-b.mp*m*nx/dt,jy=-b.mp*m*ny/dt;applyJ(b,P[i].x-b.x,P[i].y-b.y,jx,jy);}}}
    for(let i=0;i<n;i++){P[i].x+=GX[i];P[i].y+=GY[i];}
  }
  for(let i=0;i<n;i++){const q=P[i];q.vx=(q.x-W.px[i])/dt;q.vy=(q.y-W.py[i])/dt;}
  // XSPH: nudge each velocity towards its neighbours' (pairwise, so momentum is kept)
  if(F.XSPH)for(let k=0;k<W.np;k++){const a=P[W.pi[k]],o=P[W.pj[k]];const dx=o.x-a.x,dy=o.y-a.y,r2=dx*dx+dy*dy;if(r2>=kh2)continue;
    const u=(kh2-r2)/kh2,w=F.XSPH*u*u*u*.5,ex=(o.vx-a.vx)*w,ey=(o.vy-a.vy)*w;a.vx+=ex;a.vy+=ey;o.vx-=ex;o.vy-=ey;}
}
function step(b){
  if(b.done)return;
  const dt=DT;
  b.vy-=G*dt; b.x+=b.vx*dt; b.y+=b.vy*dt; b.th+=b.w*dt;
  const P=b.parts, n=P.length;
  // water: relax positions towards the rest density, then viscosity between approaching neighbours
  if(n)fluid(b,dt);
  // particle-wall and floor contacts, iterated so the stiff water/shell/floor chain converges
  const c=dcos(b.th),si=dsin(b.th);
  let contact=false;
  const W=[];let minD=1e9;const fnx=b.fnx,fny=b.fny,ftx=fny,fty=-fnx; // normal and tangent of the surface
  for(const[vx,vy]of b.verts){const rx=c*vx-si*vy,ry=si*vx+c*vy;const dn=(b.x+rx)*fnx+(b.y+ry)*fny;W.push([rx,ry,dn]);if(dn<minD)minD=dn;}
  if(!b.spring&&minD<0){b.x-=minD*fnx;b.y-=minD*fny;for(const v of W)v[2]-=minD;for(const q of P){q.x-=minD*fnx;q.y-=minD*fny;}} // the water moves with the bottle
  // particle-wall contacts: positions do not change inside the iterations, so find the touching pairs once
  const CT=b.ct||(b.ct={p:new Int32Array(n*3+8),nx:new Float64Array(n*3+8),ny:new Float64Array(n*3+8),rx:new Float64Array(n*3+8),ry:new Float64Array(n*3+8),d:new Float64Array(n*3+8)});
  let nc=0;const pl=b.planes,rp=b.rp,inX=b.Ri-rp,inLo=-b.cy+rp,inHi=b.hs-b.cy-rp;
  for(let i=0;i<n;i++){const q=P[i],wx=q.x-b.x,wy=q.y-b.y,lx=c*wx+si*wy,ly=-si*wx+c*wy;q.lx=lx;q.ly=ly;
    if(lx>-inX&&lx<inX&&ly>inLo&&ly<inHi)continue; // well inside the straight part of the body: touches no wall
    for(let k=0;k<pl.length;k++){const L=pl[k];const d=(lx-L.qx)*L.nx+(ly-L.qy)*L.ny-rp;if(d>=0)continue;
      if(nc>=CT.p.length)break;
      CT.p[nc]=i;CT.nx[nc]=c*L.nx-si*L.ny;CT.ny[nc]=si*L.nx+c*L.ny;CT.rx[nc]=c*lx-si*ly;CT.ry[nc]=si*lx+c*ly;CT.d[nc]=d;nc++;}}
  const kmp=1/b.mp,kM=1/b.M,kI=1/b.I;
  for(let iter=0;iter<ITERS;iter++){
  for(let m=0;m<nc;m++){const q=P[CT.p[m]],nx=CT.nx[m],ny=CT.ny[m],rx=CT.rx[m],ry=CT.ry[m];
      const vpx=b.vx-b.w*ry, vpy=b.vy+b.w*rx;
      let rvx=q.vx-vpx,rvy=q.vy-vpy, vn=rvx*nx+rvy*ny;
      // the contact only stops motion into the wall; the overlap is removed by moving the particle (below), which adds no energy
      const target=0;
      if(vn<target){const rn=rx*ny-ry*nx,k=kmp+kM+rn*rn*kI,j=(target-vn)/k;
        q.vx+=j*nx*kmp;q.vy+=j*ny*kmp;applyJ(b,rx,ry,-j*nx,-j*ny);
        rvx=q.vx-(b.vx-b.w*ry);rvy=q.vy-(b.vy+b.w*rx);}
      const tx=-ny,ty=nx,vt=rvx*tx+rvy*ty,rt=rx*ty-ry*tx,kt=kmp+kM+rt*rt*kI,jt=-vt*FLUID.WALL_MU*dt/ITERS/kt;
      q.vx+=jt*tx*kmp;q.vy+=jt*ty*kmp;applyJ(b,rx,ry,-jt*tx,-jt*ty);
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
    else{const kt=1/b.M+rt*rt/b.I;let jt=-vt/kt;const lim=b.mu*(b.M+n*b.mp)*G*dt*2; /* resting friction carries the water weight too */if(jt>lim)jt=lim;if(jt<-lim)jt=-lim;applyJ(b,rx,ry,jt*ftx,jt*fty);}
  }
  }
  for(let m=0;m<nc;m++){const q=P[CT.p[m]];q.x-=CT.d[m]*CT.nx[m];q.y-=CT.d[m]*CT.ny[m];}
  // stable only if the whole system's centre of mass sits over the points touching the surface
  let stable=false;
  if(contact){let lo=1e9,hi=-1e9;for(const[rx,ry]of W){const dn=(b.x+rx)*fnx+(b.y+ry)*fny;if(dn<=(b.spring?0:6e-3)){const tproj=(b.x+rx)*ftx+(b.y+ry)*fty;lo=Math.min(lo,tproj);hi=Math.max(hi,tproj);}}
    let cx=b.M*b.x,cy2=b.M*b.y,mt=b.M;for(const q of P){cx+=b.mp*q.x;cy2+=b.mp*q.y;mt+=b.mp;}cx/=mt;cy2/=mt;const ct=cx*ftx+cy2*fty;stable=ct>=lo-1e-3&&ct<=hi+1e-3;}
  b.stable=stable;
  if(contact){const nearRest=stable&&dhyp(b.vx,b.vy)<.15&&Math.abs(b.w)<1.5;const dmp=1-(nearRest?10:2.5)*dt;
    // settle damping acts on spin and the normal component; along the slope only when friction can actually hold the bottle
    const vn=b.vx*fnx+b.vy*fny,vt=b.vx*ftx+b.vy*fty,holds=b.mu>=dtan(Math.abs(b.phi))*1.05;const dmpT=holds?dmp:1-2.5*dt;
    const vn2=vn*dmp,vt2=vt*dmpT;b.vx=vn2*fnx+vt2*ftx;b.vy=vn2*fny+vt2*fty;b.w*=dmp;
  }
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
export{FLUID,G,DT,makeBottle,step,judge,difficulty,LEVELS,levelPasses};
