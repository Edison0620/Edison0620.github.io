'use strict';

(() => {
  const assetRoot = new URL('../media/music-hits/', document.currentScript.src);
  window.ClawdMusicEffects = function createMusicEffects() {
  // Sinestesia's three CC0 hit animations; local downsampled 4x4 atlases.
  // https://opengameart.org/users/sinestesia
  let sheets;
  let paletteColor;
  function updatePalette() {
    if (!sheets) return;
    paletteColor = getComputedStyle(document.documentElement).getPropertyValue('--clawd-impact').trim() || '#f40';
    for (const sheet of sheets) {
      if (sheet.originalPixels) tint(sheet, paletteColor);
    }
  }
  function prepare() {
    if (sheets) return;
    paletteColor = getComputedStyle(document.documentElement).getPropertyValue('--clawd-impact').trim() || '#f40';
    sheets = ['hit-2.png', 'hit-1.png', 'hit-3.png'].map((src, index) => {
    const atlas = document.createElement('canvas');
    atlas.width = atlas.height = 512;
    const atlasContext = atlas.getContext('2d', {willReadFrequently:true});
    const sheet = {index, atlas, atlasContext, tintedPixels:atlasContext.createImageData(512,512)};
    const image = new Image();
    image.fetchPriority = index === 0 ? 'high' : 'low';
    image.onload = () => {
      atlasContext.drawImage(image,0,0);
      sheet.originalPixels = atlasContext.getImageData(0,0,512,512).data;
      tint(sheet, paletteColor);
    };
    image.onerror = () => console.error('Music preview: impact atlas could not be loaded.',src);
    image.src = new URL(src + '?v=comic-1', assetRoot).href;
    return sheet;
  });
  }
  function tint(sheet, color) {
    if (sheet.paletteColor === color) return;
    const {atlasContext, originalPixels, tintedPixels} = sheet;
    atlasContext.clearRect(0, 0, 1, 1);
    atlasContext.fillStyle = color;
    atlasContext.fillRect(0, 0, 1, 1);
    const rgb = atlasContext.getImageData(0, 0, 1, 1).data;
    const data = tintedPixels.data;
    for (let i = 0; i < data.length; i += 4) {
      const light = Math.min(originalPixels[i], originalPixels[i+1], originalPixels[i+2]) / 255;
      const shade = sheet.index === 2 ? originalPixels[i] / 255 : .45 + .55 * originalPixels[i+1] / 255;
      for (let channel = 0; channel < 3; channel++) {
        data[i+channel] = rgb[channel] * shade * (1-light) + 255 * light;
      }
      data[i+3] = originalPixels[i+3];
    }
    atlasContext.putImageData(tintedPixels, 0, 0);
    sheet.paletteColor = color;
  }
  const discs = new Map();
  const sequence = [0,2,0,1,0];
  function step(now) {
      for(const [link,s] of discs) {
        if(!link.isConnected) { discs.delete(link);continue; }
        const dt=Math.min(.05,Math.max(0,(now-s.at)/1000));s.at=now;
        const w=Math.sqrt(260-81),decay=Math.exp(-9*dt),cos=Math.cos(w*dt),sin=Math.sin(w*dt);
        for(const axis of ['x','y']) {
          const v=axis==='x'?'vx':'vy',x=s[axis],velocity=s[v];
          s[axis]=decay*(x*cos+(velocity+9*x)*sin/w);
          s[v]=decay*(velocity*cos-(9*velocity+260*x)*sin/w);
        }
        const jw=Math.sqrt(420-121),jd=Math.exp(-11*dt),jc=Math.cos(jw*dt),js=Math.sin(jw*dt);
        for(const axis of ['jx','jy','turn']) {
          const key=axis+'v',x=s[axis],v=s[key];
          s[axis]=jd*(x*jc+(v+11*x)*js/jw);
          s[key]=jd*(v*jc-(11*v+420*x)*js/jw);
        }
        link.style.translate=`${s.jx}px ${s.jy}px`;
        link.style.rotate=`${s.turn}deg`;
        const length=Math.hypot(s.x,s.y);
        const scale=length>8?8/length:1;
        link.style.setProperty('--preview-vinyl-recoil',`${s.x*scale}px ${s.y*scale}px`);
        link.style.setProperty('--preview-vinyl-tilt',`${-s.y/(length||1)} ${s.x/(length||1)} 0 ${Math.min(length,8)*.8}deg`);
        if(length<.03&&Math.hypot(s.vx,s.vy)<.2) {
          link.style.removeProperty('--preview-vinyl-recoil');
          link.style.removeProperty('--preview-vinyl-tilt');
          link.style.removeProperty('translate');
          link.style.removeProperty('rotate');
          discs.delete(link);
        }
      }
  }
  function clear() {
      for(const link of discs.keys()) {
        link.style.removeProperty('--preview-vinyl-recoil');
        link.style.removeProperty('--preview-vinyl-tilt');
        link.style.removeProperty('translate');
        link.style.removeProperty('rotate');
      }
    discs.clear();
  }
  function kick(impact, bullet, now, bursts) {
        const link=impact.target.link;
        let s=discs.get(link);
        if(!s) { s={x:0,y:0,vx:0,vy:0,jx:0,jy:0,jxv:0,jyv:0,turn:0,turnv:0,at:now};discs.set(link,s); }
        const speed=Math.hypot(bullet.vx,bullet.vy)||1;
        s.vx+=bullet.vx/speed*95;s.vy+=bullet.vy/speed*95;
        const velocity=Math.hypot(s.vx,s.vy);
        if(velocity>150) { s.vx*=150/velocity;s.vy*=150/velocity; }
        s.jxv+=bullet.vx/speed*125;s.jyv+=bullet.vy/speed*125;
        const jacketSpeed=Math.hypot(s.jxv,s.jyv);
        if(jacketSpeed>180) {s.jxv*=180/jacketSpeed;s.jyv*=180/jacketSpeed;}
        const rect=link.getBoundingClientRect();
        const angle = impact.angle;
        const nx = Math.cos(angle), ny = Math.sin(angle);
        const torque = ((impact.x - rect.left - rect.width / 2) * ny
          - (impact.y - rect.top - rect.height / 2) * nx) / rect.width;
        s.turnv=Math.max(-85,Math.min(85,s.turnv+torque*100));
        // Keep a small overlapping volley; every bullet still transfers force.
        let simultaneous = 1;
        for (let i = bursts.length - 2; i >= 0; i--) {
          if (bursts[i].comic && bursts[i].target.link === link && ++simultaneous > 3) {
            bursts.splice(i, 1);
          }
        }
        s.hitIndex = (s.hitIndex || 0) + 1;
        const spread = Math.sin(s.hitIndex * 2.399963);
        const forward = rect.width * (.08 + .06 * (s.hitIndex % 3));
        const sideways = rect.width * .21 * spread;
        const preferred = sequence[s.hitIndex % 5];
        const available = sheets?.findIndex(sheet => sheet.originalPixels) ?? -1;
        impact.comic = {
          sheet: sheets?.[preferred]?.originalPixels ? preferred : available,
          angle, flip: torque < 0 ? -1 : 1,
          size: Math.min(78, rect.width * (.42 + .08 * Math.abs(spread))),
          sparkX: nx * forward - ny * sideways,
          sparkY: ny * forward + nx * sideways,
          sparkAngle: angle + spread * .7
        };
        impact.duration = 160;
  }
  function draw(ctx, impact, progress, color) {
    const sheet = sheets?.[impact.comic.sheet] || sheets?.find(candidate => candidate.originalPixels);
    if (!sheet?.originalPixels) return;
      const {angle, flip, size} = impact.comic;
      const {atlas} = sheet;
      const age = progress * impact.duration;
      const frame = Math.min(15, 1 + Math.floor(age < 45 ? age / 9 : 5 + (age - 45) / 11.5));
      tint(sheet, color);
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.translate(impact.x, impact.y);
      ctx.rotate(angle);
      ctx.scale(1, flip);
      ctx.drawImage(atlas, (frame % 4) * 128, Math.floor(frame / 4) * 128, 128, 128,
        -size / 2, -size / 2, size, size);
      ctx.restore();
      // Secondary fragments are staggered from the true contact, not new collisions.
      const sparkAge = age - 22;
      if (sparkAge >= 0 && sparkAge < 125) {
        const sparkFrame = Math.min(15, 1 + Math.floor(sparkAge / 8.4));
        const sparkSize = size * .62;
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.translate(impact.x + impact.comic.sparkX, impact.y + impact.comic.sparkY);
        ctx.rotate(impact.comic.sparkAngle);
        ctx.scale(1, -flip);
        ctx.drawImage(atlas, (sparkFrame % 4) * 128, Math.floor(sparkFrame / 4) * 128, 128, 128,
          -sparkSize / 2, -sparkSize / 2, sparkSize, sparkSize);
        ctx.restore();
      }
  }
  return {prepare, updatePalette, step, clear, kick, draw};
  };
})();
