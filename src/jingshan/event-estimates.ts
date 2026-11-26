import type { AssessmentInputs, PlannedEvent } from './event-plan-types.ts'

export function defaultAssessmentInputs(event: PlannedEvent): AssessmentInputs {
  return {venueName:event.venueNames[0]??'',spectators:null,outsidePercent:null,overnightPercent:null,
    carPercent:35,peoplePerCar:2.5,coreM:300,bufferM:1000,scenario:false,note:''}
}

// Planning assumptions only, not measured attendance or published statistics.
function assumptions(level:string) {
  if(level.startsWith('国际'))return {label:'国际',factor:6,outside:75,overnight:70}
  if(level.startsWith('全国'))return {label:'全国',factor:4,outside:60,overnight:50}
  if(level.startsWith('省级'))return {label:'省级',factor:2,outside:40,overnight:35}
  return {label:'其他',factor:1,outside:20,overnight:20}
}

export function prepareEstimatedInputs(event:PlannedEvent,savedInputs?:AssessmentInputs):AssessmentInputs {
  const inputs={...(savedInputs??defaultAssessmentInputs(event))}
  const rule=assumptions(event.level),notes:string[]=[]
  if(inputs.spectators===null&&event.participants!==null){
    inputs.spectators=Math.min(1000000,Math.ceil(event.participants*rule.factor/50)*50)
    notes.push(`观众按参赛人数${event.participants}×${rule.factor}，向上取整至50人，预估${inputs.spectators}人`)
  }
  if(inputs.outsidePercent===null){inputs.outsidePercent=rule.outside;notes.push(`外地占比${rule.outside}%`)}
  if(inputs.overnightPercent===null){inputs.overnightPercent=rule.overnight;notes.push(`住宿比例${rule.overnight}%`)}
  if(notes.length){
    const note=`自动预估（${rule.label}赛事规划假设，非实测）：${notes.join('；')}；停车按总人数×${inputs.carPercent}%÷${inputs.peoplePerCar}；住宿房间按预估床位÷2向上取整。`
    const existing=inputs.note.trim()
    inputs.note=existing?`${existing.slice(0,Math.max(0,999-note.length))}\n${note}`:note
    inputs.scenario=true
  }
  return inputs
}

export function calculateEventDemand(event:PlannedEvent,inputs:AssessmentInputs) {
  const totalPeople=event.participants!==null&&inputs.spectators!==null?event.participants+inputs.spectators:null
  const parkingDemand=totalPeople===null?null:Math.ceil(totalPeople*inputs.carPercent/100/inputs.peoplePerCar)
  const lodgingDemand=totalPeople===null||inputs.outsidePercent===null||inputs.overnightPercent===null?null:
    Math.ceil(totalPeople*inputs.outsidePercent/100*inputs.overnightPercent/100)
  const lodgingRooms=lodgingDemand===null?null:Math.ceil(lodgingDemand/2)
  return {totalPeople,parkingDemand,lodgingDemand,lodgingRooms}
}
