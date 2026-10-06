if(!overlay || $('view').value==='graphs'){
  const charts=[['holdPlot','hold_ms','#78f5ca'],['intervalPlot','next_press_ms','#82b8ff'],['gapPlot','release_to_next_ms','#ffbe78']];
  let incoming=[],fixed=null,demo=null,online=false,recording=true,sequence=0,chartLayout=$('layout').value;
  const hitmaps=new Map();
  function taps(){
    const key=$('graphKey').value;
    return (demo||fixed||incoming).filter(t=>key==='all'?!layouts[$('layout').value].filter(k=>k[2]).some(k=>keyLabels[k[1]]===t.key):t.key===key).slice(-Number($('graphCount').value));
  }
  function draw(){
    const rows=taps();
    $('graphStatus').textContent=(demo?'DEMO · サンプル（実記録ではありません）':fixed?(fixed.isDemo?'HOLD · サンプル表示を固定':'HOLD · 表示固定'):!online?'未接続 · 最後に受信したデータ':recording?'LIVE · 自動更新中':'記録停止中')+` ／ ${rows.length}打鍵`;
    for(const [id,field,color] of charts){
      const canvas=$(id),ctx=canvas.getContext('2d'),w=canvas.clientWidth,h=canvas.clientHeight;
      if(!w||!h)continue;
      const ratio=Math.min(devicePixelRatio||1,2);
      if(canvas.width!==Math.round(w*ratio)||canvas.height!==Math.round(h*ratio)){canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio)}
      ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);
      const l=54,r=w-18,t=18,b=h-30;
      const values=rows.map(x=>x[field]).filter(Number.isFinite);
      let low=Math.min(0,...values),high=Math.max(50,...values);
      const step=Math.max(10,Math.pow(10,Math.floor(Math.log10(Math.max(high-low,1))))/2);
      low=Math.floor(low/step)*step;high=Math.ceil(high/step)*step;
      const y=v=>b-(v-low)/(high-low)*(b-t),x=i=>l+(rows.length<2?.5:i/(rows.length-1))*(r-l);
      if(low<0){ctx.fillStyle='rgba(255,110,126,.09)';ctx.fillRect(l,y(0),r-l,b-y(0))}
      ctx.font='11px "Segoe UI",sans-serif';ctx.textAlign='right';
      for(let i=0;i<=4;i++){const value=low+(high-low)*i/4,yy=y(value);ctx.strokeStyle='#27374a';ctx.beginPath();ctx.moveTo(l,yy);ctx.lineTo(r,yy);ctx.stroke();ctx.fillStyle='#9aacbf';ctx.fillText(value.toFixed(value%1?1:0),l-7,yy+4)}
      if(low<0){ctx.strokeStyle='#fa8596';ctx.beginPath();ctx.moveTo(l,y(0));ctx.lineTo(r,y(0));ctx.stroke()}
      ctx.fillStyle='#9aacbf';ctx.textAlign='left';ctx.fillText(rows.length?'#'+rows[0].id:'打鍵番号',l,h-9);ctx.textAlign='right';if(rows.length)ctx.fillText('#'+rows[rows.length-1].id,r,h-9);
      ctx.strokeStyle=color;ctx.lineWidth=1.6;
      let prev=null;const points=[];
      rows.forEach((row,i)=>{
        const value=row[field];
        if(!Number.isFinite(value)){prev=null;return}
        const pt={x:x(i),y:y(value),row,value};
        if(prev&&prev.row.segment===row.segment){ctx.beginPath();ctx.moveTo(prev.x,prev.y);ctx.lineTo(pt.x,pt.y);ctx.stroke()}
        ctx.fillStyle=field==='release_to_next_ms'&&value<0?'#ff8396':color;
        ctx.beginPath();ctx.arc(pt.x,pt.y,rows.length>100?1.7:2.7,0,Math.PI*2);ctx.fill();points.push(pt);prev=pt;
      });
      if(!values.length){ctx.fillStyle='#91a4ba';ctx.textAlign='center';ctx.fillText(rows.length?'確定したデータを待っています':'対象キーを押すとグラフが表示されます',(l+r)/2,(t+b)/2)}
      hitmaps.set(id,points);
    }
  }
  for(const [id,field] of charts){
    $(id).addEventListener('mousemove',event=>{
      const rect=$(id).getBoundingClientRect(),px=event.clientX-rect.left,points=hitmaps.get(id)||[];
      const closest=points.reduce((best,p)=>!best||Math.abs(p.x-px)<Math.abs(best.x-px)?p:best,null);
      if(closest)$('graphTip').textContent=`#${closest.row.id} · ${closest.row.key} · ${closest.value.toFixed(3)} ms${field==='release_to_next_ms'&&closest.value<0?' · 押し重なり':''}`;
    });
  }
  $('graphFreeze').onclick=()=>{if(fixed){fixed=null;demo=null;$('graphFreeze').textContent='グラフを固定'}else{fixed=(demo||incoming).map(t=>({...t}));fixed.isDemo=!!demo;demo=null;$('graphDemo').textContent='グラフデモ';$('graphFreeze').textContent='ライブに戻す'}draw()};
  $('graphDemo').onclick=()=>{
    if(demo){demo=null;$('graphDemo').textContent='グラフデモ';draw();return}
    fixed=null;$('graphFreeze').textContent='グラフを固定';$('graphDemo').textContent='デモを終了';
    const keys=layouts[$('layout').value].filter(k=>!k[2]).map(k=>keyLabels[k[1]]);
    demo=Array.from({length:100},(_,i)=>{const hold=50+Math.sin(i*.7)*16+(i%17===0?50:0),interval=75+Math.cos(i*.3)*22;return {id:i+1,key:keys[i%keys.length],segment:0,hold_ms:hold,next_press_ms:interval,release_to_next_ms:interval-hold}});draw();
  };
  for(const id of ['graphCount','graphKey'])$(id).addEventListener('input',draw);
  $('layout').addEventListener('input',()=>{sequence++;incoming=[];fixed=null;demo=null;chartLayout=$('layout').value;$('graphDemo').textContent='グラフデモ';$('graphFreeze').textContent='グラフを固定';draw()});
  window.addEventListener('bindingschange',()=>{sequence++;incoming=[];fixed=null;demo=null;$('graphDemo').textContent='グラフデモ';$('graphFreeze').textContent='グラフを固定';draw()});
  window.addEventListener('resize',draw);
  async function pollGraph(){
    if(closed)return;
    const current=sequence,layout=$('layout').value,controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),3000);
    try{
      const response=await fetch('/graph?layout='+layout,{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error();
      const data=await response.json();
      if(current===sequence&&layout===$('layout').value){incoming=data.taps;online=true;recording=data.running;draw()}
    }catch{online=false;draw()}finally{clearTimeout(timeout);setTimeout(pollGraph,250)}
  }
  draw();pollGraph();
}
