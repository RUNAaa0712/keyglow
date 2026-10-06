/* Input-only piano roll. No song/chart data or timing judgment is inferred. */
class InputTrail {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.notes = [];
    this.time = 0;
    this.receivedAt = 0;
    this.connected = false;
    this.paused = false;
    this.frozen = null;
    this.demoStart = 0;
    this.demoNotes = [];
  }
  receive(data) {
    this.notes = data.notes || [];
    this.time = data.now;
    this.receivedAt = performance.now();
    this.connected = !!data.capture_ok;
    this.paused = data.paused;
  }
  disconnect() { this.connected = false; this.notes = []; }
  now() { return this.time + Math.min(.15, (performance.now() - this.receivedAt) / 1000); }
  freeze() {
    if (this.frozen) this.frozen = null;
    else if(this.demoStart>0 && (performance.now()-this.demoStart)/1000<(this.seconds||4)+3.5) {
      const now=(performance.now()-this.demoStart)/1000;
      this.frozen={notes:this.demoNotes.filter(n=>n[1]<=now).map(n=>[n[0],n[1],Math.min(n[2],now)]),now,demo:true};
      this.demoStart=0;
    } else this.frozen = {notes: this.notes.map(n=>[...n]), now: this.now()};
    return !!this.frozen;
  }
  demo(keys) {
    this.frozen=null;
    this.demoStart = performance.now();
    this.demoNotes = [];
    keys.forEach((key,i)=>this.demoNotes.push([key[1],i*.16,i*.16+.06]));
    this.demoNotes.push([keys[1][1],1.5,1.58],[keys[keys.length-2][1],1.5,1.58]);
    this.demoNotes.push([keys[0][1],2,3.15],[keys[keys.length-1][1],2,3.15]);
  }
  draw(keys, seconds, color) {
    this.seconds=seconds;
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(width*dpr) || this.canvas.height !== Math.round(height*dpr)) {
      this.canvas.width=Math.round(width*dpr);this.canvas.height=Math.round(height*dpr);
    }
    const ctx=this.ctx;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
    const left=38, right=8, top=32, base=height-40, h=base-top;
    const cell=(width-left-right)/keys.length;
    const demoAge=(performance.now()-this.demoStart)/1000;
    const demo=this.demoStart>0 && demoAge<seconds+3.5;
    const snapshot=this.frozen || {notes:this.notes,now:this.now()};
    const now=demo?demoAge:snapshot.now;
    const notes=demo?this.demoNotes.filter(n=>n[1]<=now):snapshot.notes;
    const y=t=>base-(now-t)*h/seconds;
    ctx.font='11px "Segoe UI", sans-serif';ctx.textAlign='left';
    ctx.fillStyle='#93a6bb';
    ctx.fillText(demo?'DEMO · サンプル入力':this.frozen?(this.frozen.demo?'DEMO HOLD · サンプルを固定':'HOLD · 表示を固定'):this.paused?'PAUSED':this.connected?'LIVE · 入力履歴':'OFFLINE',left,18);
    for(let i=0;i<keys.length;i++) {
      const x=left+i*cell;
      ctx.fillStyle=i%2===0?'rgba(34,49,68,.7)':'rgba(22,33,49,.7)';
      ctx.fillRect(x+1,top,cell-2,h);
      ctx.strokeStyle='rgba(145,164,189,.14)';ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,base);ctx.stroke();
      ctx.fillStyle='#d5dfeb';ctx.textAlign='center';
      ctx.font=(width<500?'10':'12')+'px "Segoe UI", sans-serif';
      const [label,,side]=keys[i];ctx.fillText(label==='L_SHIFT'?'L ⇧':label==='R_SHIFT'?'R ⇧':label,x+cell/2,base+24);
    }
    const tick=seconds<=4?.5:1;
    for(let age=0;age<=seconds;age+=tick) {
      const yy=base-age*h/seconds;ctx.strokeStyle='rgba(162,182,203,.14)';ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(width-right,yy);ctx.stroke();
      ctx.textAlign='right';ctx.font='10px "Segoe UI", sans-serif';ctx.fillStyle='#899bb0';ctx.fillText(age===0?'NOW':`−${age}s`,left-6,yy+3);
    }
    ctx.save();ctx.beginPath();ctx.rect(left,top,width-left-right,h);ctx.clip();
    for(const [vk,start,end] of notes) {
      const lane=keys.findIndex(k=>k[1]===vk);if(lane<0 || start>now)continue;
      const finish=Math.min(end===null?now:end,now);if(finish<now-seconds)continue;
      const y1=y(start),y2=y(finish),x=left+lane*cell+cell*.18;
      const held=end===null || (demo&&end>now);
      ctx.fillStyle=keys[lane][2]?'#b5a0ff':color;
      ctx.globalAlpha=held?1:.85;
      ctx.fillRect(x,y1,cell*.64,Math.max(3,y2-y1));
      ctx.globalAlpha=1;ctx.fillStyle='#edfff9';ctx.fillRect(x,y1,cell*.64,2);
    }
    ctx.restore();ctx.globalAlpha=1;
    ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(left,base);ctx.lineTo(width-right,base);ctx.stroke();ctx.lineWidth=1;
  }
}
