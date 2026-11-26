import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { coverage } from '../src/jingshan/analytics.ts'
import { populationBand, populationBands, noPopulationData, populationDataset, populationGridId, legacyPopulationGridId } from '../src/jingshan/population-grid.ts'

import { populationRaster,populationRecordCount,populationCell,gridPosition,pickRaster,rasterCellById,rasterFeatureById,rasterPage,withPixelPopulation,withPixelPopulations,rasterGeoJsonChunks } from '../src/jingshan/population-raster.ts'
import { planSpatialAttributeUpdate } from '../src/jingshan/spatial-attribute-update.ts'
import { rasterGroups,rasterCourtCoverage,viewBits } from '../src/jingshan/population-raster-coverage.ts'
import { populationDisplayGrid, populationMapFeature, displayCellAt, displayCellId, displayDensity } from '../src/jingshan/population-display-grid.ts'
import { openingPopulation, openingImpact, openingRecommendations, openingGapAreas, openingGapSelection, gapAreaMask } from '../src/jingshan/opening-population.ts'
import { investmentGapGrids } from '../src/jingshan/investment-demand.ts'
import { courtViews } from '../src/jingshan/court-ledger.ts'
import { venueCapacity, walkingVenueDirectory } from '../src/jingshan/venue-capacity.ts'
import { withCollectedResources } from '../server/collected-resources.ts'
const readPack=async file=>JSON.parse(await readFile(new URL('../server/resource-sources/'+file,import.meta.url),'utf8'))
const residents=await readPack('jingshan-population-100m.json')
const dataset = JSON.parse(await readFile(new URL('../server/resource-sources/worldpop-population-2025.json',import.meta.url),'utf8'))

test('2025 京山网格的人口总量守恒，原始缺值与零人口分别统计', () => {
  assert.equal(dataset.id,legacyPopulationGridId)
  const native = new Set(), townNames = new Set(), colors = new Set()
  let total = 0, zeros = 0, missing = 0
  for (const {id,properties:p} of dataset.features) {
    native.add(id.slice(0,id.lastIndexOf('-')))
    if (p.region !== '京山市') townNames.add(p.region)
    if (p.population == null) {
      missing++
      assert.equal(populationBand(p.densityPerKm2),noPopulationData)
    } else {
      assert(Number.isSafeInteger(p.population) && p.population >= 0)
      assert(Number.isFinite(p.densityPerKm2) && p.densityPerKm2 >= 0)
      if (p.population === 0) zeros++
      colors.add(populationBand(p.densityPerKm2).color)
      total += p.population
    }
  }
  assert.deepEqual([native.size,townNames.size,total,colors.size],[4904,15,486650,6])
  assert(missing > 0 && zeros > 0)
  assert.equal(populationBand(0),populationBands[0])
  for (const band of populationBands) assert.equal(populationBand(band.min),band)
})

test('覆盖分析优先采用已发布的实接网格，旧工作区可使用原图层', () => {
  const raw = dataset.features.find(f => f.properties.population > 0)
  const empty = dataset.features.find(f => f.properties.population == null)
  const sample = {id:'population', features:[{...raw,properties:{...raw.properties,population:999}}]}
  const source = {...dataset,features:[raw,empty]}
  assert.equal(populationDataset([sample,source]),source)
  const result = coverage([sample,source])
  assert.equal(result.totalPopulation,raw.properties.population)
  assert.equal(result.overlays.filter(f => f.properties.kind === 'coverage-grid').length,1)
  assert.equal(coverage([sample]).totalPopulation,999)
})

