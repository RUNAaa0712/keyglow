/* Keep detailed recording outside the OBS overlay; it is sampled server-side. */
if(!overlay){
  const fmt=value=>value===null||value===undefined?'—':`${Number(value).toFixed(1)} ms`;
  const statuses={bindings_changed:'割り当て変更で中断',held:'押下中',complete:'完了',recording_stopped:'記録停止で中断',input_paused:'入力停止で中断',limit_reached:'上限で中断'};
  let loading=false;
  async function loadMetrics(){
    if(loading||closed)return;
    loading=true;
    const layout=$('layout').value;
    $('csvExport').href='/export.csv?layout='+layout;
    $('jsonExport').href='/export.json?layout='+layout;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
    try{
      const response=await fetch('/metrics?layout='+layout,{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw Error('取得できません');
      const data=await response.json();
      if(layout!==$('layout').value||closed)return;
      $('recordStatus').textContent=`${data.full?'上限到達 · 出力後に新しい記録を開始してください':data.running?'● 記録中':'記録停止中'} ／ ${data.selected_total}打鍵（配列内） ／ 全体 ${data.recorded_total.toLocaleString()} / ${data.limit.toLocaleString()}`;
      $('recordPause').disabled=!data.running;
      $('recordResume').disabled=data.running||data.full;
      $('holdMean').textContent=fmt(data.summary.hold.mean_ms);
      $('intervalMean').textContent=fmt(data.summary.interval.mean_ms);
      $('gapMean').textContent=fmt(data.summary.gap.mean_ms);
      $('sampling').textContent=`直近の入力検知周期：平均 ${fmt(data.summary.sampling.mean_ms)} ／ 最大 ${fmt(data.summary.sampling.max_ms)}。小数表示は測定精度の保証ではありません。`;
      const fragment=document.createDocumentFragment();
      for(const tap of [...data.taps].reverse()){
        const tr=document.createElement('tr');
        const values=[tap.key,fmt(tap.press_ms),fmt(tap.hold_ms),tap.next_keys||'—',fmt(tap.next_press_ms),fmt(tap.release_to_next_ms),fmt(tap.same_key_next_ms),tap.chord_size??'—',statuses[tap.status]||tap.status];
        for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td)}fragment.append(tr);
      }
      $('tapRows').replaceChildren(fragment);
    }catch{$('recordStatus').textContent='記録情報に接続できません。Start.cmdで最新版を起動してください。'}
    finally{clearTimeout(timer);loading=false}
  }
  async function control(action){
    if(action==='clear'&&!window.confirm('現在のタップ記録を消去して、新しく記録します。必要な記録は先にCSV／JSON出力してください。'))return;
    try{const response=await fetch('/record/'+action,{method:'POST',headers:{'X-KeyGlow-Control':action}});if(!response.ok)throw Error();await loadMetrics()}
    catch{$('recordStatus').textContent='操作できませんでした。接続を確認してください。'}
  }
  $('recordPause').onclick=()=>control('pause');
  $('recordResume').onclick=()=>control('resume');
  $('recordClear').onclick=()=>control('clear');
  $('layout').addEventListener('input',()=>{const layout=$('layout').value;$('csvExport').href='/export.csv?layout='+layout;$('jsonExport').href='/export.json?layout='+layout;loadMetrics()});
  loadMetrics();setInterval(loadMetrics,1000);
}
