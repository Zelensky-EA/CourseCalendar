'use strict';
const CFG=window.PLANNER_CONFIG;
const SCOPE='https://www.googleapis.com/auth/spreadsheets';
const COURSES={
  bio:{name:'AP Biology',short:'AP Biology',id:CFG?.apBiologyId,calendar:'COURSE CALENDAR',reference:'STUDENT ASSIGNMENTS',referenceRange:'B4:I63',page:CFG?.apBiologyPage},
  anatomy:{name:'Anatomy & Physiology',short:'Anatomy',id:CFG?.anatomyId,calendar:'NAVIGATOR',reference:'A&P MASTER TOPICS',referenceRange:'B2:L83',page:CFG?.anatomyPage}
};
const $=id=>document.getElementById(id);
const state={token:'',expires:0,client:null,courses:{},week:null,courseFilter:'all',current:null,busy:false,saving:false};
const dayNames=['Monday','Tuesday','Wednesday','Thursday','Friday'];
const district=window.DISTRICT_CALENDAR;
const districtEvents=date=>date?district.events.filter(([start,end])=>start<=date&&date<=end):[];
const noSchool=date=>districtEvents(date).some(event=>event[3]==='closed');
const isHomeworkDay=(key,day)=>key==='bio'&&(day.row-4)%5===3;
function lessonFor(key,day){
  if(key==='anatomy'&&(day.row-4)%5===3){const wed=state.courses.anatomy?.days?.[day.row-5];
    return wed?{...day,topic:wed.topic,topicTitle:wed.topicTitle,classPlan:wed.classPlan,mirror:wed}:day;
  }
  return day;
}
function scheduledLesson(key,day){return !noSchool(day.date)&&!isHomeworkDay(key,day)&&planned(lessonFor(key,day));}
const htmlDate=value=>{if(typeof value==='number'&&Number.isFinite(value)){const d=new Date(Date.UTC(1899,11,30)+Math.round(value)*86400000);return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):'';}return /^\d{4}-\d{2}-\d{2}$/.test(String(value))?String(value):'';};
const serialDate=value=>value?Math.round((Date.parse(value+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000):'';
const localToday=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
const formatDate=(iso,options={month:'short',day:'numeric'})=>iso?new Date(iso+'T12:00:00').toLocaleDateString('en-US',options):'Date not set';
const safeText=value=>value===null||value===undefined?'':String(value);
const clean=value=>safeText(value).trim();
function notice(message,kind=''){$('notice').textContent=message;$('notice').className='notice'+(kind?' '+kind:'');}
function a1(sheet){return "'"+sheet.replaceAll("'","''")+"'";}
function connected(){return !!state.token&&Date.now()<state.expires;}
function assertConfig(){if(!CFG||!CFG.oauthClientId||!CFG.apBiologyId||!CFG.anatomyId)throw Error('Check the Google client ID and both spreadsheet IDs in config.js.');}
async function api(course,path,options={}){
  if(!connected())throw Error('Your Google session expired. Connect Google again.');
  const response=await fetch('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(course.id)+path,{
    ...options,headers:{Authorization:'Bearer '+state.token,...(options.body?{'Content-Type':'application/json'}:{})}
  });
  if(!response.ok){let detail='Google Sheets request failed ('+response.status+').';try{const json=await response.json();detail=json.error?.message||detail;}catch{}
    if(response.status===401)detail='Your Google session expired. Connect Google again.';
    if(response.status===403)detail='This Google account cannot edit '+course.name+' or Sheets API access is blocked.';
    throw Error(detail);
  }
  return response.json();
}
function parseTopics(key,rows){return (rows||[]).map(row=>{
  if(key==='bio')return {code:clean(row[0]),title:clean(row[1]).split('\n')[0],target:clean(row[5]),resources:[['Read before class',clean(row[2])],['BIOZONE / class work',clean(row[3])],['After class',clean(row[4])]].filter(x=>x[1]),detail:clean(row[7])};
  return {code:clean(row[0]),title:clean(row[1]),target:clean(row[3]),resources:[['BIOZONE',clean(row[5])],['BIOZONE pages',clean(row[6])],['Crash Course',clean(row[8])]].filter(x=>x[1]),detail:clean(row[4])};
}).filter(topic=>topic.code&&topic.title);}
function parseDays(rows){return Array.from({length:180},(_,index)=>{
  const row=rows?.[index]||[],sheetRow=index+4;
  return {row:sheetRow,week:clean(row[0]),weekday:clean(row[1])||dayNames[index%5],date:htmlDate(row[2]),rawDate:row[2]??'',topic:clean(row[3]),topicTitle:clean(row[4]),classPlan:safeText(row[5]),resourceOne:safeText(row[6]),resourceTwo:safeText(row[7]),homework:safeText(row[8]),target:safeText(row[9]),note:safeText(row[10]),taught:row[11]===true||safeText(row[11]).toLowerCase()==='true',rawTaught:row[11]??''};
});}
async function fetchCourse(key){const course=COURSES[key];
  const params=new URLSearchParams({valueRenderOption:'UNFORMATTED_VALUE',dateTimeRenderOption:'SERIAL_NUMBER'});
  params.append('ranges',a1(course.calendar)+'!A3:L183');params.append('ranges',a1(course.reference)+'!'+course.referenceRange);
  const [batch,meta]=await Promise.all([api(course,'/values:batchGet?'+params),api(course,'?fields=sheets.properties(sheetId,title)')]);
  const sheet=meta.sheets?.find(item=>item.properties?.title===course.calendar);
  if(!sheet)throw Error('Could not find '+course.calendar+' in '+course.name+'.');
  const main=batch.valueRanges?.[0]?.values||[];
  const statusHeader=clean(main[0]?.[11]);
  return {days:parseDays(main.slice(1)),topics:parseTopics(key,batch.valueRanges?.[1]?.values),sheetId:sheet.properties.sheetId,statusHeader,updated:Date.now()};
}
function firstWeek(){const today=localToday();let previous=null,next=null;
  for(let i=0;i<36;i++)for(const key of Object.keys(COURSES)){
    const date=state.courses[key]?.days?.[i*5]?.date;
    if(!date)continue;
    if(date<=today)previous=i;else if(next===null)next=i;
  }
  return previous??next??0;
}
async function load(initial=false){if(!connected()||state.busy||state.saving)return;
  state.busy=true;$('refresh').disabled=true;notice('Refreshing course calendars…');
  try{
    const result=await Promise.allSettled(Object.keys(COURSES).map(fetchCourse));
    let errors=[];Object.keys(COURSES).forEach((key,i)=>{if(result[i].status==='fulfilled')state.courses[key]=result[i].value;else errors.push(COURSES[key].short+': '+result[i].reason.message);});
    if(!Object.keys(state.courses).length)throw Error(errors.join(' | '));
    if(initial||state.week===null)state.week=firstWeek();
    $('app').classList.remove('hidden');render();
    notice(errors.length?'Some calendars could not load. '+errors.join(' | '):'Live calendars refreshed at '+new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}),errors.length?'error':'success');
  }catch(err){notice(err.message,'error');}
  finally{state.busy=false;$('refresh').disabled=false;}
}
function connect(){try{assertConfig();}catch(err){notice(err.message,'error');return;}
  if(!window.google?.accounts?.oauth2){notice('Google sign-in has not loaded. Refresh this page and try again.','error');return;}
  if(!state.client)state.client=google.accounts.oauth2.initTokenClient({client_id:CFG.oauthClientId,scope:SCOPE,
    callback:reply=>{if(reply.error||!reply.access_token||!google.accounts.oauth2.hasGrantedAllScopes(reply,SCOPE)){notice('Google Sheets access was not granted.','error');return;}
      state.token=reply.access_token;state.expires=Date.now()+(Math.max(120,Number(reply.expires_in)||3300)-60)*1000;
      $('connect').classList.add('hidden');$('disconnect').classList.remove('hidden');load(true);},
    error_callback:()=>notice('Google sign-in was canceled or blocked.','error')
  });
  state.client.requestAccessToken({prompt:'select_account'});
}
function disconnect(){const token=state.token;state.token='';state.expires=0;state.courses={};state.week=null;state.current=null;
  if(token&&window.google?.accounts?.oauth2)google.accounts.oauth2.revoke(token,()=>{});
  $('connect').classList.remove('hidden');$('disconnect').classList.add('hidden');$('app').classList.add('hidden');notice('Disconnected. Connect Google to view your planning calendars.');
}
function text(parent,tag,content,className=''){const node=document.createElement(tag);if(className)node.className=className;node.textContent=content;parent.append(node);return node;}
function visibleKeys(){return Object.keys(COURSES).filter(key=>state.courses[key]&&(state.courseFilter==='all'||state.courseFilter===key));}
function planned(day){return !!(day.topic||clean(day.classPlan));}
function pacing(key){const dates=state.courses[key]?.days.filter(d=>d.date&&d.date<=localToday()&&scheduledLesson(key,d))||[];
  return {scheduled:dates.length,taught:dates.filter(d=>d.taught).length,waiting:dates.filter(d=>!d.taught).length};}