test('100 米原生栅格还原人数、零值、无数据及边界，草稿单格编辑只作用于目标格',()=>{
  const grid=populationRaster(residents), selection={grid,bit:1}
  assert.deepEqual([grid.count,grid.populated,grid.count-grid.populated,grid.total,grid.highDensityThreshold],
    [338740,32164,306576,507926,1300])
  assert.equal(populationRecordCount(residents),grid.count)
  assert.equal(populationDataset([dataset,residents]).features.reduce((sum,c)=>sum+c.properties.population,0),507926)
  const b=grid.blocks.find(b=>b.people.includes(-1) && b.people.includes(0) && b.people.some(n=>n>0))
  for(const i of [b.people.indexOf(-1),b.people.indexOf(0),b.people.findIndex(n=>n>0)]){
    const point=gridPosition(b,i%b.width+.5,Math.floor(i/b.width)+.5),id=pickRaster(selection,...point)
    if(b.people[i]<0){assert.equal(id,undefined);continue}
    const f=rasterFeatureById(grid,id)
    assert.equal(f.properties.population,b.people[i]);assert.equal(f.properties.densityPerKm2,b.people[i]*100)
    assert.equal(rasterCellById(grid,id).index,i)
  }
  const f=populationCell(b,b.people.findIndex(n=>n>0))
  assert.deepEqual(rasterPage(grid,1,10,f.id),{rows:[f],total:1})
  const edited=withPixelPopulation(residents,f.id,0)
  assert.equal(populationRaster(edited).total,507926-f.properties.population)
  assert.equal(populationRecordCount(edited),338740)
  const removed=withPixelPopulation(edited,f.id,null)
  assert.equal(populationRecordCount(removed),338739)
  assert.equal(rasterFeatureById(populationRaster(removed),f.id),undefined)
  assert.equal(grid.total,507926)
  const other=populationCell(b,b.people.indexOf(0)), chosen=new Set([other.id,f.id])
  const bulk=withPixelPopulations(residents,[...chosen,f.id],null)
  assert.equal(populationRaster(bulk).count,grid.count-2)
  assert.equal(populationRaster(bulk).total,grid.total-f.properties.population)
  assert.deepEqual(JSON.parse([...rasterGeoJsonChunks(grid,'已选择','',chosen)].join('')).features.map(r=>r.id).sort(),[...chosen].sort())
  assert.throws(()=>withPixelPopulations(residents,[f.id,'无此像元'],null),/找不到/)
})
test('属性表按像元编号批量回填人口，保留空值并重算密度',()=>{
  const dataset={...residents,features:residents.features.filter(f=>f.properties.validCells>=4).slice(0,2)}
  const grid=populationRaster(dataset)
  const firstCells=grid.blocks.map(block=>Array.from(block.people.keys()).filter(i=>block.people[i]>=0).slice(0,2).map(i=>populationCell(block,i)))
  const [a,b]=firstCells[0], [c]=firstCells[1]
  const headers=['实体业务ID','人口密度（人/km²）','格内人口（人）']
  const rows=[{rowNumber:2,values:[c.id,1,c.properties.population+8]},
    {rowNumber:3,values:[a.id,1,a.properties.population+3]}, {rowNumber:4,values:[b.id,1,null]}]
  const table={name:'属性数据',headers,rows}
  const plan=planSpatialAttributeUpdate(dataset,table)
  assert.deepEqual([plan.matched,plan.updated,plan.unchanged,plan.changeCount],[3,2,1,2])
  assert.deepEqual(plan.ignored,['人口密度（人/km²）'])
  const next=populationRaster(plan.dataset)
  assert.equal(next.total,grid.total+11)
  assert.equal(next.count,grid.count)
  assert.equal(rasterFeatureById(next,a.id).properties.densityPerKm2,(a.properties.population+3)*100)
  assert.equal(rasterFeatureById(next,b.id).properties.population,b.properties.population)
  assert.equal(plan.dataset.features[0].geometry,dataset.features[0].geometry)
  assert.equal(planSpatialAttributeUpdate(plan.dataset,table).dataset,plan.dataset)
  for (const values of [[a.id,0,0],['missing',0,1],[b.id,0,-1],[b.id,0,2147483648],[b.id,0,1.5]]) {
    assert.throws(()=>planSpatialAttributeUpdate(dataset,{...table,rows:[...rows.slice(0,2),{rowNumber:9,values}]}),/第 9 行/)
  }
  assert.equal(rasterFeatureById(grid,a.id).properties.population,a.properties.population)
})
test('栅格场馆目录的排序、重叠服务圈分配和关闭场馆统计与完整诊断一致',async()=>{
  const datasets=[residents,...courtViews(await readPack('court-ledger.json'))]
  const rules={walkM:1450,peoplePerCourt:233}
  const expected=venueCapacity(datasets,{mode:'walk'},rules).facilities
  assert(expected.some(f=>f.openCourts && f.reachablePopulation>f.capacity))
  assert(expected.some(f=>!f.openCourts && f.reachablePopulation>0))
  assert.deepEqual(walkingVenueDirectory(datasets,rules),expected)
})

