import test from 'node:test'
import assert from 'node:assert/strict'
import { courtDrillFrame } from '../src/jingshan/court-drill-frame.ts'
import { facilityClusterScale } from '../src/jingshan/facility-clusters.ts'

const lngPerMeter = 1/(111195*Math.cos(31*Math.PI/180))
const coordinate = (east,north) => [113+east*lngPerMeter,31+north/111195]
const target = (east,north,count=1) => ({position:coordinate(east,north),count})
const court = (east,north) => ({...target(east,north),
  outline:[coordinate(east-18,north-9),coordinate(east+18,north+9)]})

test('点击镇街按有球场的村社取景，单村镇也停在村社层',()=>{
  const villages = [target(-1500,0,77),target(1500,0,2)]
  const frame = courtDrillFrame(villages,'town',500,360,54,0,0)
  assert.ok(Math.abs(frame.resolution-6)<.001)
  assert.equal(facilityClusterScale(frame.resolution),'village')
  assert.equal(facilityClusterScale(courtDrillFrame([villages[0]],'town',500,360,54,0,0).resolution),'village')
})

test('点击分散村社从实测球场最密处进入，单片轮廓清晰，目标始终在有场地的位置',()=>{
  const sites = [court(-3000,0),court(10,10),court(48,10),court(10,36),court(48,36),court(2500,2000)]
  for (const angle of [0,.65]) {
    const frame = courtDrillFrame(sites,'village',500,360,4.5,.75,angle)
    assert.ok(frame.resolution<=.65*Math.cos(angle)**2)
    assert.ok(Math.abs(frame.center[0]-coordinate(29,23)[0])<.00015)
    assert.ok(Math.abs(frame.center[1]-coordinate(29,23)[1])<.00015)
    assert.ok(24/(frame.resolution/(Math.cos(angle)**2))>35)
  }
  const single = courtDrillFrame([sites[0]],'village',500,360,4,0,0)
  assert.ok(single.resolution < .48)
  assert.deepEqual(single.center,sites[0].position)
})