function renderSummary(){let waiting=0;
  for(const key of Object.keys(COURSES)){
    const pace=pacing(key),label=$(key+'-pace'),stats=$(key+'-stats');
    if(!state.courses[key]){label.textContent='Unavailable';stats.textContent='Could not load calendar';continue;}
    label.textContent=pace.taught+' of '+pace.scheduled+' taught';stats.textContent=pace.waiting+' scheduled lessons not marked taught';waiting+=pace.waiting;
  }
  $('focus-value').textContent=waiting+' to review';
}
function dayFor(key,week,offset){return state.courses[key]?.days?.[week*5+offset];}
function resolvedDate(week,offset){for(const key of Object.keys(COURSES)){const date=dayFor(key,week,offset)?.date;if(date)return date;}return '';}
function renderWeek(){const week=Math.min(35,Math.max(0,state.week||0));state.week=week;
  const picker=$('week-picker');picker.replaceChildren();for(let n=0;n<36;n++){
    const date=Array.from({length:5},(_,i)=>resolvedDate(n,i)).find(Boolean);
    picker.add(new Option('Week '+(n+1)+(date?' · '+formatDate(date):''),String(n)));
  }picker.value=String(week);
  const dates=Array.from({length:5},(_,i)=>resolvedDate(week,i)).filter(Boolean);
  $('week-title').textContent='Week '+(week+1);
  $('week-range').textContent=dates.length?formatDate(dates[0])+' – '+formatDate(dates[dates.length-1],{month:'short',day:'numeric',year:'numeric'}):'Dates can be added in any daily plan.';
  $('previous').disabled=week===0;$('next').disabled=week===35;
  const grid=$('week-grid');grid.replaceChildren();let taught=0,scheduled=0;
  for(let i=0;i<5;i++){
    const date=resolvedDate(week,i),events=districtEvents(date),card=text(grid,'article','','day'+(date===localToday()?' today':'')+(noSchool(date)?' closed-day':''));
    const head=text(card,'header','','day-head');text(head,'strong',dayNames[i]);text(head,'small',formatDate(date));
    for(const event of events)text(card,'div',event[2],'district-badge '+event[3]);
    for(const key of visibleKeys()){
      const day=dayFor(key,week,i);if(!day)continue;const view=lessonFor(key,day),homeworkOnly=isHomeworkDay(key,day);
      if(scheduledLesson(key,day)){scheduled++;if(day.taught)taught++;}
      const lesson=text(card,'div','','lesson '+key),top=text(lesson,'div','','lesson-top');text(top,'span',COURSES[key].short,'lesson-tag');
      text(top,'span',noSchool(day.date)?'No classes':homeworkOnly?'Homework only':day.taught?'Taught':day.date&&day.date<localToday()&&scheduledLesson(key,day)?'Review':'Planned',day.taught&&!noSchool(day.date)&&!homeworkOnly?'state done':day.date&&day.date<localToday()&&scheduledLesson(key,day)?'state late':'state');
      if(key==='anatomy'&&i===3)text(lesson,'div','Thursday repeats Wednesday’s lesson','routine');
      if(homeworkOnly)text(lesson,'div','No AP Biology class Thursday','routine');
      const subject=state.courses[key].topics.find(topic=>topic.code===view.topic);
      if(view.topic||view.topicTitle)text(lesson,'div',(view.topic?view.topic+' · ':'')+(subject?.title||view.topicTitle.split('\n')[0]||'Topic'), 'topic-title');
      else if(!homeworkOnly)text(lesson,'div','No topic selected','lesson-empty');
      if(!homeworkOnly&&clean(view.classPlan))text(lesson,'p',clean(view.classPlan),'plan-preview');
      if(clean(day.homework))text(lesson,'p','Homework: '+clean(day.homework),'plan-preview');
      const button=text(lesson,'button',homeworkOnly?'Edit homework':planned(day)?'Edit plan':'Add plan','edit-lesson');button.type='button';button.onclick=()=>openEditor(key,day);
    }
  }
  $('week-progress').textContent=taught+' of '+scheduled+' planned lessons marked taught';
}
function renderRadar(){const root=$('radar');root.replaceChildren();const tasks=[];for(const key of visibleKeys())for(const day of state.courses[key].days){if(day.date&&day.date<localToday()&&scheduledLesson(key,day)&&!day.taught)tasks.push({key,day});}
  tasks.sort((a,b)=>b.day.date.localeCompare(a.day.date));
  if(!tasks.length){const line=text(root,'div','No dated lessons awaiting a taught check.','radar-line');return;}
  for(const task of tasks.slice(0,4)){
    const item=text(root,'div','','radar-line');text(item,'strong',COURSES[task.key].short+' · '+formatDate(task.day.date));
    const title=state.courses[task.key].topics.find(t=>t.code===task.day.topic)?.title||clean(task.day.classPlan)||'Unfinished plan';
    text(item,'span',title.slice(0,76));const button=text(item,'button','Review lesson');button.type='button';button.onclick=()=>{state.week=Math.floor((task.day.row-4)/5);renderWeek();openEditor(task.key,task.day);};
  }
}
function renderDistrictDates(){const root=$('district-dates');root.replaceChildren();const today=localToday();let future=district.events.filter(event=>event[1]>=today);if(!future.length)future=district.events.slice(-5);
  for(const [start,end,label,kind] of future.slice(0,7)){const item=text(root,'div','','district-event '+kind);text(item,'strong',formatDate(start)+(end!==start?' – '+formatDate(end):''));text(item,'span',label);}
}
function renderTopics(){const root=$('topic-results');root.replaceChildren();const query=clean($('topic-search').value).toLowerCase();if(!query){text(root,'p','Search the topic code or title.','no-results');return;}
  const found=[];for(const key of Object.keys(COURSES))for(const topic of state.courses[key]?.topics||[]){if((topic.code+' '+topic.title).toLowerCase().includes(query))found.push({key,topic});}
  if(!found.length){text(root,'p','No matching topics.','no-results');return;}
  for(const {key,topic} of found.slice(0,12)){
    const button=text(root,'button','','topic-result');button.type='button';text(button,'b',topic.code+' · '+topic.title);text(button,'small',COURSES[key].short);
    button.onclick=()=>{const plannedDay=state.courses[key].days.find(day=>day.topic===topic.code);if(plannedDay){state.courseFilter=key;$('course-filter').value=key;state.week=Math.floor((plannedDay.row-4)/5);render();openEditor(key,plannedDay);}
      else notice(topic.code+' · '+topic.title+' is not scheduled yet. Select an open day in '+COURSES[key].short+' to add it.');};
  }
}
function renderLinks(){const root=$('course-links');root.replaceChildren();let found=false;for(const course of Object.values(COURSES)){if(!course.page)continue;
  try{const url=new URL(course.page);if(!['https:','http:'].includes(url.protocol))continue;const a=text(root,'a',course.name+' page ↗');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';found=true;}catch{}
  }if(!found)text(root,'p','Add your existing course page links in config.js to see them here.','side-help');}
function render(){renderSummary();renderWeek();renderRadar();renderDistrictDates();renderTopics();renderLinks();}
function topicContext(key,code){const topic=state.courses[key]?.topics.find(item=>item.code===code);if(!topic)return 'Choose a topic to see its learning target and resources.';
  return [topic.title,topic.target?'Target: '+topic.target:'',...topic.resources.slice(0,3).map(([label,value])=>label+': '+value),topic.detail?'Planning note: '+topic.detail:''].filter(Boolean).join('\n');
}
function openEditor(key,day){if(!connected()){notice('Connect Google to edit a lesson.','error');return;}
  state.current={key,row:day.row,original:{...day}};
  const form=$('edit-form'),config=COURSES[key],course=state.courses[key],thursday=(day.row-4)%5===3,mirror=key==='anatomy'&&thursday,homeworkOnly=isHomeworkDay(key,day),view=lessonFor(key,day);
  $('edit-course').textContent=config.name+' · Week '+(Math.floor((day.row-4)/5)+1);
  $('edit-title').textContent=day.topic?'Edit lesson '+day.topic:'Plan a lesson';$('edit-weekday').textContent=dayNames[(day.row-4)%5];$('edit-error').textContent='';
  form.elements.date.value=day.date||resolvedDate(Math.floor((day.row-4)/5),(day.row-4)%5);
  const select=form.elements.topic;select.replaceChildren(new Option('Select a topic',''));
  for(const topic of course.topics)select.add(new Option(topic.code+' · '+topic.title,topic.code));
  if(day.topic&&!course.topics.some(topic=>topic.code===day.topic))select.add(new Option(day.topic+' · Current sheet value',day.topic));
  select.value=day.topic;form.elements.classPlan.value=day.classPlan;form.elements.homework.value=day.homework;form.elements.note.value=day.note;form.elements.taught.checked=day.taught;
  select.disabled=mirror;form.elements.classPlan.disabled=mirror||homeworkOnly;form.elements.taught.disabled=homeworkOnly;
  $('class-plan-label').classList.toggle('hidden',mirror||homeworkOnly);$('taught-label').classList.toggle('hidden',homeworkOnly);
  $('topic-context').textContent=mirror?topicContext(key,view.topic):topicContext(key,day.topic);
  updateDayGuidance();
  $('editor').showModal();
}
function updateDayGuidance(){if(!state.current)return;const {key,row}=state.current,day=state.courses[key]?.days?.[row-4],form=$('edit-form'),date=form.elements.date.value,events=districtEvents(date),guide=[];
  if(key==='anatomy'&&(row-4)%5===3)guide.push('Thursday repeats Wednesday’s Anatomy lesson. Edit the Wednesday card to change that shared plan; Thursday homework and notes are separate.');
  if(isHomeworkDay(key,day))guide.push('AP Biology does not meet on Thursday. This card is for homework and teacher notes.');
  guide.push(...events.map(event=>event[2]+(event[3]==='closed'?' — avoid scheduling an in-class lesson.':'')));
  const node=$('day-guidance');node.textContent=guide.join(' ');node.classList.toggle('hidden',!guide.length);
}
async function saveEditor(event){event.preventDefault();if(!state.current||state.saving)return;
  const {key,row,original}=state.current,course=COURSES[key],data=state.courses[key],form=$('edit-form');$('edit-error').textContent='';
  if(!connected()){$('edit-error').textContent='Session expired. Connect Google again.';return;}
  const date=form.elements.date.value;if(date&&htmlDate(serialDate(date))!==date){$('edit-error').textContent='Enter a valid date.';return;}
  const mirror=key==='anatomy'&&(row-4)%5===3,homeworkOnly=isHomeworkDay(key,original);
  const inputs=[
    {column:2,old:original.rawDate,newValue:date?serialDate(date):'',kind:'date'},
    {column:3,old:original.topic,newValue:mirror?original.topic:form.elements.topic.value,kind:'text'},
    {column:5,old:original.classPlan,newValue:mirror||homeworkOnly?original.classPlan:form.elements.classPlan.value.trim(),kind:'text'},
    {column:8,old:original.homework,newValue:form.elements.homework.value.trim(),kind:'text'},
    {column:10,old:original.note,newValue:form.elements.note.value.trim(),kind:'text'},
    {column:11,old:original.rawTaught,newValue:homeworkOnly?original.taught:form.elements.taught.checked,kind:'taught'}
  ];
  const comparable=input=>input.kind==='date'?(v=>htmlDate(v)):input.kind==='taught'?(v=>v===true||String(v).toLowerCase()==='true'):(v=>safeText(v));
  const changes=inputs.filter(field=>comparable(field)(field.old)!==comparable(field)(field.newValue));
  if(!changes.length){$('editor').close();return;}
  if(changes.some(field=>field.column===11)&&data.statusHeader&&data.statusHeader!=='Taught'){$('edit-error').textContent='Column L is already in use in this sheet. Taught status cannot be saved there.';return;}
  state.saving=true;$('save-edit').disabled=true;
  try{
    const range=a1(course.calendar)+'!A'+row+':L'+row;
    const response=await api(course,'/values/'+encodeURIComponent(range)+'?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER');
    const live=response.values?.[0]||[];
    if(clean(live[0])!==original.week||changes.some(field=>comparable(field)(live[field.column])!==comparable(field)(field.old)))throw Error('This lesson changed in the sheet. Cancel, refresh, and reopen it before saving.');
    const requests=changes.map(field=>{let userEnteredValue;
      if(field.kind==='date')userEnteredValue=field.newValue===''?{stringValue:''}:{numberValue:field.newValue};
      else if(field.kind==='taught')userEnteredValue=field.newValue?{boolValue:true}:{stringValue:''};
      else userEnteredValue={stringValue:field.newValue};
      return {updateCells:{start:{sheetId:data.sheetId,rowIndex:row-1,columnIndex:field.column},rows:[{values:[{userEnteredValue}]}],fields:'userEnteredValue'}};
    });
    if(changes.some(field=>field.column===11)&&!data.statusHeader){
      // One-time label in the unused L column. Never touch AP Biology's M topic list.
      const header=await api(course,'/values/'+encodeURIComponent(a1(course.calendar)+'!L3'));
      if(header.values?.[0]?.[0])throw Error('Column L acquired a header in the sheet. Refresh before editing taught status.');
      requests.unshift({updateCells:{start:{sheetId:data.sheetId,rowIndex:2,columnIndex:11},rows:[{values:[{userEnteredValue:{stringValue:'Taught'}}]}],fields:'userEnteredValue'}});
    }
    await api(course,':batchUpdate',{method:'POST',body:JSON.stringify({requests})});
    $('editor').close();state.current=null;state.saving=false;notice('Saved '+course.short+' lesson to Google Sheets.','success');
    await load(false);
  }catch(err){$('edit-error').textContent=err.message;notice('Could not save: '+err.message,'error');}
  finally{state.saving=false;$('save-edit').disabled=false;}
}
$('connect').onclick=connect;$('disconnect').onclick=disconnect;$('refresh').onclick=()=>load(false);
$('previous').onclick=()=>{state.week=Math.max(0,state.week-1);render();};$('next').onclick=()=>{state.week=Math.min(35,state.week+1);render();};
$('today').onclick=()=>{state.week=firstWeek();render();};
$('week-picker').onchange=event=>{state.week=Number(event.target.value);render();};
$('course-filter').onchange=event=>{state.courseFilter=event.target.value;render();};
$('topic-search').oninput=renderTopics;
$('edit-form').onsubmit=saveEditor;$('edit-form').elements.topic.onchange=event=>{$('topic-context').textContent=topicContext(state.current?.key,event.target.value);};
$('edit-form').elements.date.onchange=updateDayGuidance;
$('close-edit').onclick=$('cancel-edit').onclick=()=>$('editor').close();
$('editor').addEventListener('close',()=>{if(!state.saving)state.current=null;});