test('四个服务圈半径的原生像元与源 TIFF 独立大地距离核算一致',async()=>{
  const grid=populationRaster(residents), courts=courtViews(await readPack('court-ledger.json')).find(d=>d.id==='court_footprints').features
  // Independently computed from the source TIFF and SHP using native pixel centres and spherical distances.
  for(const [m,people,cells,dense,denseCells] of [[500,172677,4492,215873,7325],[1000,220784,12573,172533,6565],
      [2000,248048,33901,155404,5907],[3000,274147,60838,140567,5348]]){
    const coverage=rasterCourtCoverage(grid,courts,m), {groups,mask}=rasterGroups(grid,{},coverage)
    assert.equal(groups.covered.people,people);assert.equal(groups.covered.grids,cells)
    assert.equal(groups.covered.people+groups.uncovered.people,507926)
    assert.equal(groups.covered.grids+groups.uncovered.grids,338740)
    assert.deepEqual([groups.denseUncovered.people,groups.denseUncovered.grids],[dense,denseCells])
    const b=grid.blocks.find(b=>b.people.some((_,i)=>mask[b.offset+i]&viewBits.denseUncovered))
    const i=b.people.findIndex((_,i)=>mask[b.offset+i]&viewBits.denseUncovered)
    assert.equal(pickRaster({grid,mask,bit:viewBits.covered},b.lon[i],b.lat[i]),undefined)
    assert.equal(pickRaster({grid,mask,bit:viewBits.uncovered},b.lon[i],b.lat[i]),populationCell(b,i).id)
  }
  assert.equal(rasterGroups(grid,{towns:['京山市']}).groups.all.people,182)
})
test('替换旧人口图层原子迁移名称引用，保留其他台账及独立草稿并可重复执行',()=>{
  const other={...dataset,id:'local_extra',name:'人工资料',features:[]}
  const base={mode:'live',rules:{},datasets:[dataset,other],mapBindings:[{scope:'all',slot:'dataset:'+legacyPopulationGridId,serviceId:null}],
    portalCatalog:{folders:[{id:'geo',parent:'',name:'人口',resources:['dataset:'+legacyPopulationGridId]}]}}
  const replaced=withCollectedResources(base,[residents])
  assert.deepEqual(replaced.datasets.map(d=>d.id),[populationGridId,other.id]);assert.equal(replaced.datasets[1],other)
  assert.deepEqual(replaced.portalCatalog.folders[0].resources,['dataset:'+populationGridId])
  assert.equal(replaced.mapBindings[0].slot,'dataset:'+populationGridId)
  assert.equal(withCollectedResources(replaced,[residents]),replaced)
  assert.equal(base.datasets[0],dataset)
})

test('约 500 米显示格汇总选中的 100 米像元，零人口格透明，各视图保留原始人口合计',async()=>{
  const grid=populationRaster(residents)
  const courts=courtViews(await readPack('court-ledger.json')).find(layer=>layer.id==='court_footprints').features
  const coverage=rasterCourtCoverage(grid,courts,1000), {groups,mask}=rasterGroups(grid,{},coverage)
  for (const [view,count] of [['all',7337],['covered',467],['uncovered',6995],['denseUncovered',2977]]) {
    const display=populationDisplayGrid({grid,mask,bit:viewBits[view]},undefined,coverage.counts)
    const cells=[...display.cells.values()]
    assert.equal(cells.length,count)
    assert(cells.every(cell=>cell.people>0))
    assert.equal(cells.reduce((sum,cell)=>sum+cell.people,0),groups[view].people)
    if (view==='all') assert.equal(cells.reduce((sum,cell)=>sum+cell.coveredPeople,0),groups.covered.people)
  }
  const town=rasterGroups(grid,{towns:['新市街道']},coverage)
  const display=populationDisplayGrid({grid,mask:town.mask,bit:viewBits.all})
  assert.equal(display.cells.size,364)
  assert.equal([...display.cells.values()].reduce((sum,c)=>sum+c.people,0),town.groups.all.people)
  const cell=[...display.cells.values()].find(c=>c.sourceCells>20)
  const feature=populationMapFeature(display,displayCellId(cell)), [nw,sw,se]=feature.geometry.coordinates[0]
  assert(Math.abs(se[0]-sw[0]-1/192)<1e-12 && Math.abs(nw[1]-sw[1]-1/222)<1e-12)
  assert.equal(displayCellAt(display,...feature.properties.center),cell)
  assert.equal(feature.properties.region,'新市街道')
  assert(Math.abs(displayDensity(cell)-cell.people/(cell.sourceCells/100))<1e-10)
  const zeros=new Uint8Array(grid.slots)
  for (const b of grid.blocks) for (let i=0;i<b.people.length;i++) if (b.people[i]===0) zeros[b.offset+i]=1
  assert.equal(populationDisplayGrid({grid,mask:zeros,bit:1}).cells.size,0)
})

