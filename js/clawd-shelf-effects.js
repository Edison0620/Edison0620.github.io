'use strict';

(function() {
  if (window.ClawdShelfEffects) return;

  window.ClawdShelfEffects = function createClawdShelfEffects(physics, maxImpactBursts = 8) {
    if (!physics) return null;

  const shelfList = document.querySelector('[data-douban-list]');
  if (!shelfList) return null;
  const surfaceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const tears = new Map();
  const spinningVinyl = new Map();
  const musicEffects = window.ClawdMusicEffects();
  function prepareMusic() {
    if (!surfaceMotion.matches && document.querySelector('[data-douban-kind="music"][aria-pressed="true"]')) {
      musicEffects.prepare();
    }
  }
  document.addEventListener('carver:doubanchange', prepareMusic);
  document.addEventListener('carver:accentchange', musicEffects.updatePalette);
  document.addEventListener('carver:themechange', musicEffects.updatePalette);
  surfaceMotion.addEventListener('change', prepareMusic);
  prepareMusic();
  const paperStress = new WeakMap();
  const peelThreshold = 3.65;
  const peelSeconds = .19;
  const fallSeconds = .71;
  const slotWait = .24;
  const feedSeconds = .58;
  const sources = new WeakMap();
  const waterLayers = new WeakMap();
  const paintedLayers = new Set();
  const renderedWaterCards = new Set();
  function clearSurfaceLayers() {
    renderedWaterCards.clear();
    for (const layer of paintedLayers) layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    paintedLayers.clear();
  }
  let surfaceTargets = [];
  let water;
  const limit = (n, min, max) => Math.max(min, Math.min(max, n));

  function prepareWater(img) {
    let source = sources.get(img);
    if (source) return source;
    source = new Image();
    source.crossOrigin = 'anonymous';
    source.src = img.currentSrc || img.src;
    sources.set(img, source);
    return source;
  }

  if (shelfList) shelfList.addEventListener('load', event => {
    if (event.target.matches('.douban-item--game .douban-item__cover')) prepareWater(event.target);
  }, true);
  function stopPaperCurl(link, state) {
    tears.delete(link);
    delete link.dataset.previewCurlActive;
    delete link.dataset.previewPaperDetached;
    state.shell.remove();
    state.slot?.remove();
    state.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  function clearPaperCurls() {
    for (const [link, state] of tears) stopPaperCurl(link, state);
  }
  surfaceMotion.addEventListener('change', () => {
    if (surfaceMotion.matches) clearPaperCurls();
  });

  function updateMaterialTargets() {
    surfaceTargets = [];
    const kind = document.querySelector('[data-douban-kind][aria-pressed="true"]')?.dataset.doubanKind;
    for (const link of shelfList.querySelectorAll('.douban-item__cover-link')) {
      const image = link.querySelector('img');
      if (kind === 'book') {
        if (!image?.naturalWidth) continue;
        const box = image.getBoundingClientRect();
        const px = 5 * box.width / image.offsetWidth, py = 5 * box.height / image.offsetHeight;
        const r = {left:box.left-px,right:box.right+px,top:box.top-py,bottom:box.bottom+py,
          width:box.width+2*px,height:box.height+2*py};
        if (r.bottom > 0 && r.top < innerHeight) surfaceTargets.push({kind,link,image,r});
        continue;
      }
      if (!image?.naturalWidth || link.classList.contains('is-ticket-torn')) continue;
      if (kind === 'movie' && tears.get(link)?.release) continue;
      const r = link.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) continue;
      if (kind === 'music') {
        const disc = getComputedStyle(link, '::before');
        const radius = parseFloat(disc.width) / 2 + parseFloat(disc.borderLeftWidth);
        const offset = disc.transform === 'none' ? 0 : new DOMMatrixReadOnly(disc.transform).e;
        const cx = r.left + parseFloat(disc.left) + radius + offset;
        const cy = r.top + parseFloat(disc.top) + radius;
        surfaceTargets.push({kind, link, r, jacket:image.getBoundingClientRect(), cx, cy, radius});
        continue;
      }
      const stub = kind === 'movie' ? link.querySelector('.douban-item__ticket-stub') : null;
      const rect = stub ? stub.getBoundingClientRect() : null;
      if (kind === 'game') {
        const card = link.closest('.douban-item');
        surfaceTargets.push({kind, link, image, card, r: card.getBoundingClientRect()});
        continue;
      }
      surfaceTargets.push({kind, link, image, r, stub, rect});
    }
  }

  function traceBox(x, y, dx, dy, left, top, right, bottom) {
    const ax = dx ? (left - x) / dx : x >= left && x <= right ? -Infinity : Infinity;
    const bx = dx ? (right - x) / dx : x >= left && x <= right ? Infinity : -Infinity;
    const ay = dy ? (top - y) / dy : y >= top && y <= bottom ? -Infinity : Infinity;
    const by = dy ? (bottom - y) / dy : y >= top && y <= bottom ? Infinity : -Infinity;
    if ((!dx && ax === Infinity) || (!dy && ay === Infinity)) return Infinity;
    const enter = Math.max(0, Math.min(ax, bx), Math.min(ay, by));
    return enter <= Math.min(1, Math.max(ax, bx), Math.max(ay, by)) ? enter : Infinity;
  }

  function traceVinyl(target, x, y, dx, dy) {
    const px = x - target.cx, py = y - target.cy;
    const a = dx * dx + dy * dy, b = px * dx + py * dy;
    const c = px * px + py * py - target.radius ** 2;
    const disc = b * b - a * c;
    if (disc < 0) return Infinity;
    const root = Math.sqrt(disc);
    const t = Math.max(0, (-b - root) / a);
    return t <= Math.min(1, (-b + root) / a) ? t : Infinity;
  }

  function kickVinyl(link, now, tangent, strength) {
    let state = spinningVinyl.get(link);
    if (!state) {
      state = {at:now, angle:parseFloat(link.style.getPropertyValue('--preview-vinyl-spin')) || 0, omega:0};
      spinningVinyl.set(link, state);
    }
    state.omega = limit(state.omega + 490 * tangent * strength, -620, 620);
  }

  function clearVinyl() {
    for (const link of spinningVinyl.keys()) {
      link.style.removeProperty('--preview-vinyl-recoil');
      link.style.removeProperty('--preview-vinyl-tilt');
    }
    spinningVinyl.clear();
    musicEffects.clear();
  }

  function stepVinyl(now) {
    for (const [link, state] of spinningVinyl) {
      if (!link.isConnected) { spinningVinyl.delete(link); continue; }
      const dt = Math.max(0, now-state.at) / 1000;
      const damping = Math.exp(-6 * dt);
      state.at = now;
      state.angle = (state.angle + state.omega * (1-damping) / 6) % 360;
      state.omega *= damping;
      if (Math.abs(state.omega) < 2) spinningVinyl.delete(link);
      link.style.setProperty('--preview-vinyl-spin', `${state.angle}deg`);
    }
    musicEffects.step(now);
  }

  const waterGravity=1800;
  function addWaterContact(state,at,bursts) {
    const target=surfaceTargets.find(candidate=>candidate.kind==='game'&&candidate.card.isConnected&&
      state.x>=candidate.r.left&&state.x<=candidate.r.right&&state.y>=candidate.r.top&&state.y<=candidate.r.bottom);
    if(!target) return false;
    state.target=target;
    state.texture=prepareWater(target.image);
    const r=target.r;
    let count=0,oldest=-1;
    for(let i=0;i<bursts.length;i++) if(bursts[i].kind==='game') {
      if(oldest<0) oldest=i;
      count++;
    }
    if(count>=20) bursts.splice(oldest,1);
    if(bursts.length>=maxImpactBursts+20) bursts.shift();
    bursts.push({kind:'game',target:state.target,texture:state.texture,at,duration:960,
      u:(state.x-r.left)/r.width,v:(state.y-r.top)/r.height,energy:state.energy,nx:state.nx,ny:state.ny});
    return true;
  }
  function stepWaterSkip(bullet,dt,now,bursts) {
    const s=bullet.waterSkip;
    if(surfaceMotion.matches||!s.target.card.isConnected) return false;
    if(s.sinking!==undefined) {
      s.sinking+=dt;
      const progress=Math.min(s.sinking/.16,1);
      const travel=s.speed*(1-Math.exp(-22*s.sinking))/22;
      bullet.x=s.x+s.nx*travel;
      bullet.y=s.y+s.ny*travel+7*progress*progress;
      bullet.life=bullet.maxLife*.5*(1-progress);
      return progress<1;
    }
    s.elapsed+=dt;
    while(s.elapsed>=s.duration) {
      s.x+=s.nx*s.speed*s.duration;s.y+=s.ny*s.speed*s.duration;
      s.elapsed-=s.duration;s.contacts++;
      const incidence=s.lift/s.speed;
      s.speed*=.90-.24*Math.min(incidence,1);
      s.lift*=.78;
      s.energy=s.lift/224;
      if(!addWaterContact(s,now-s.elapsed*1000,bursts)) return false;
      if(s.speed<260||s.lift<35||incidence>.55) {
        s.sinking=0;
        bullet.x=s.x;bullet.y=s.y;
        return true;
      }
      s.duration=2*s.lift/waterGravity;
    }
    const x=s.x+s.nx*s.speed*s.elapsed,y=s.y+s.ny*s.speed*s.elapsed;
    bullet.x=x;bullet.y=y-(s.lift*s.elapsed-.5*waterGravity*s.elapsed*s.elapsed);
    return true;
  }

  function hitMaterial(bullet, x, y, now, bursts) {
    const dx = bullet.x - x, dy = bullet.y - y;
    if (!dx && !dy) return false;
    let nearest = Infinity, target, vinyl;
    for (const candidate of surfaceTargets) {
      if (candidate.kind === 'movie' && tears.get(candidate.link)?.release) continue;
      const {r} = candidate;
      if (candidate.kind === 'music') {
        const {jacket} = candidate;
        const cover = traceBox(x,y,dx,dy,jacket.left,jacket.top,jacket.right,jacket.bottom);
        const groove = traceVinyl(candidate,x,y,dx,dy);
        const hit = Math.min(cover,groove);
        if (hit < nearest) { nearest = hit; target = candidate; vinyl = groove < cover; }
      } else {
        const hit = traceBox(x, y, dx, dy, r.left, r.top, r.right, r.bottom);
        if (hit < nearest) { nearest = hit; target = candidate; vinyl = false; }
      }
    }
    if (!target) return false;
    const hx = x + dx * nearest, hy = y + dy * nearest;
    const {kind, r, rect} = target;
    const bulletAngle = Math.atan2(dy, dx);
    if (kind === 'music') {
      if (bursts.length >= maxImpactBursts) bursts.shift();
      if (!vinyl) {
        if (!surfaceMotion.matches) {
          const travel=Math.hypot(dx,dy);
          const armX=hx-(target.jacket.left+target.jacket.right)/2;
          const armY=hy-(target.jacket.top+target.jacket.bottom)/2;
          const torque=limit((armX*dy-armY*dx)/(target.radius*travel),-1,1);
          const strength=limit(Math.hypot(bullet.vx,bullet.vy)/physics.CONSTANTS.bulletSpeed,0,1);
          kickVinyl(target.link,now,torque,strength*.34);
        }
        const impact = {kind,target,x:hx,y:hy,angle:bulletAngle,at:now,duration:160};
        bursts.push(impact);
        if (!surfaceMotion.matches) musicEffects.kick(impact,bullet,now,bursts);
        return true;
      }
      const speed = Math.hypot(dx,dy);
      const radius = Math.hypot(hx-target.cx,hy-target.cy) || target.radius;
      const nx = (hx-target.cx)/radius, ny = (hy-target.cy)/radius;
      const tangent = (nx*dy-ny*dx)/speed;
      const strength = limit(Math.hypot(bullet.vx,bullet.vy)/physics.CONSTANTS.bulletSpeed,0,1);
      if (!surfaceMotion.matches) kickVinyl(target.link,now,tangent,strength);
      const impact = {kind,target,x:hx,y:hy,angle:bulletAngle,at:now,duration:160};
      bursts.push(impact);
      if (!surfaceMotion.matches) musicEffects.kick(impact,bullet,now,bursts);
      return true;
    }
    if (kind === 'book') {
      const strength = limit(Math.hypot(bullet.vx,bullet.vy)/physics.CONSTANTS.bulletSpeed,0,1);
      return !kickBook(target,bullet,hx,hy,bulletAngle,strength,now);
    }
    const hit = {kind, target, at: now, duration: kind === 'game' ? 960 : 440,
      u: (hx - r.left) / r.width, v: (hy - r.top) / r.height, angle: bulletAngle};
    if (kind === 'game') {
      if(surfaceMotion.matches) return false;
      const nx=Math.cos(bulletAngle),ny=Math.sin(bulletAngle);
      const lift=bullet.skipLift ?? 224;
      const state={target,texture:prepareWater(target.image),x:hx+nx*2,y:hy+ny*2,
        nx,ny,speed:Math.hypot(bullet.vx,bullet.vy),lift,duration:2*lift/waterGravity,
        elapsed:0,contacts:1,energy:(lift/224)**2};
      if(!addWaterContact(state,now,bursts)) return false;
      bullet.waterSkip=state;
      bullet.x=state.x;bullet.y=state.y;
      return false;
    } else if (kind === 'movie') {
      const seam = rect ? limit(1 - Math.abs(hy - rect.top) / 27, 0, 1) : 0;
      kickPaper(target.link, hit, seam, Math.hypot(bullet.vx, bullet.vy));
    }
    if (bursts.length >= maxImpactBursts) bursts.shift();
    bursts.push(hit);
    return kind === 'movie';
  }

  function paperMesh(link) {
    const w=link.clientWidth,h=link.clientHeight,pad=28;
    const shell=document.createElement('canvas');
    shell.dataset.previewPaperCurl='';
    shell.setAttribute('aria-hidden','true');
    shell.width=(w+pad*2)*2; shell.height=(h+pad*2)*2;
    Object.assign(shell.style,{inset:`-${pad}px`,width:`${w+pad*2}px`,height:`${h+pad*2}px`});
    const gl=shell.getContext('webgl',{antialias:true,premultipliedAlpha:false});
    if (!gl) return null;
    const art=document.createElement('canvas');
    art.width=w*2; art.height=h*2;
    const ctx=art.getContext('2d');
    ctx.scale(2,2);
    const style=getComputedStyle(link);
    const img=link.querySelector('img');
    const posterHeight=img.clientHeight;
    const scale=Math.max(w/img.naturalWidth,posterHeight/img.naturalHeight);
    const sw=w/scale,sh=posterHeight/scale;
    ctx.fillStyle=style.getPropertyValue('--ticket-paper').trim() || '#ddd';
    ctx.fill(new Path2D('M0 0H96V136C92 136 90 138 90 141V142H6V141C6 138 4 136 0 136Z M6 142H90C90 144.7 92 146 96 146V165H0V146C4 146 6 144.7 6 142Z'));
    ctx.drawImage(img,(img.naturalWidth-sw)/2,(img.naturalHeight-sh)/2,sw,sh,0,0,w,posterHeight);
    const code=link.querySelector('.douban-item__ticket-code');
    ctx.fillStyle=style.getPropertyValue('--ticket-ink').trim() || '#222';
    for(let i=8;i<89;i+=4) ctx.fillRect(i,141,2,1);
    if(code?.firstElementChild) {
      const [, ,cw,ch]=code.getAttribute('viewBox').split(' ').map(Number);
      const s=Math.min(84/cw,14/ch);
      ctx.save();ctx.translate(6+(84-cw*s)/2,145+(14-ch*s)/2);ctx.scale(s,s);
      ctx.fill(new Path2D(code.firstElementChild.getAttribute('d')));
      ctx.restore();
    }
    const program=gl.createProgram();
    for(const [type,src] of [
      [gl.VERTEX_SHADER,'attribute vec2 p; attribute vec2 uv; attribute float light; varying vec2 t; varying float l; void main(){gl_Position=vec4(p,0.,1.);t=uv;l=light;}'],
      [gl.FRAGMENT_SHADER,'precision mediump float; uniform sampler2D art; varying vec2 t; varying float l; void main(){vec4 c=texture2D(art,t);gl_FragColor=vec4(c.rgb*l,c.a);}']
    ]) {
      const shader=gl.createShader(type);gl.shaderSource(shader,src);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) return null;
      gl.attachShader(program,shader);gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)) return null;
    gl.useProgram(program);
    gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    try {gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,art);} catch {return null;}
    const n=18, stride=n+1, vertices=new Float32Array(stride*stride*5),indices=[];
    for(let y=0;y<n;y++) for(let x=0;x<n;x++) {
      const a=y*stride+x;indices.push(a,a+1,a+stride,a+1,a+stride+1,a+stride);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER,vertices.byteLength,gl.DYNAMIC_DRAW);
    for(const [name,size,offset] of [['p',2,0],['uv',2,8],['light',1,16]]) {
      const attr=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(attr);
      gl.vertexAttribPointer(attr,size,gl.FLOAT,false,20,offset);
    }
    return {shell,w,h,pad,gl,n,vertices,count:indices.length,impulses:[]};
  }

  function kickPaper(link, hit, seam, speed) {
    if (surfaceMotion.matches) return;
    let state=tears.get(link);
    if (state?.release) return;
    if(!state) {
      state=paperMesh(link);
      if(!state) return;
      tears.set(link,state);
      link.dataset.previewCurlActive='';
      link.append(state.shell);
    }
    const nx=Math.cos(hit.angle),ny=Math.sin(hit.angle);
    const vertical=Math.abs(ny)>Math.abs(nx);
    const side=vertical ? (ny>0 ? 0 : 1) : (nx>0 ? 2 : 3);
    const impact=limit(speed/physics.CONSTANTS.bulletSpeed,0,1);
    let stress=paperStress.get(link);
    if (!stress) {
      stress={at:hit.at,edges:[0,0,0,0]};
      paperStress.set(link,stress);
    }
    const decay=Math.exp(-(hit.at-stress.at)/940);
    for(let i=0;i<4;i++) stress.edges[i]*=decay;
    stress.at=hit.at;
    const load=stress.edges[side]+impact*(.72+.55*seam);
    stress.edges[side]=load;
    const power=limit(impact,.35,1)*(.62+.95*seam)*(1+.28*limit(load/peelThreshold,0,1));
    state.impulses.push({at:hit.at,power,u:hit.u,v:hit.v,nx,ny});
    if(load>=peelThreshold) {
      const torque=(hit.u-.5)*ny-(hit.v-.5)*nx;
      const flip=vertical ? nx : ny;
      state.release={at:hit.at,nx,ny,spin:limit(torque*210+flip*24,-125,125),impact};
      paperStress.delete(link);
      link.dataset.previewPaperDetached='';
    }
    if(state.impulses.length>16) state.impulses.shift();
  }

  function stepPaperCurls(now) {
    for(const [link,state] of tears) {
      const {gl,w,h,pad,n,vertices,impulses,count}=state;
      while(impulses.length&&now-impulses[0].at>470) impulses.shift();
      const release=state.release;
      const age=release ? (now-release.at)/1000 : 0;
      const afterFall=age-peelSeconds-fallSeconds;
      const feedAge=afterFall-slotWait;
      if(!link.isConnected||link.classList.contains('is-ticket-torn')||
          (!release&&!impulses.length)||(release&&feedAge>=feedSeconds)||gl.isContextLost()) {
        stopPaperCurl(link,state);continue;
      }
      if(release && afterFall>=0) {
        if(feedAge<0) {
          state.shell.style.visibility='hidden';
          continue;
        }
        drawTicketFeed(link,state,feedAge/feedSeconds);
        continue;
      }
      if(release) {
        const t=Math.max(0,age-peelSeconds);
        const flight=-Math.expm1(-1.9*t)/1.9;
        const dx=release.nx*182*release.impact*flight;
        const dy=(release.ny*122*release.impact-36)*flight+470*t*t;
        state.shell.style.transform=`translate(${dx}px,${dy}px) rotate(${release.spin*flight}deg)`;
        // Let gravity carry the paper out before handing off the final frame.
        state.shell.style.opacity=1-limit((t-.53)/.18,0,1);
        state.shell.style.filter=`drop-shadow(${2+7*t}px ${3+11*t}px ${3+5*t}px #0004)`;
      }
      let i=0;
      for(let row=0;row<=n;row++) for(let col=0;col<=n;col++) {
        const u=col/n,v=row/n,x=u*w,y=v*h;
        let px=x,py=y,z=0,light=1;
        for(const hit of impulses) {
          const {nx,ny}=hit;
          const span=Math.abs(nx)*w+Math.abs(ny)*h;
          const d=Math.max(0,span/2-(x-w/2)*nx-(y-h/2)*ny);
          const traveled=Math.hypot((u-hit.u)*w,(v-hit.v)*h);
          const t=(now-hit.at)/1000+.009-traveled*.00028;
          if(t<=0) continue;
          const b=hit.power*Math.exp(-10*t)*Math.sin(31*t);
          if(Math.abs(b)<.001) continue;
          const a=b*d/span,r=span/b,slide=d-r*Math.sin(a);
          px+=slide*nx;py+=slide*ny;z+=r*(1-Math.cos(a));light+=.22*Math.sin(a);
        }
        if(release) {
          const {nx,ny}=release;
          const span=Math.abs(nx)*w+Math.abs(ny)*h;
          const along=.5+((x-w/2)*nx+(y-h/2)*ny)/span;
          const front=limit(age/peelSeconds,0,1)*1.34;
          const q=limit((front-along)/.34,0,1);
          const loosened=q*q*(3-2*q);
          const free=Math.max(0,age-peelSeconds);
          const lift=loosened*(12+15*(1-along))*Math.exp(-5.2*free);
          px+=loosened*nx*(5+8*(1-along));
          py+=loosened*(ny*(5+8*(1-along))-4);
          z+=lift;
          light+=.16*loosened*(1-along);
        }
        const perspective=340/(340-limit(z,-18,75));
        vertices[i++]=((px-w/2)*perspective)/(w/2+pad);
        vertices[i++]=-((py-h/2)*perspective)/(h/2+pad);
        vertices[i++]=u;vertices[i++]=v;vertices[i++]=limit(light,.68,1.3);
      }
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bufferSubData(gl.ARRAY_BUFFER,0,vertices);
      gl.drawElements(gl.TRIANGLES,count,gl.UNSIGNED_SHORT,0);
    }
  }

  function drawTicketFeed(link,state,p) {
    const {gl,w,h,pad,n,vertices,count,shell}=state;
    if(!state.slot) {
      const slot=document.createElement('span');
      slot.dataset.previewTicketSlot='';
      slot.setAttribute('aria-hidden','true');
      link.append(slot);
      state.slot=slot;
      shell.style.visibility='visible';
      shell.style.removeProperty('transform');
      shell.style.removeProperty('filter');
    }
    const travel=p*p*(3-2*p);
    // Small speed pulses model the rollers without moving the paper backwards.
    const feed=travel+Math.sin(travel*Math.PI*12)*.012;
    const settle=Math.sin(Math.PI*p);
    state.slot.style.opacity=Math.min(1,p*18,(1-p)*10);
    state.slot.style.setProperty('--preview-crack-open',Math.min(1,p*9,(1-p)*7));
    shell.style.opacity=Math.min(1,p*10);
    let i=0;
    for(let row=0;row<=n;row++) {
      const v=row/n;
      const y=(v-1+feed)*h;
      const curl=9*settle*(Math.max(0,y)/h)**2;
      const shade=1-.25*Math.exp(-Math.max(0,y)/9)*settle;
      const perspective=340/(340-curl);
      for(let col=0;col<=n;col++) {
        const u=col/n;
        vertices[i++]=(u*w-w/2)*perspective/(w/2+pad);
        vertices[i++]=-(y-h/2)*perspective/(h/2+pad);
        vertices[i++]=u;vertices[i++]=v;vertices[i++]=shade;
      }
    }
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0,pad*2,shell.width,h*2);
    gl.bufferSubData(gl.ARRAY_BUFFER,0,vertices);
    gl.drawElements(gl.TRIANGLES,count,gl.UNSIGNED_SHORT,0);
    gl.disable(gl.SCISSOR_TEST);
  }

  function waterRenderer() {
    if (water !== undefined) return water;
    water = null;
    const canvas = document.createElement('canvas');
    canvas.width = 480; canvas.height = 272;
    const gl = canvas.getContext('webgl', {alpha:true, premultipliedAlpha:false, antialias:false});
    if (!gl) return null;
    const compile = (type, code) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, code);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    try {
      const vert = compile(gl.VERTEX_SHADER, `attribute vec2 pos;
        varying vec2 uv;
        void main(){gl_Position=vec4(pos,0.,1.);uv=vec2(.5)+pos*vec2(.5,-.5);}`);
      const frag = compile(gl.FRAGMENT_SHADER, `precision mediump float;
        varying vec2 uv;
        uniform sampler2D cover;
        uniform vec2 size;
        uniform vec4 waves[20];
        uniform int waveCount;
        void main(){
          vec2 off=vec2(0.);
          float opacity=0.,light=0.;
          for(int i=0;i<20;i++){
            if(i>=waveCount) break;
            vec2 p=(uv-waves[i].xy)*size;
            p.x*=.59;
            float age=waves[i].z,energy=waves[i].w;
            float phase=length(p)-age*360.;
            float envelope=energy*exp(-.006*phase*phase)*exp(-age*2.3)*smoothstep(0.,.024,age);
            off+=normalize(p+vec2(.0001))*sin(phase*.26)*envelope*16./size;
            opacity+=envelope*4.;
            light+=cos(phase*.41)*envelope*.10;
          }
          vec2 border=min(uv,1.-uv)*size;
          float mask=smoothstep(0.,1.1,min(border.x,border.y));
          vec3 col=texture2D(cover,clamp(uv+clamp(off,vec2(-.08),vec2(.08)),0.,1.)).rgb;
          gl_FragColor=vec4(col+clamp(light,-.15,.15),mask*clamp(opacity,0.,1.));
        }`);
      const program = gl.createProgram();
      gl.attachShader(program, vert); gl.attachShader(program, frag); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
      gl.deleteShader(vert); gl.deleteShader(frag);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
      const pos = gl.getAttribLocation(program, 'pos');
      gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
      const size=gl.getUniformLocation(program,'size');
      const waveLoc=gl.getUniformLocation(program,'waves[0]');
      const countLoc=gl.getUniformLocation(program,'waveCount');
      const waveData=new Float32Array(80);
      const slots=[];
      const makeSlot=() => {
        const tex=document.createElement('canvas');
        tex.width=480; tex.height=272;
        const ctx=tex.getContext('2d');
        const gpu=gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D,gpu);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        return {tex,ctx,gpu};
      };
      water = (img, rect, backdrop, card, hits, now) => {
        if (gl.isContextLost()) return null;
        const aspect=rect.width/rect.height;
        const index=slots.findIndex(s=>s.source===img&&s.aspect===aspect&&s.backdrop===backdrop);
        const slot=index>=0 ? slots.splice(index,1)[0] : slots.length<8 ? makeSlot() : slots.shift();
        slots.push(slot);
        gl.bindTexture(gl.TEXTURE_2D,slot.gpu);
        if (index<0) {
          const scale=Math.max(rect.width/img.naturalWidth,rect.height/img.naturalHeight);
          const zoom=backdrop ? 1.06 : 1.1;
          const w=rect.width/(scale*zoom),h=rect.height/(scale*zoom);
          const sy=(img.naturalHeight-rect.height/scale)*(backdrop ? .45 : .5)+(rect.height/scale-h)/2;
          slot.ctx.clearRect(0,0,480,272);
          slot.ctx.drawImage(img,(img.naturalWidth-w)/2,sy,w,h,0,0,480,272);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,slot.tex);
          slot.source=img; slot.aspect=aspect; slot.backdrop=backdrop;
        }
        let count=0;
        for(const hit of hits) {
          if(hit.kind!=='game'||hit.target.card!==card.element||count===20) continue;
          const age=(now-hit.at)/1000;
          if(age<=0||age>=hit.duration/1000) continue;
          const offset=count++*4;
          waveData[offset]=(card.left+card.width*hit.u-rect.left)/rect.width;
          waveData[offset+1]=(card.top+card.height*hit.v-rect.top)/rect.height;
          waveData[offset+2]=age;waveData[offset+3]=hit.energy;
        }
        gl.uniform4fv(waveLoc,waveData);
        gl.uniform1i(countLoc,count);
        gl.uniform2f(size,rect.width,rect.height);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
        return canvas;
      };
      return water;
    } catch (error) {
      console.warn('Shelf preview could not initialize water refraction:', error);
      return null;
    }
  }

  function backdropLayer(card) {
    let layer=waterLayers.get(card);
    if (layer) return layer;
    const canvas=document.createElement('canvas');
    canvas.dataset.previewWater='';
    canvas.setAttribute('aria-hidden','true');
    const ctx=canvas.getContext('2d');
    if (!ctx) return null;
    card.querySelector('.douban-item__game-backdrop').after(canvas);
    layer={canvas,ctx};
    waterLayers.set(card,layer);
    return layer;
  }

  function drawMaterial(ctx, hit, progress, color) {
    if (hit.kind === 'music') {
      if (hit.comic && hit.target.link.isConnected) musicEffects.draw(ctx, hit, progress, color);
      return;
    }
    const {target, kind} = hit;
    if (!target.link.isConnected) return;
    const rect = target.link.getBoundingClientRect();
    const age = progress * hit.duration / 1000;
    ctx.save();
    ctx.globalAlpha = 1;
    if (kind === 'game') {
      const card=target.card.getBoundingClientRect();
      const x=card.left+card.width*hit.u, y=card.top+card.height*hit.v;
      if (hit.texture.naturalWidth&&!renderedWaterCards.has(target.card)) {
        renderedWaterCards.add(target.card);
        const waveCard={element:target.card,left:card.left,top:card.top,width:card.width,height:card.height};
        const effects=window.__clawdEffects;
        const render=waterRenderer();
        if (render) {
          const layer=backdropLayer(target.card);
          const frame=layer && render(hit.texture,card,true,waveCard,effects.impactBursts,effects.lastFrameTime);
          if (frame) {
            const w=Math.min(720,Math.ceil(card.width)),h=Math.ceil(w*card.height/card.width);
            if(layer.canvas.width!==w || layer.canvas.height!==h) {
              layer.canvas.width=w; layer.canvas.height=h;
            }
            layer.ctx.filter='saturate(.85)';
            layer.ctx.drawImage(frame,0,0,w,h);
            paintedLayers.add(layer);
            hit.backdropDrawn=true;
          }
          const cover=render(hit.texture,rect,false,waveCard,effects.impactBursts,effects.lastFrameTime);
          if (cover) {
            ctx.drawImage(cover,rect.left,rect.top,rect.width,rect.height);
            hit.refractionDrawn=true;
          }
        }
      }
      ctx.beginPath(); ctx.rect(card.left,card.top,card.width,card.height); ctx.clip();
      ctx.translate(x,y);
      ctx.fillStyle = '#daeff5';
      for (let i=0; i<4; i++) {
        const h = -(30 + i*5)*Math.sqrt(hit.energy)*age + 265*age*age;
        if (h>=0) continue;
        const forward=age*(65+i*12)*Math.sqrt(hit.energy),side=(i-1.5)*age*18;
        ctx.globalAlpha = .7 * Math.max(0,1-age*5);
        ctx.beginPath(); ctx.ellipse(hit.nx*forward-hit.ny*side,hit.ny*forward+hit.nx*side+h,.8,1.2,0,0,Math.PI*2); ctx.fill();
      }
    } else {
      ctx.translate(rect.left + rect.width * hit.u, rect.top + rect.height * hit.v);
      for (let i=0; i<5; i++) {
        const t = age-i*.012;
        if (t<=0) continue;
        const drift = -Math.expm1(-t*5)/5;
        const angle = hit.angle + (i-2)*.47;
        ctx.save();
        ctx.globalAlpha = .87 * Math.max(0,1-(t/.42)**2);
        ctx.translate(Math.cos(angle)*(40+i*19)*drift, Math.sin(angle)*(40+i*19)*drift-44*drift+116*t*t);
        ctx.rotate(i+(i%2?-1:1)*t*17);
        ctx.scale(Math.cos(t*16+i),1);
        ctx.fillStyle = i%2 ? '#deb991' : '#f5e5ca';
        ctx.beginPath(); ctx.moveTo(-2,-1); ctx.lineTo(2,-1.5);ctx.lineTo(3,.6);ctx.lineTo(-1,1.4);ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  const bookFlex = new Map();
  function clearBookFlex() {
    for (const layer of bookFlex.values()) layer.canvas.remove();
    bookFlex.clear();
  }
  function kickBook({link,image,r},bullet,hx,hy,direction,strength,now) {
    if (surfaceMotion.matches) return false;
    const w=image.offsetWidth+10,h=image.offsetHeight+10;
    const sx=Math.cos(direction),sy=Math.sin(direction);
    const lx=sx*w/r.width,ly=sy*h/r.height;
    const ratio=Math.hypot(lx,ly),dx=lx/ratio,dy=ly/ratio;
    const x=(hx-r.left)*w/r.width,y=(hy-r.top)*h/r.height;
    const tx=dx>0?(w-x)/dx:dx<0?-x/dx:Infinity;
    const ty=dy>0?(h-y)/dy:dy<0?-y/dy:Infinity;
    const enterX=dx>0?-x/dx:dx<0?(w-x)/dx:-Infinity;
    const enterY=dy>0?-y/dy:dy<0?(h-y)/dy:-Infinity;
    const entry=Math.max(0,enterX,enterY),exit=Math.min(tx,ty);
    // Sample the complete in-cover ray, independent of which edge it entered.
    const length=entry+(exit-entry)*(.1+Math.random()*.8);
    if(length<8) return false;
    let layer=bookFlex.get(link);
    if(!layer) {
      const canvas=document.createElement('canvas');
      canvas.width=w*2;canvas.height=h*2;
      canvas.dataset.previewBookFlex='';
      canvas.setAttribute('aria-hidden','true');
      canvas.style.opacity='.68';
      const ctx=canvas.getContext('2d');
      if(!ctx) return false;
      const settled=document.createElement('canvas');
      settled.width=canvas.width;settled.height=canvas.height;
      const settledCtx=settled.getContext('2d');
      if(!settledCtx) return false;
      layer={canvas,ctx,settled,settledCtx,w,h,hits:[],last:now,dirty:true};
      bookFlex.set(link,layer);
      link.append(canvas);
    }
    bullet.x=hx;bullet.y=hy;
    bullet.bookPaper={link,hx,hy,sx,sy,ratio,x,y,dx,dy,length,distance:0,strength};
    return true;
  }
  function stepBookPaperBullet(bullet,dt) {
    const p=bullet.bookPaper,layer=bookFlex.get(p.link);
    if(!layer||!p.link.isConnected||surfaceMotion.matches) return false;
    p.distance=Math.min(p.length,p.distance+dt*520*p.ratio);
    bullet.x=p.hx+p.sx*p.distance/p.ratio;
    bullet.y=p.hy+p.sy*p.distance/p.ratio;
    if(p.distance<p.length) return true;
    const at=performance.now(),radius=layer.w*(.105+.035*p.strength);
    const hit={x:p.x+p.dx*p.length,y:p.y+p.dy*p.length,
      angle:Math.atan2(p.dy,p.dx),at,radius,grains:[],
      color:window.__clawdEffects.impactColor};
    // Deposit mass is concentrated at impact; smaller fragments travel farther downrange.
    for(let i=0;i<220;i++) {
      const a=Math.random()*Math.PI*2;
      const rr=Math.sqrt(-2*Math.log(Math.max(.001,Math.random())))*radius*.53;
      const forward=i>180;
      hit.grains.push({
        x:forward?radius*(.5+Math.random()*1.9):Math.cos(a)*rr,
        y:forward?(Math.random()-.5)*radius*1.5:Math.sin(a)*rr,
        r:forward?.18+Math.random()*.55:.35+Math.random()*1.5,
        alpha:.18+Math.random()*.48
      });
    }
    layer.last=at;
    layer.hits.push(hit);
    if(layer.hits.length>32) {layer.hits.shift();layer.dirty=true;}
    return false;
  }
  function drawBookPaint(ctx,hit,spread) {
    ctx.save();
    ctx.translate(hit.x,hit.y);ctx.rotate(hit.angle);
    ctx.fillStyle=hit.color;
    for(const grain of hit.grains) {
      ctx.globalAlpha=grain.alpha;
      ctx.beginPath();
      ctx.ellipse(grain.x*spread,grain.y*spread,
        grain.r*(.55+.45*spread),grain.r*(.55+.45*spread)*.8,0,0,Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  }
  function settleBookPaint(hit,w,h) {
    const cos=Math.cos(hit.angle),sin=Math.sin(hit.angle);
    let left=w,top=h,right=0,bottom=0;
    for(const g of hit.grains) {
      const x=hit.x+g.x*cos-g.y*sin,y=hit.y+g.x*sin+g.y*cos;
      left=Math.min(left,x-g.r-1);right=Math.max(right,x+g.r+1);
      top=Math.min(top,y-g.r-1);bottom=Math.max(bottom,y+g.r+1);
    }
    hit.left=Math.max(0,Math.floor(left));hit.top=Math.max(0,Math.floor(top));
    const width=Math.max(1,Math.ceil(Math.min(w,right))-hit.left);
    const height=Math.max(1,Math.ceil(Math.min(h,bottom))-hit.top);
    const stamp=document.createElement('canvas');
    stamp.width=width*2;stamp.height=height*2;
    const ctx=stamp.getContext('2d');
    ctx.setTransform(2,0,0,2,-hit.left*2,-hit.top*2);
    drawBookPaint(ctx,hit,1);
    hit.stamp=stamp;
    hit.grains=null;
  }
  function stepBookFlex(now) {
    if(surfaceMotion.matches) {clearBookFlex();return;}
    for(const [link,layer] of bookFlex) {
      const {ctx,w,h,hits}=layer;
      const fade=1-limit((now-layer.last-2600)/950,0,1);
      if(!link.isConnected||!fade) {
        layer.canvas.remove();bookFlex.delete(link);continue;
      }
      layer.canvas.style.opacity=String(.68*fade);
      let moving=false;
      for(const hit of hits) {
        if(hit.stamp) continue;
        if(now-hit.at>=168) {
          settleBookPaint(hit,w,h);
          layer.dirty=true;
        } else moving=true;
      }
      if(!moving&&!layer.dirty) continue;
      if(layer.dirty) {
        const base=layer.settledCtx;
        base.clearRect(0,0,layer.settled.width,layer.settled.height);
        for(const hit of hits) {
          if(hit.stamp) base.drawImage(hit.stamp,hit.left*2,hit.top*2);
        }
        layer.dirty=false;
      }
      ctx.setTransform(1,0,0,1,0,0);
      ctx.clearRect(0,0,layer.canvas.width,layer.canvas.height);
      ctx.drawImage(layer.settled,0,0);
      ctx.setTransform(2,0,0,2,0,0);
      for(const hit of hits) {
        if(!hit.stamp) drawBookPaint(ctx,hit,1-Math.exp(-Math.max(0,now-hit.at)/28));
      }
    }
  }

    return {
      clearSurfaceLayers,
      clearPaperCurls,
      clearVinyl,
      clearBookFlex,
      updateMaterialTargets,
      stepPaperCurls,
      stepVinyl,
      stepBookFlex,
      stepBookPaperBullet,
      stepWaterSkip,
      hitMaterial,
      drawMaterial
    };
  };
})();
