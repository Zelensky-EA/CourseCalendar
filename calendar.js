// SUHSD 2026–27 district academic calendar. These are display-only teacher
// reminders; the original Sheets remain the source of lesson plans and dates.
const schoolWeeks = Array.from({length:43},(_,index)=>{
  const monday=new Date(Date.UTC(2026,7,3+index*7));
  return Object.freeze({start:monday.toISOString().slice(0,10),term:index<20?'Fall':index<23?'Winter break':'Spring',label:index<20?'Fall Week '+(index+1):index<23?'Winter W'+(index-19):'Spring Week '+(index-22),sheetWeek:index<20?index+1:index<23?'W'+(index-19):index-22});
});
window.DISTRICT_CALENDAR = Object.freeze({
  weeks:schoolWeeks,
  dateFor(index){const monday=new Date(this.weeks[Math.floor(index/5)].start+'T00:00:00Z');monday.setUTCDate(monday.getUTCDate()+index%5);return monday.toISOString().slice(0,10);},
  source: 'https://resources.finalsite.net/images/v1780338576/salinasuhsdorg/kzr1ufhfq56vwhnn46jc/2026-2027SUHSDAcademicCalendar.pdf',
  events: [
    ['2026-08-03','2026-08-04','No student classes · certificated preparation','closed'],
    ['2026-08-05','2026-08-05','First day of instruction','milestone'],
    ['2026-09-07','2026-09-07','Labor Day · no classes','closed'],
    ['2026-09-09','2026-09-09','First progress report due','deadline'],
    ['2026-10-12','2026-10-12','Fall break · no classes','closed'],
    ['2026-10-14','2026-10-14','Quarter 1 grades due','deadline'],
    ['2026-11-11','2026-11-11','Veterans Day · no classes','closed'],
    ['2026-11-17','2026-11-17','Second progress report due','deadline'],
    ['2026-11-23','2026-11-27','Thanksgiving break · no classes','closed'],
    ['2026-12-18','2026-12-18','Minimum day · last day of semester 1 instruction','minimum'],
    ['2026-12-21','2027-01-08','Winter break · no classes','closed'],
    ['2026-12-22','2026-12-22','Semester 1 / Quarter 2 grades due','deadline'],
    ['2027-01-11','2027-01-11','Certificated work day · no student classes','closed'],
    ['2027-01-12','2027-01-12','First day of semester 2 instruction','milestone'],
    ['2027-01-18','2027-01-18','Martin Luther King Jr. Day · no classes','closed'],
    ['2027-02-15','2027-02-15','Presidents’ Day · no classes','closed'],
    ['2027-02-17','2027-02-17','Third progress report due','deadline'],
    ['2027-03-22','2027-03-26','Spring break · no classes','closed'],
    ['2027-03-29','2027-03-29','Farmworkers Day observed · no classes','closed'],
    ['2027-03-31','2027-03-31','Quarter 3 grades due','deadline'],
    ['2027-04-27','2027-04-27','Fourth progress report due','deadline'],
    ['2027-05-27','2027-05-27','Student minimum day · last day of instruction','minimum'],
    ['2027-05-28','2027-05-28','Certificated work day · no student classes','closed'],
    ['2027-05-31','2027-05-31','Memorial Day · district holiday','closed'],
    ['2027-06-01','2027-06-01','Semester 2 / Quarter 4 grades due','deadline']
  ]
});
