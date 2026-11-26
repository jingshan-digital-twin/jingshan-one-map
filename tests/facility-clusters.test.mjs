import test from 'node:test'
import assert from 'node:assert/strict'
import { facilityClusterScale, layoutFacilityMarkers, layoutServiceRangeMarkers } from '../src/jingshan/facility-clusters.ts'

function facility(id,x,y,region='新市街道',village='城中社区') {
  return {id,name:'门店'+id,region,village,category:'餐饮',position:[113,31],x,y}
}

test('依地图分辨率依次按镇街、村社聚合，再显示带设施名称的位置标记',()=>{
  const points = [facility('1',80,80),facility('2',250,90),facility('3',520,95,'新市街道','马家塝村')]
  const far = layoutFacilityMarkers(points,700,320,100)
  assert.equal(far.length,1)
  assert.equal(far[0].detail,'新市街道')
  assert.equal(far[0].members.length,3)
  const middle = layoutFacilityMarkers(points,700,320,12)
  assert.deepEqual(middle.map(m=>[m.detail,m.members.length]),[['城中社区',2],['马家塝村',1]])
  assert.ok([...far,...middle].every(m=>!m.pin && m.label))
  const near = layoutFacilityMarkers(points,700,320,1)
  assert.deepEqual(near.map(p=>p.detail),points.map(p=>p.name))
  assert.ok(near.every(p=>p.pin && p.label))
  assert.equal(near[0].y+near[0].diameter/2,points[0].y)
  assert.equal(near[0].description,'餐饮 · 门店1')
  assert.deepEqual([35.1,35,3.1,3].map(facilityClusterScale),['town','village','village','detail'])
})

test('相邻行政区域和跨镇同名村社分别统计，缺村社归属按镇单列',()=>{
  const points = [
    {...facility('1',248,220,'新市街道','前进村'),villageId:'a'},
    {...facility('2',248,220,'新市街道','前进村'),villageId:'b'},
    {...facility('3',248,220,'宋河镇','前进村'),villageId:'a'},
    facility('4',248,220,'新市街道',''),facility('5',248,220,'宋河镇','')
  ]
  const villages = layoutFacilityMarkers(points,520,400,12)
  assert.equal(villages.length,5)
  assert.equal(new Set(villages.map(m=>m.key)).size,5)
  assert.equal(villages.filter(m=>m.detail==='村社待核实').length,2)
  assert.ok(villages.every(m=>m.members.length===1))
  const towns = layoutFacilityMarkers(points,520,400,80)
  assert.deepEqual(towns.map(m=>m.members.length),[3,2])
})

test('聚合计数包含视野外的组员，支持整组设施在视野外而区域锚点可见',()=>{
  const points=[facility('1',80,80),facility('2',-100,80),facility('3',1200,900)]
  const overview=layoutFacilityMarkers(points,600,400,16)
  assert.equal(overview[0].members.length,3)
  const atBoundary=layoutFacilityMarkers(points.slice(1),600,400,16,()=>({x:200,y:150,position:[113.2,31.2]}))
  assert.deepEqual([atBoundary[0].x,atBoundary[0].y,atBoundary[0].members.length],[200,150,2])
  assert.deepEqual(atBoundary[0].target,[113.2,31.2])
})

test('镇街和村社区圆心紧邻或移出视口时只调整名称，圆心始终贴在区划投影上',()=>{
  const points=[facility('a',40,100,'甲镇','甲村'),facility('b',190,100,'甲镇','甲村'),facility('c',300,120,'乙镇','乙村')]
  for(const resolution of [12,80]) {
    const centers={'甲镇':{x:215.2,y:161.7,position:[113,31]},'乙镇':{x:219.3,y:164.2,position:[113.1,31]}}
    const anchor=(_scale,p)=>centers[p.region]
    const markers=layoutFacilityMarkers(points,500,350,resolution,anchor)
    assert.equal(markers.length,2)
    assert.ok(markers[0].label)
    for(const m of markers) {
      const origin=anchor(m.scale,m.symbol)
      assert.deepEqual([m.x,m.y,m.target],[origin.x,origin.y,origin.position])
    }
    centers['甲镇'].x=-20
    assert.deepEqual(layoutFacilityMarkers(points,500,350,resolution,anchor).map(m=>m.symbol.region),['乙镇'])
    assert.deepEqual(layoutFacilityMarkers(points,500,350,resolution,()=>null),[])
    centers['甲镇'].x=3.1
    assert.equal(layoutFacilityMarkers(points,500,350,resolution,anchor)[0].x,3.1)
  }
})

test('一公里范围内的每个场馆都有独立图标，所选场馆和中心设施名称优先避让',()=>{
  const focus = {...facility('餐馆',250,200),selected:true,serviceRangeCenter:true}
  const court = {...facility('球场',250,200),kind:'venue',category:'场馆',highlighted:true}
  const neighbor = {...court,id:'场馆2',highlighted:false}
  const markers = layoutServiceRangeMarkers([neighbor,focus,court],540,340)
  assert.deepEqual(markers.map(m=>m.symbol.id),['餐馆','球场','场馆2'])
  assert.ok(markers.every(m=>m.members.length===1 && m.pin))
  assert.ok(markers[0].label && markers[1].label)
  assert.equal(markers[0].diameter,44)
  assert.deepEqual([markers[0].x,markers[0].y+22],[focus.x,focus.y])
  assert.match(markers[0].description,/服务圈中心/)
  assert.equal(markers[1].symbol.highlighted,true)
  assert.equal(markers[1].diameter,36)
  markers.forEach((a,i)=>markers.slice(i+1).forEach(b=>assert.ok(
    Math.abs(a.x-b.x)>=(a.diameter+b.diameter)/2 || Math.abs(a.y-b.y)>=(a.diameter+b.diameter)/2)))
})