test('开放协调以已开放场地为基准，重叠方案只累计一次，地图剩余缺口与镇街统计一致',async()=>{
  const grid=populationRaster(residents),courts=courtViews(await readPack('court-ledger.json')).find(d=>d.id==='courts').features
  const model=openingPopulation(grid,courts,{},1000)
  assert.deepEqual([model.total,model.covered,model.densePeople],[507926,167179,223728])
  const chosen=courts.filter(c=>c.properties['是否可协调']==='是' && ['京山市离退休干部管理所网球场','老公安局家属区网球场'].includes(c.properties.facilityName))
  const ids=chosen.map(c=>c.id), effect=openingImpact(model,[...ids,...ids])
  assert.equal(model.covered+effect.added,197487)
  assert(effect.added<ids.reduce((n,id)=>n+openingImpact(model,[id]).added,0))
  const original=populationDisplayGrid(openingGapSelection(model)),after=populationDisplayGrid(openingGapSelection(model,effect.indices))
  const sum=rows=>rows.reduce((n,r)=>n+r.people,0),cells=[...after.cells.values()]
  assert.deepEqual([...after.cells.keys()],[...original.cells.keys()])
  assert.equal(sum(cells),model.densePeople)
  assert.equal(cells.reduce((n,c)=>n+c.plannedPeople,0),effect.denseAdded)
  const mixed=cells.find(c=>c.plannedPeople>0 && c.plannedPeople<c.people)
  assert.equal(populationMapFeature(after,displayCellId(mixed)).properties.plannedPopulation,mixed.plannedPeople)
  const areas=openingGapAreas(model,[])
  assert.equal(sum(areas),model.densePeople)
  assert.equal(new Set(areas.map(a=>a.town)).size,areas.length)
  const town=areas.find(a=>a.town==='新市街道')
  const scoped=openingPopulation(grid,courts,{towns:[town.town]},1000)
  assert.deepEqual([town.total,town.covered,town.people],[scoped.total,scoped.covered,scoped.densePeople])
  const display=populationDisplayGrid(openingGapSelection(model,undefined,gapAreaMask(model,town)))
  assert.equal([...display.cells.values()].reduce((n,c)=>n+c.people,0),town.people)
  assert.equal(town.people,30699)
  const siteData=[residents,{id:'courts',features:courts}]
  const raw=coverage(siteData,{individualCourts:true},{walkM:1000}).blindAreas
  assert.equal(sum(investmentGapGrids(raw,4000).map(g=>({people:g.population}))),model.total-model.covered)
})

test('协调推荐按方案以外的新增人口排序，排除在办和已选过单片的场馆',()=>{
  const model={people:[100,80,60,40],mask:[8,8,4,2],footprints:new Map([
    ['a1',[0]],['a2',[1]],['b',[0,1,3]],['c',[2,3]],['d',[0,1,2]],['e',[0]],
  ])}
  const venues=[['A',['a1','a2']],['B',['b']],['C',['c']],['D',['d']],['E',['e']]].map(([id,ids])=>({id,name:id,courts:ids.map(id=>({id}))}))
  const active=new Set(['D'])
  assert.deepEqual(openingRecommendations(model,venues,new Set(),undefined,active).map(v=>v.venue.id),['A','B','E','C'])
  const chosen=new Set(['a1']),planned=openingImpact(model,chosen)
  const ranked=openingRecommendations(model,venues,chosen,planned.indices,active)
  assert.deepEqual(ranked.map(({venue,gain})=>[venue.id,gain.added,gain.denseAdded]),[['B',80,80],['C',60,0]])
  assert.equal(ranked[0].gain.before,140)
  assert.deepEqual(openingRecommendations(model,venues,new Set(['b']),openingImpact(model,['b']).indices,active).map(r=>r.venue.id),['C'])
})
