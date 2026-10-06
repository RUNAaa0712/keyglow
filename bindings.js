const defaultBindings={"4k": [160, 65, 83, 187, 186, 161], "56k": [160, 65, 83, 68, 76, 187, 186, 161], "8k": [160, 65, 83, 68, 67, 188, 76, 187, 186, 161]};
const keyLabels={"65": "A", "66": "B", "67": "C", "68": "D", "69": "E", "70": "F", "71": "G", "72": "H", "73": "I", "74": "J", "75": "K", "76": "L", "77": "M", "78": "N", "79": "O", "80": "P", "81": "Q", "82": "R", "83": "S", "84": "T", "85": "U", "86": "V", "87": "W", "88": "X", "89": "Y", "90": "Z", "48": "0", "49": "1", "50": "2", "51": "3", "52": "4", "53": "5", "54": "6", "55": "7", "56": "8", "57": "9", "112": "F1", "113": "F2", "114": "F3", "115": "F4", "116": "F5", "117": "F6", "118": "F7", "119": "F8", "120": "F9", "121": "F10", "122": "F11", "123": "F12", "96": "Num0", "97": "Num1", "98": "Num2", "99": "Num3", "100": "Num4", "101": "Num5", "102": "Num6", "103": "Num7", "104": "Num8", "105": "Num9", "8": "Backspace", "9": "Tab", "13": "Enter", "27": "Esc", "32": "Space", "33": "PageUp", "34": "PageDown", "35": "End", "36": "Home", "37": "←", "38": "↑", "39": "→", "40": "↓", "45": "Insert", "46": "Delete", "160": "L_SHIFT", "161": "R_SHIFT", "162": "L_CTRL", "163": "R_CTRL", "164": "L_ALT", "165": "R_ALT", "186": ":", "187": ";", "188": "、", "189": "-", "190": ".", "191": "/", "192": "@", "219": "[", "220": "\\", "221": "]", "222": "^", "226": "ろ", "106": "Num*", "107": "Num+", "109": "Num-", "110": "Num.", "111": "Num/"};
let activeBindings=structuredClone(defaultBindings), bindingsReady=false;
let draftBindings=structuredClone(defaultBindings), captureIndex=null, savingBindings=false;
const suppressedKeys=new Set();
function makeLayouts(bindings){return Object.fromEntries(Object.entries(bindings).map(([name,keys])=>[name,keys.map((vk,i)=>[keyLabels[vk],vk,i===0?'LEFT':i===keys.length-1?'RIGHT':undefined])]))}
function eventVirtualKey(event){
 const code=event.code;
 const special={ShiftLeft:160,ShiftRight:161,ControlLeft:162,ControlRight:163,AltLeft:164,AltRight:165,
  NumpadMultiply:106,NumpadAdd:107,NumpadSubtract:109,NumpadDecimal:110,NumpadDivide:111,NumpadEnter:13,
  IntlBackslash:226,IntlRo:226};
 if(special[code])return special[code];
 if(/^Numpad[0-9]$/.test(code))return 96+Number(code.slice(-1));
 if(/^Key[A-Z]$/.test(code))return code.charCodeAt(3);
 if(/^Digit[0-9]$/.test(code))return code.charCodeAt(5);
 // Windows browser keyCode retains the OS OEM key, including JIS punctuation.
 const vk=event.keyCode;
 if(vk===16)return event.location===2?161:160;
 if(vk===17)return event.location===2?163:162;
 if(vk===18)return event.location===2?165:164;
 return Object.hasOwn(keyLabels,vk)?vk:null;
}
function cancelBindingCapture(message){
 if(captureIndex===null)return;
 captureIndex=null;renderBindingEditor();
 if(message)$('bindingStatus').textContent=message;
}
function renderBindingEditor(){
 if(overlay)return;
 const editor=$('bindingEditor');editor.replaceChildren();
 draftBindings[$('layout').value].forEach((vk,i)=>{
  const label=document.createElement('div');label.className='binding-slot';
  const caption=document.createElement('span');caption.textContent=`${i+1}${i===0?' · 左補助':i===draftBindings[$('layout').value].length-1?' · 右補助':''}`;
  const button=document.createElement('button');button.type='button';
  button.textContent=captureIndex===i?'キーを押してください…':keyLabels[vk]+' · 変更';
  button.setAttribute('aria-label',`${i+1}番目の検知キー：${keyLabels[vk]}。押して変更`);
  button.setAttribute('aria-pressed',String(captureIndex===i));
  button.disabled=!bindingsReady||savingBindings;
  button.onclick=()=>{captureIndex=i;renderBindingEditor();$('bindingStatus').textContent=`${i+1}番目に割り当てるキーを1つ押してください。`;};
  label.append(caption,button);editor.append(label);
 });
 $('cancelBinding').hidden=captureIndex===null;
 $('saveBindings').disabled=!bindingsReady||savingBindings||captureIndex!==null;
 $('resetBindings').disabled=!bindingsReady||savingBindings;
}
function syncBindings(bindings){
 if(bindingsReady&&JSON.stringify(bindings)===JSON.stringify(activeBindings))return;
 activeBindings=structuredClone(bindings);draftBindings=structuredClone(bindings);captureIndex=null;
 bindingsReady=true;layouts=makeLayouts(activeBindings);build();
 trail.frozen=null;trail.demoStart=0;$('freeze').textContent='履歴を止めて見る';
 window.dispatchEvent(new Event('bindingschange'));
}
window.addEventListener('DOMContentLoaded',()=>{
 if(overlay)return;
 $('cancelBinding').onclick=()=>cancelBindingCapture('キーの入力をキャンセルしました。');
 $('layout').addEventListener('input',()=>cancelBindingCapture('配列を変更しました。'));
 $('bindingEditor').closest('details').addEventListener('toggle',event=>{if(!event.target.open)cancelBindingCapture();});
 window.addEventListener('blur',()=>{suppressedKeys.clear();cancelBindingCapture('キーの入力をキャンセルしました。')});
 window.addEventListener('keydown',event=>{
  if(captureIndex===null&&!suppressedKeys.has(event.code))return;
  event.preventDefault();event.stopImmediatePropagation();
  if(event.repeat||captureIndex===null)return;
  suppressedKeys.add(event.code);
  const vk=eventVirtualKey(event);
  if(vk===null){$('bindingStatus').textContent='このキーには対応していません。別のキーを押してください。';return}
  draftBindings[$('layout').value][captureIndex]=vk;
  captureIndex=null;renderBindingEditor();
  $('bindingStatus').textContent=`${keyLabels[vk]} を割り当てました。「割り当てを保存」で反映します。`;
 },true);
 window.addEventListener('keyup',event=>{
  if(!suppressedKeys.delete(event.code))return;
  event.preventDefault();event.stopImmediatePropagation();
 },true);
 async function save(reset){
  if(savingBindings)return;
  cancelBindingCapture();
  const layout=$('layout').value,keys=reset?[...defaultBindings[layout]]:[...draftBindings[layout]];
  if(new Set(keys).size!==keys.length){$('bindingStatus').textContent='キーが重複しています。各位置に異なるキーを割り当ててください。';return}
  const updated={...activeBindings,[layout]:keys};
  savingBindings=true;renderBindingEditor();
  try{
   const r=await fetch('/config',{method:'POST',headers:{'X-KeyGlow-Control':'configure','Content-Type':'application/json'},body:JSON.stringify(updated)});
   if(!r.ok)throw Error();syncBindings(updated);draftBindings[layout]=[...keys];$('bindingStatus').textContent='保存しました。OBSにも反映されます。';
  }catch{$('bindingStatus').textContent='保存できませんでした。最新版のStart.cmdを起動してください。'}
  finally{savingBindings=false;renderBindingEditor()}
 }
 $('saveBindings').onclick=()=>save(false);$('resetBindings').onclick=()=>save(true);
});
