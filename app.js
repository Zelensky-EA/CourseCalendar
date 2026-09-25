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
const AP_EXAM_DATE='2027-05-03';
const WEEK_COUNT=district.weeks.length,DAY_COUNT=WEEK_COUNT*5,LAST_ROW=DAY_COUNT+3;
const weekLabel=index=>district.weeks[index].label;
const districtEvents=date=>date?district.events.filter(([start,end])=>start<=date&&date<=end):[];
const noSchool=date=>districtEvents(date).some(event=>event[3]==='closed');
const isHomeworkDay=(key,day)=>key==='bio'&&(day.row-4)%5===3;
function hasClass(key,day){return !noSchool(day.date)&&!isHomeworkDay(key,day)&&!(key==='bio'&&(day.date===AP_EXAM_DATE||/^no class\b/i.test(clean(day.classPlan))));}
function scheduledLesson(key,day){return hasClass(key,day)&&planned(day);}
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
function parseDays(rows){return Array.from({length:DAY_COUNT},(_,index)=>{
  const row=rows?.[index]||[],sheetRow=index+4;
  return {row:sheetRow,week:clean(row[0]),weekday:clean(row[1])||dayNames[index%5],date:htmlDate(row[2])||district.dateFor(index),rawDate:row[2]??'',topic:clean(row[3]),topicTitle:clean(row[4]),classPlan:safeText(row[5]),resourceOne:safeText(row[6]),resourceTwo:safeText(row[7]),homework:safeText(row[8]),target:safeText(row[9]),note:safeText(row[10])};
});}
async function fetchCourse(key){const course=COURSES[key];
  const params=new URLSearchParams({valueRenderOption:'UNFORMATTED_VALUE',dateTimeRenderOption:'SERIAL_NUMBER'});
  params.append('ranges',a1(course.calendar)+'!A3:K'+LAST_ROW);params.append('ranges',a1(course.reference)+'!'+course.referenceRange);
  const [batch,meta]=await Promise.all([api(course,'/values:batchGet?'+params),api(course,'?fields=sheets.properties(sheetId,title,gridProperties(rowCount))')]);
  const sheet=meta.sheets?.find(item=>item.properties?.title===course.calendar);
  if(!sheet)throw Error('Could not find '+course.calendar+' in '+course.name+'.');
  const main=batch.valueRanges?.[0]?.values||[];
  return {days:parseDays(main.slice(1)),topics:parseTopics(key,batch.valueRanges?.[1]?.values),sheetId:sheet.properties.sheetId,rowCount:sheet.properties.gridProperties?.rowCount||0,updated:Date.now()};
}
function firstWeek(){const today=localToday();let previous=null,next=null;
  for(let i=0;i<WEEK_COUNT;i++)for(const key of Object.keys(COURSES)){
    const date=state.courses[key]?.days?.[i*5]?.date;
    if(!date)continue;
    if(date<=today)previous=i;else if(next===null)next=i;
  }
  return previous??next??0;
}
async function load(initial=false){if(!connected()||state.busy||state.saving)return;
  state.busy=true;$('refresh').disabled=true;$('fill-dates').disabled=true;notice('Refreshing course calendars…');
  try{
    const result=await Promise.allSettled(Object.keys(COURSES).map(fetchCourse));
    let errors=[];Object.keys(COURSES).forEach((key,i)=>{if(result[i].status==='fulfilled')state.courses[key]=result[i].value;else errors.push(COURSES[key].short+': '+result[i].reason.message);});
    if(!Object.keys(state.courses).length)throw Error(errors.join(' | '));
    if(initial||state.week===null)state.week=firstWeek();
    $('app').classList.remove('hidden');render();
    notice(errors.length?'Some calendars could not load. '+errors.join(' | '):'Live calendars refreshed at '+new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}),errors.length?'error':'success');
  }catch(err){notice(err.message,'error');}
  finally{state.busy=false;$('refresh').disabled=false;$('fill-dates').disabled=false;}
}
async function fillCourseDates(key){const course=COURSES[key],data=state.courses[key];if(!data)throw Error(course.short+' has not loaded.');
  const range=a1(course.calendar)+'!A3:K'+LAST_ROW;
  const snapshot=await api(course,'/values/'+encodeURIComponent(range)+'?valueRenderOption=FORMULA&dateTimeRenderOption=SERIAL_NUMBER');
  const rows=snapshot.values||[],template=rows[180]||[],formulaColumns=[4,6,7,9];
  if(formulaColumns.some(col=>!safeText(template[col]).startsWith('=')))throw Error(course.short+': could not verify formula templates in row 183. No dates were changed.');
  const requests=[];let filled=0,renamed=0,extended=0;
  for(let index=0;index<DAY_COUNT;index++){
    const row=index+4,live=rows[row-3]||[],week=Math.floor(index/5),label=district.weeks[week].sheetWeek,oldWeek=clean(live[0]),oldDay=clean(live[1]),expectedDay=dayNames[index%5].slice(0,3);
    if(oldWeek&&oldWeek!==String(week+1)&&oldWeek!==String(label))throw Error(course.short+': week label A'+row+' has a custom value. No dates were changed.');
    if(oldDay&&oldDay.toLowerCase()!==expectedDay.toLowerCase()&&oldDay.toLowerCase()!==dayNames[index%5].toLowerCase())throw Error(course.short+': weekday B'+row+' has a custom value. No dates were changed.');
    const cell=(columnIndex,userEnteredValue)=>requests.push({updateCells:{start:{sheetId:data.sheetId,rowIndex:row-1,columnIndex},rows:[{values:[{userEnteredValue}]}],fields:'userEnteredValue'}});
    if(oldWeek!==String(label)){cell(0,typeof label==='number'?{numberValue:label}:{stringValue:label});renamed++;}
    if(!oldDay)cell(1,{stringValue:expectedDay});
    if(live[2]===undefined||live[2]===null||live[2]===''){cell(2,{numberValue:serialDate(district.dateFor(index))});filled++;}
    if(row>183)for(const col of formulaColumns){if(!live[col]){cell(col,{formulaValue:template[col].replaceAll('$D183','$D'+row)});extended++;}}
  }
  if(!requests.length)return {filled,renamed,extended};
  if(data.rowCount<LAST_ROW)await api(course,':batchUpdate',{method:'POST',body:JSON.stringify({requests:[{appendDimension:{sheetId:data.sheetId,dimension:'ROWS',length:LAST_ROW-data.rowCount}}]})});
  requests.unshift({repeatCell:{range:{sheetId:data.sheetId,startRowIndex:183,endRowIndex:LAST_ROW,startColumnIndex:2,endColumnIndex:3},cell:{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'mmm d, yyyy'}}},fields:'userEnteredFormat.numberFormat'}});
  await api(course,':batchUpdate',{method:'POST',body:JSON.stringify({requests})});
  return {filled,renamed,extended};
}
async function fillDates(){if(!connected()||state.busy||state.saving)return;state.busy=true;$('fill-dates').disabled=true;$('refresh').disabled=true;
  notice('Adding 2026–27 dates, break weeks, and semester week labels to your two sheets…');
  const successes=[],failures=[];
  for(const key of Object.keys(COURSES))try{const changes=await fillCourseDates(key);successes.push(COURSES[key].short+': '+changes.filled+' dates added');}
    catch(error){failures.push(COURSES[key].short+': '+error.message);}
  state.busy=false;$('fill-dates').disabled=false;$('refresh').disabled=false;
  await load(false);
  notice(successes.concat(failures).join(' | ')+(failures.length?' · Check access and retry.':' · Sheets are up to date.'),failures.length?'error':'success');
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
function pacing(key){const days=state.courses[key]?.days||[],today=localToday();return {
  covered:days.filter(d=>d.date<today&&scheduledLesson(key,d)).length,
  upcoming:days.filter(d=>d.date>=today&&scheduledLesson(key,d)).length
};}
function upcomingOpen(key){const today=localToday();return (state.courses[key]?.days||[]).filter(d=>d.date>=today&&hasClass(key,d)).slice(0,10).filter(d=>!planned(d)).length;}
function renderSummary(){let open=0;
  for(const key of Object.keys(COURSES)){
    const pace=pacing(key),label=$(key+'-pace'),stats=$(key+'-stats');
    if(!state.courses[key]){label.textContent='Unavailable';stats.textContent='Could not load calendar';continue;}
    label.textContent=pace.covered+' lessons covered';stats.textContent=pace.upcoming+' future lessons planned';open+=upcomingOpen(key);
  }
  $('focus-value').textContent=open+' to plan';$('focus-detail').textContent='Open class sessions in each course’s next 10 meetings';
  const remaining=(state.courses.bio?.days||[]).filter(d=>d.date>=localToday()&&d.date<AP_EXAM_DATE&&hasClass('bio',d)).length;
  $('exam-remaining').textContent=state.courses.bio?remaining+' class sessions':'—';
  $('exam-detail').textContent='Before May 3, 2027 · excludes exam day and no-class dates';
}
function unitDistribution(key,days,today=localToday()){const first=key==='bio'?1:0,last=key==='bio'?8:12,units=Array.from({length:last-first+1},()=>0);let coded=0,uncoded=0;
  for(const day of days||[]){if(day.date>=today||!scheduledLesson(key,day))continue;
    const found=clean(day.topic).match(/^(\d{1,2})(?:\.|$)/),unit=found?Number(found[1]):NaN;
    if(unit>=first&&unit<=last){units[unit-first]++;coded++;}else uncoded++;
  }
  return {units,first,coded,uncoded};
}
function renderUnitBreakdown(){for(const key of Object.keys(COURSES)){
  const root=$(key+'-unit-breakdown');root.replaceChildren();const {units,first,coded,uncoded}=unitDistribution(key,state.courses[key]?.days);
  if(!coded){text(root,'p','No completed class sessions with unit topic codes yet.','no-results');continue;}
  for(let i=0;i<units.length;i++){
    const percent=Math.round(units[i]/coded*100),item=text(root,'div','','unit-item'),heading=text(item,'div','','unit-heading');
    text(heading,'span','Unit '+(i+first));text(heading,'strong',percent+'%');
    const bar=text(item,'div','','unit-track');const fill=text(bar,'span','','unit-fill');fill.style.width=percent+'%';
    item.title=units[i]+' of '+coded+' topic-coded '+COURSES[key].name+' class sessions';
  }
  if(uncoded)text(root,'p',uncoded+' past class session'+(uncoded===1?'':'s')+' without a unit topic code excluded from percentages.','side-help');
  }
}
function dayFor(key,week,offset){return state.courses[key]?.days?.[week*5+offset];}
function resolvedDate(week,offset){for(const key of Object.keys(COURSES)){const date=dayFor(key,week,offset)?.date;if(date)return date;}return '';}
function renderWeek(){const week=Math.min(WEEK_COUNT-1,Math.max(0,state.week||0));state.week=week;
  const picker=$('week-picker');picker.replaceChildren();for(let n=0;n<WEEK_COUNT;n++){
    const date=Array.from({length:5},(_,i)=>resolvedDate(n,i)).find(Boolean);
    picker.add(new Option(weekLabel(n)+(date?' · '+formatDate(date):''),String(n)));
  }picker.value=String(week);
  const dates=Array.from({length:5},(_,i)=>resolvedDate(week,i)).filter(Boolean);
  $('week-title').textContent=weekLabel(week);
  $('week-range').textContent=dates.length?formatDate(dates[0])+' – '+formatDate(dates[dates.length-1],{month:'short',day:'numeric',year:'numeric'}):'Dates can be added in any daily plan.';
  $('previous').disabled=week===0;$('next').disabled=week===WEEK_COUNT-1;
  const grid=$('week-grid');grid.replaceChildren();let covered=0,scheduled=0;
  const header=text(grid,'div','','date-strip');
  for(let i=0;i<5;i++){
    const date=resolvedDate(week,i),events=districtEvents(date),cell=text(header,'div','','date-cell'+(date===localToday()?' today':'')+(noSchool(date)?' closed-day':''));
    text(cell,'strong',dayNames[i]);text(cell,'small',formatDate(date));
    for(const event of events)text(cell,'div',event[2],'district-badge '+event[3]);
  }
  for(const key of visibleKeys()){
    const lane=text(grid,'section','','course-lane '+key);text(lane,'h3',COURSES[key].name,'lane-heading');
    const row=text(lane,'div','','course-grid');
    for(let i=0;i<5;i++){
      const day=dayFor(key,week,i);if(!day)continue;const view=day,homeworkOnly=isHomeworkDay(key,day);
      if(scheduledLesson(key,day)){scheduled++;if(day.date<localToday())covered++;}
      const card=text(row,'article','','day course-card'+(day.date===localToday()?' today':'')+(noSchool(day.date)?' closed-day':''));
      const lesson=text(card,'div','','lesson '+key),top=text(lesson,'div','','lesson-top');text(top,'span',COURSES[key].short,'lesson-tag');
      text(top,'span',noSchool(day.date)?'No classes':homeworkOnly?'Homework only':key==='bio'&&/^no class\b/i.test(clean(day.classPlan))?'No class':scheduledLesson(key,day)?day.date<localToday()?'Covered':'Planned':'Open',day.date<localToday()&&scheduledLesson(key,day)?'state done':'state');
      if(day.date!==resolvedDate(week,i))text(lesson,'small','Sheet date: '+formatDate(day.date),'date-override');
      if(homeworkOnly)text(lesson,'div','No AP Biology class Thursday','routine');
      const subject=state.courses[key].topics.find(topic=>topic.code===view.topic);
      if(view.topic||view.topicTitle)text(lesson,'div',(view.topic?view.topic+' · ':'')+(subject?.title||view.topicTitle.split('\n')[0]||'Topic'), 'topic-title');
      else if(!homeworkOnly)text(lesson,'div','No topic selected','lesson-empty');
      if(!homeworkOnly&&clean(view.classPlan))text(lesson,'p',clean(view.classPlan),'plan-preview');
      if(clean(day.homework))text(lesson,'p','Homework: '+clean(day.homework),'plan-preview');
      if(clean(day.note))text(lesson,'p','Teacher note: '+clean(day.note),'note-preview');
      if(!homeworkOnly&&clean(view.target))text(lesson,'p','Target: '+clean(view.target),'target-preview');
      const actions=text(lesson,'div','','lesson-actions');const button=text(actions,'button',homeworkOnly?'Edit homework':planned(day)?'Edit plan':'Add plan','edit-lesson');button.type='button';button.onclick=()=>openEditor(key,day);
      if(scheduledLesson(key,day)){const push=text(actions,'button','Push to next class →','push-lesson');push.type='button';push.onclick=()=>pushLesson(key,day);}
    }
  }
  $('week-progress').textContent=covered+' of '+scheduled+' planned class sessions have passed';
}
function renderRadar(){const root=$('radar');root.replaceChildren();const tasks=[];for(const key of visibleKeys())for(const day of state.courses[key].days){if(day.date>=localToday()&&hasClass(key,day)&&!planned(day))tasks.push({key,day});}
  tasks.sort((a,b)=>a.day.date.localeCompare(b.day.date));
  if(!tasks.length){text(root,'div','Upcoming class sessions have plans.','radar-line');return;}
  for(const task of tasks.slice(0,5)){
    const item=text(root,'div','','radar-line');text(item,'strong',COURSES[task.key].short+' · '+formatDate(task.day.date));
    text(item,'span','No class plan entered');const button=text(item,'button','Add plan');button.type='button';button.onclick=()=>{state.week=Math.floor((task.day.row-4)/5);renderWeek();openEditor(task.key,task.day);};
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
function renderLinks(){const root=$('course-links');root.replaceChildren();const links=[
    ['AP Biology Navigator',CFG.apBiologyPage],['Anatomy & Physiology Navigator',CFG.anatomyPage],
    ['AP Classroom','https://apclassroom.collegeboard.org/'],['TeachQuest classroom','https://teach-quest.com/classroom'],['Clever teacher','https://clever.com/in/suhsd/teacher']
  ];
  for(const [label,address] of links){if(!address)continue;try{const url=new URL(address);if(url.protocol!=='https:')continue;const a=text(root,'a',label+' ↗');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';}catch{}}
}
function render(){renderSummary();renderWeek();renderRadar();renderUnitBreakdown();renderDistrictDates();renderTopics();renderLinks();}
function topicContext(key,code){const topic=state.courses[key]?.topics.find(item=>item.code===code);if(!topic)return 'Choose a topic to see its learning target and resources.';
  return [topic.title,topic.target?'Target: '+topic.target:'',...topic.resources.slice(0,3).map(([label,value])=>label+': '+value),topic.detail?'Planning note: '+topic.detail:''].filter(Boolean).join('\n');
}
function openEditor(key,day){if(!connected()){notice('Connect Google to edit a lesson.','error');return;}
  state.current={key,row:day.row,original:{...day}};
  const form=$('edit-form'),config=COURSES[key],course=state.courses[key],homeworkOnly=isHomeworkDay(key,day);
  $('edit-course').textContent=config.name+' · '+weekLabel(Math.floor((day.row-4)/5));
  $('edit-title').textContent=day.topic?'Edit lesson '+day.topic:'Plan a lesson';$('edit-weekday').textContent=dayNames[(day.row-4)%5];$('edit-error').textContent='';
  form.elements.date.value=day.date||resolvedDate(Math.floor((day.row-4)/5),(day.row-4)%5);
  const select=form.elements.topic;select.replaceChildren(new Option('Select a topic',''));
  for(const topic of course.topics)select.add(new Option(topic.code+' · '+topic.title,topic.code));
  if(day.topic&&!course.topics.some(topic=>topic.code===day.topic))select.add(new Option(day.topic+' · Current sheet value',day.topic));
  select.value=day.topic;form.elements.classPlan.value=day.classPlan;form.elements.homework.value=day.homework;form.elements.note.value=day.note;
  form.elements.classPlan.disabled=homeworkOnly;
  $('class-plan-label').classList.toggle('hidden',homeworkOnly);
  $('topic-context').textContent=topicContext(key,day.topic);
  updateDayGuidance();
  $('editor').showModal();
}
function updateDayGuidance(){if(!state.current)return;const {key,row}=state.current,day=state.courses[key]?.days?.[row-4],form=$('edit-form'),date=form.elements.date.value,events=districtEvents(date),guide=[];
  if(isHomeworkDay(key,day))guide.push('AP Biology does not meet on Thursday. This card is for homework and teacher notes.');
  guide.push(...events.map(event=>event[2]+(event[3]==='closed'?' — avoid scheduling an in-class lesson.':'')));
  const node=$('day-guidance');node.textContent=guide.join(' ');node.classList.toggle('hidden',!guide.length);
}
async function saveEditor(event){event.preventDefault();if(!state.current||state.saving)return;
  const {key,row,original}=state.current,course=COURSES[key],data=state.courses[key],form=$('edit-form');$('edit-error').textContent='';
  if(!connected()){$('edit-error').textContent='Session expired. Connect Google again.';return;}
  const date=form.elements.date.value;if(date&&htmlDate(serialDate(date))!==date){$('edit-error').textContent='Enter a valid date.';return;}
  const homeworkOnly=isHomeworkDay(key,original);
  const inputs=[
    {column:2,old:original.rawDate,newValue:date?serialDate(date):'',kind:'date'},
    {column:3,old:original.topic,newValue:form.elements.topic.value,kind:'text'},
    {column:5,old:original.classPlan,newValue:homeworkOnly?original.classPlan:form.elements.classPlan.value.trim(),kind:'text'},
    {column:8,old:original.homework,newValue:form.elements.homework.value.trim(),kind:'text'},
    {column:10,old:original.note,newValue:form.elements.note.value.trim(),kind:'text'}
  ];
  const comparable=input=>input.kind==='date'?(v=>htmlDate(v)):(v=>safeText(v));
  const changes=inputs.filter(field=>comparable(field)(field.old)!==comparable(field)(field.newValue));
  if(!changes.length){$('editor').close();return;}
  state.saving=true;$('save-edit').disabled=true;
  try{
    const range=a1(course.calendar)+'!A'+row+':K'+row;
    const response=await api(course,'/values/'+encodeURIComponent(range)+'?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER');
    const live=response.values?.[0]||[];
    if(clean(live[0])!==original.week||changes.some(field=>comparable(field)(live[field.column])!==comparable(field)(field.old)))throw Error('This lesson changed in the sheet. Cancel, refresh, and reopen it before saving.');
    const requests=changes.map(field=>{let userEnteredValue;
      if(field.kind==='date')userEnteredValue=field.newValue===''?{stringValue:''}:{numberValue:field.newValue};
      else userEnteredValue={stringValue:field.newValue};
      return {updateCells:{start:{sheetId:data.sheetId,rowIndex:row-1,columnIndex:field.column},rows:[{values:[{userEnteredValue}]}],fields:'userEnteredValue'}};
    });
    let copied=false,customThursday=false;
    if(key==='anatomy'&&(row-4)%5===2&&changes.some(field=>field.column===3||field.column===5)){
      const thu=data.days[row-3];
      if(thu&&!noSchool(thu.date)){
        const thuRange=a1(course.calendar)+'!A'+(row+1)+':F'+(row+1);
        const thuLive=(await api(course,'/values/'+encodeURIComponent(thuRange)+'?valueRenderOption=UNFORMATTED_VALUE')).values?.[0]||[];
        if(clean(thuLive[0])!==thu.week||safeText(thuLive[3])!==thu.topic||safeText(thuLive[5])!==thu.classPlan)throw Error('Thursday changed in the sheet. Refresh and try saving Wednesday again.');
        const blank=!clean(thu.topic)&&!clean(thu.classPlan),previousCopy=thu.topic===original.topic&&thu.classPlan===original.classPlan;
        if(blank||previousCopy){for(const [column,value] of [[3,form.elements.topic.value],[5,form.elements.classPlan.value.trim()]])
          if(safeText(thuLive[column])!==value)requests.push({updateCells:{start:{sheetId:data.sheetId,rowIndex:row,columnIndex:column},rows:[{values:[{userEnteredValue:{stringValue:value}}]}],fields:'userEnteredValue'}});
          copied=true;
        }else customThursday=true;
      }
    }
    await api(course,':batchUpdate',{method:'POST',body:JSON.stringify({requests})});
    $('editor').close();state.current=null;state.saving=false;
    await load(false);
    notice('Saved '+course.short+' lesson.'+(copied?' Wednesday’s topic and class plan were copied into Thursday.':customThursday?' Thursday has its own plan and was kept as is.' : ''),'success');
  }catch(err){$('edit-error').textContent=err.message;notice('Could not save: '+err.message,'error');}
  finally{state.saving=false;$('save-edit').disabled=false;}
}
async function pushLesson(key,day){if(!connected()||state.busy||state.saving)return;
  const course=COURSES[key],data=state.courses[key],start=day.row-4;
  if(!scheduledLesson(key,day))return;
  const slots=[];let foundGap=false;
  for(let i=start;i<data.days.length;i++){
    const candidate=data.days[i];if(!hasClass(key,candidate))continue;
    slots.push(candidate);
    if(i>start&&!planned(candidate)&&!clean(candidate.homework)){foundGap=true;break;}
  }
  if(!foundGap){notice('No open '+course.short+' class session remains in this school-year calendar. Clear or reschedule a later plan first.','error');return;}
  if(slots.some(item=>item.row>data.rowCount||!item.week||!item.rawDate)){notice('Click “Fill dates in both sheets” first to prepare every class date in this move.','error');return;}
  const ending=slots[slots.length-1],moves=slots.length-1;
  if(!window.confirm('Push '+moves+' '+course.short+' lesson'+(moves===1?'':'s')+' forward by one class meeting, from '+formatDate(day.date)+' through '+formatDate(ending.date)+'? The first class plan becomes empty. Homework moves with each lesson; teacher notes stay on their original dates.'))return;
  state.saving=true;$('refresh').disabled=true;$('fill-dates').disabled=true;notice('Moving '+course.short+' lessons to their next class meetings…');
  try{
    const range=a1(course.calendar)+'!A'+day.row+':K'+ending.row;
    const live=(await api(course,'/values/'+encodeURIComponent(range)+'?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER')).values||[];
    const sourceFor=item=>live[item.row-day.row]||[];
    for(const item of slots){const cells=sourceFor(item);
      if(clean(cells[0])!==item.week||htmlDate(cells[2])!==htmlDate(item.rawDate)||safeText(cells[3])!==item.topic||safeText(cells[5])!==item.classPlan||safeText(cells[8])!==item.homework)
        throw Error('A lesson or date changed in the sheet. Refresh before pushing lessons.');
    }
    const requests=[],fields=[3,5,8];
    const write=(row,column,value)=>requests.push({updateCells:{start:{sheetId:data.sheetId,rowIndex:row-1,columnIndex:column},rows:[{values:[{userEnteredValue:typeof value==='number'?{numberValue:value}:{stringValue:safeText(value)}}]}],fields:'userEnteredValue'}});
    for(let i=slots.length-1;i>=1;i--){const from=sourceFor(slots[i-1]);for(const col of fields)write(slots[i].row,col,from[col]??'');}
    for(const col of fields)write(day.row,col,'');
    await api(course,':batchUpdate',{method:'POST',body:JSON.stringify({requests})});
    state.saving=false;await load(false);
    notice('Moved '+moves+' '+course.short+' lesson'+(moves===1?'':'s')+' forward by one class session.','success');
  }catch(err){notice('Could not move lessons: '+err.message,'error');}
  finally{state.saving=false;$('refresh').disabled=false;$('fill-dates').disabled=false;}
}
$('connect').onclick=connect;$('disconnect').onclick=disconnect;$('refresh').onclick=()=>load(false);$('fill-dates').onclick=fillDates;
$('previous').onclick=()=>{state.week=Math.max(0,state.week-1);render();};$('next').onclick=()=>{state.week=Math.min(WEEK_COUNT-1,state.week+1);render();};
$('today').onclick=()=>{state.week=firstWeek();render();};
$('week-picker').onchange=event=>{state.week=Number(event.target.value);render();};
$('course-filter').onchange=event=>{state.courseFilter=event.target.value;render();};
$('topic-search').oninput=renderTopics;
$('edit-form').onsubmit=saveEditor;$('edit-form').elements.topic.onchange=event=>{$('topic-context').textContent=topicContext(state.current?.key,event.target.value);};
$('edit-form').elements.date.onchange=updateDayGuidance;
$('close-edit').onclick=$('cancel-edit').onclick=()=>$('editor').close();
$('editor').addEventListener('close',()=>{if(!state.saving)state.current=null;});