test('中心名牌为前缀预留宽度，切换场馆和移动视角时中心针尖始终指向真实位置',()=>{
  const focus = {...facility('餐馆',260,180),name:'特色餐饮',selected:true,serviceRangeCenter:true}
  const court = {...facility('球场',330,140),kind:'venue',category:'场馆'}
  for (const highlighted of [false,true]) {
    const [center,venue] = layoutServiceRangeMarkers([focus,{...court,highlighted}],540,340)
    assert.equal(center.label,'below')
    assert.deepEqual([center.labelBounds.width,center.labelBounds.height],[116,26])
    assert.deepEqual([venue.x,venue.y+18],[court.x,court.y])
    const [edgeCenter] = layoutServiceRangeMarkers([{...focus,x:20,y:40},{...court,highlighted}],540,340)
    assert.deepEqual([edgeCenter.x,edgeCenter.y+22],[20,40])
  }
  const [reference] = layoutServiceRangeMarkers([{...focus,serviceRangeCenter:false}],540,340)
  assert.equal(reference.diameter,30)
  assert.doesNotMatch(reference.description,/服务圈中心/)
})

test('场馆圈预留中心名称，密集配套就近合并且成员均可选择',()=>{
  const center = {...facility('court',230,170),kind:'venue',category:'场馆',selected:true,serviceRangeCenter:true}
  const sites = Array.from({length:24},(_,i)=>({
    ...facility('site'+i,100+(i%4)*80,90+Math.floor(i/8)*78),
    kind:i%2?'food':'medical',category:i%2?'餐饮':'医疗',
  }))
  sites.push({...sites[0],id:'mix',kind:'parking',category:'停车'})
  const pins=layoutServiceRangeMarkers([center,...sites],480,360)
  assert.equal(pins[0].description,'服务圈中心 · 场馆 · 门店court')
  assert.deepEqual([pins[0].x,pins[0].y+22],[center.x,center.y])
  assert.ok(pins[0].label)
  assert.ok(pins.some(p=>p.mixedKinds && p.members.some(site=>site.id==='mix')))
  assert.ok(pins.length<sites.length)
  assert.equal(new Set(pins.flatMap(p=>p.members.map(site=>site.id))).size,sites.length+1)
  assert.ok(pins.filter(p=>p.label).length<=5)
  const bounds=pins.flatMap(p=>p.labelBounds?[p.labelBounds]:[])
  for(const label of bounds) for(const pin of pins){
    assert.ok(pin.x+pin.diameter/2<=label.x || pin.x-pin.diameter/2>=label.x+label.width ||
      pin.y+pin.diameter/2<=label.y || pin.y-pin.diameter/2>=label.y+label.height)
  }
})

test('近景优先显示所选设施的名牌，保留邻近点和同址成员',()=>{
  const selected={...facility('hotel',300,190),name:'京山玉丰国际大酒店有限公司',selected:true}
  const markers=layoutFacilityMarkers([facility('colocated',300,190),facility('shop',347,150),selected],600,400,1)
  const pin=markers.find(m=>m.symbol.id===selected.id)
  assert.ok(pin?.label)
  assert.equal(pin.detail,selected.name)
  assert.deepEqual(pin.members.map(p=>p.id).sort(),['colocated','hotel'])
  assert.equal(markers.length,2)
})

test('镇街和村社在密集处优先给高数量组留出地名空间',()=>{
  const crowded = Array.from({length:12},(_,i)=>facility('small'+i,
    154+(i%4)*30,112+Math.floor(i/4)*32,'镇'+i,'村'+i))
  for (const resolution of [12,80]) {
    const points = Array.from({length:60},(_,i)=>facility('major'+i,200,145))
    const markers = layoutFacilityMarkers([...crowded,...points],400,290,resolution)
    const largest = markers[0]
    assert.equal(largest.members.length,60)
    assert.ok(largest.label)
    assert.deepEqual([largest.x,largest.y],[200,145])
    assert.ok(markers.every(marker=>!marker.leader))
  }
})

test('各尺度保留成员且避免标记遮挡，密集行政聚合分别可访问',()=>{
  for(const width of [320,720,1100]) for(const resolution of [1,12,80]){
    const points=Array.from({length:210},(_,i)=>facility(String(i),i*37%width,i*23%520,'镇街'+(i%13)))
    const markers=layoutFacilityMarkers(points,width,520,resolution)
    assert.equal(new Set(markers.flatMap(m=>m.members.map(p=>p.id))).size,points.length)
    markers.forEach((a,i)=>markers.slice(i+1).forEach(b=>assert.ok(
      Math.abs(a.x-b.x)>=(a.diameter+b.diameter)/2 || Math.abs(a.y-b.y)>=(a.diameter+b.diameter)/2)))
  }
})
