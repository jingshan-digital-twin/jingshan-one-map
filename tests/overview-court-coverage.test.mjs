import test from 'node:test'
import assert from 'node:assert/strict'
import { courtPopulationCoverage, estimatedPeople, groupCoverageGrids, measureCourtCoverage, populationAroundPoint, preparePopulationGrid } from '../src/jingshan/overview-court-coverage.ts'
import { populationGridId } from '../src/jingshan/population-grid.ts'
import { pages, sceneAllowsLayer } from '../src/jingshan/v3-navigation.ts'

function point(longitude, population) {
  return {type:'Feature', geometry:{type:'Point',coordinates:[longitude,31]}, properties:{population}}
}

test('首页只启用实测场地，排除人口密度与场馆业务台账', () => {
  assert.deepEqual(pages.overview.activeLayers, ['court_footprints'])
  for (const layer of ['courts', 'venues', 'population', populationGridId]) {
    assert.equal(sceneAllowsLayer('overview', layer), false)
    assert.equal(sceneAllowsLayer('venues', layer), true)
  }
})

test('各专题共用实测球场图层，保留场馆台账和赛后线路各自的用途', () => {
  for (const page of ['industry','venues','site','investment','events','liveEvent','merchants']) {
    assert.ok(pages[page].layers.includes('court_footprints'))
    assert.ok(!pages[page].layers.includes('courts'))
  }
  for (const page of ['venues','events','liveEvent','merchants']) assert.ok(pages[page].activeLayers.includes('court_footprints'))
  assert.ok(!pages.venues.activeLayers.includes('venues'))
  for (const page of ['tourism','consumption']) assert.ok(!pages[page].activeLayers.includes('court_footprints'))
})

test('场地步行覆盖按人口加权，重叠服务范围内的人口仅计算一次', () => {
  const courts = [point(113.1), point(113.1008)]
  const cells = [point(113.1, 30), point(113.5, 10), point(113.5, null)]
  assert.equal(courtPopulationCoverage(courts,cells,1000), 75)
  assert.equal(courtPopulationCoverage(courts,[point(113.5, 10)],1000), 0)
  assert.equal(courtPopulationCoverage(courts,[],1000), undefined)
  assert.equal(courtPopulationCoverage([],cells,1000), undefined)
})

function gridCell(id, centerX, population, densityPerKm2, region='甲镇') {
  const feature = point(113.5, population)
  return {...feature, id, properties: {...feature.properties, kind:'population-grid', center:[centerX,31], densityPerKm2, region}}
}

test('用网格代表点计算各实测球场的服务人数，跨镇覆盖、重叠去重，高密度只取未覆盖的有居民网格', () => {
  const courts = [{...point(113),id:'A'}, {...point(113.001),id:'B'}]
  const features = [
    gridCell('near',113.005,90,600,'乙镇'), gridCell('mid',113.017,70,300,'乙镇'),
    gridCell('dense',113.09,40,500), gridCell('rural',113.10,10,20),
    gridCell('zero',113.005,0,0), gridCell('unknown',113.10,null,null),
  ]
  const grid = preparePopulationGrid(features)
  const coverage = measureCourtCoverage(grid,courts,1000)
  const {groups,highDensityThreshold} = groupCoverageGrids(coverage)
  assert.equal(highDensityThreshold,500)
  assert.deepEqual(groups.all.features,features)
  assert.deepEqual(groups.covered.features.map(f=>f.id),['near','zero'])
  assert.deepEqual(groups.uncovered.features.map(f=>f.id),['mid','dense','rural','unknown'])
  assert.deepEqual(groups.denseUncovered.features.map(f=>f.id),['dense'])
  assert.equal(coverage.courtCounts.get('near'),2)
  assert.deepEqual(coverage.byCourt.get('A'),{grids:2,known:2,people:90})
  assert.deepEqual(coverage.byCourt.get('B'),coverage.byCourt.get('A'))
  assert.equal(groups.covered.people,90)
  assert.equal(groups.uncovered.people,120)
  assert.equal(groups.all.people,groups.covered.people+groups.uncovered.people)
  assert.equal(populationAroundPoint(grid,[113,31],1000),coverage.byCourt.get('A').people)

  const town = groupCoverageGrids(coverage,f=>f.properties.region==='乙镇')
  assert.equal(town.groups.covered.people,90)
  assert.equal(town.groups.all.people,160)
  assert.equal(town.highDensityThreshold,highDensityThreshold)
  const expanded = groupCoverageGrids(measureCourtCoverage(grid,courts,2000))
  assert.equal(expanded.groups.covered.people,160)
  assert.equal(expanded.groups.all.people,groups.all.people)
})

test('区分零覆盖、空值和无实测场地，单片与总览均保留零人口网格', () => {
  const grid = preparePopulationGrid([gridCell('empty',113,0,0), gridCell('unknown',113.1,null,null)])
  const mapped = measureCourtCoverage(grid,[{...point(113.1),id:'A'}],1000)
  assert.equal(estimatedPeople(mapped.byCourt.get('A'),grid.hasPopulation),undefined)
  assert.equal(populationAroundPoint(grid,[113,31],1000),0)
  assert.equal(populationAroundPoint(grid,[114,31],1000),0)
  assert.equal(populationAroundPoint(preparePopulationGrid([]),[114,31],1000),undefined)
  const {groups,hasCourts} = groupCoverageGrids(measureCourtCoverage(grid,[],1000))
  assert.equal(hasCourts,false)
  assert.equal(groups.all.grids,2)
  assert.equal(groups.all.known,1)
  assert.equal(groups.uncovered.grids,0)
  assert.equal(groups.denseUncovered.grids,0)
})
