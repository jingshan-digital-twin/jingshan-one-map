import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogAssets, folderResources, publishedCatalog, validatePortalCatalog } from '../src/jingshan/portal-catalog.ts'

import { checkDatasetRemovals, draftServices, planResourceRemoval } from '../src/jingshan/resource-removal.ts'
import { checkDocument } from '../src/jingshan/validate.ts'

const folder = (id, parent, resources, workspaceOnly = false) => ({
  id,
  name: id,
  parent,
  resources,
  workspaceOnly,
})

test('主题包含多层子目录，同一资源只计一次', () => {
  const folders = [
    folder('public', '', ['dataset:venues']),
    folder('courts', 'public', ['dataset:venues', 'service:courts']),
    folder('children', 'courts', ['dataset:parks']),
  ]
  validatePortalCatalog({ folders })
  assert.deepEqual([...folderResources(folders, 'public')].sort(), [
    'dataset:parks',
    'dataset:venues',
    'service:courts',
  ])
})

test('公开目录排除工作区专用目录及其所有子目录，保留其他分支', () => {
  const folders = [
    folder('private', '', [], true),
    folder('child', 'private', []),
    folder('nested', 'child', ['dataset:venues']),
    folder('shared', '', []),
    folder('external', 'shared', ['service:base']),
  ]
  assert.deepEqual(
    publishedCatalog({ folders }).folders.map((item) => item.id),
    ['shared', 'external'],
  )
  assert.equal(folders.length, 5)
  assert.equal(publishedCatalog(undefined), undefined)
})

test('拒绝循环和悬空引用的目录层级、重复资源和非法范围值', () => {
  for (const folders of [
    [folder('a', 'b', []), folder('b', 'a', [])],
    [folder('a', 'missing', [])],
    [folder('a', '', ['dataset:venues', 'dataset:venues'])],
    [folder('a', '', [], 'private')],
  ])
    assert.throws(() => validatePortalCatalog({ folders }))
})

const layer = (id,derivedFrom) => ({id,name:id,category:'场地',department:'本地',description:'',derivedFrom,features:[]})

test('展示图层不能删除源数据，明确删除源数据集才清理关联',()=>{
  const datasets=[layer('courts_source'),layer('courts','courts_source'),layer('court_footprints','courts_source'),layer('parks')]
  const keep={scope:'all',slot:'dataset:parks',serviceId:'other'}
  const document={mode:'live',rules:{},datasets,mapBindings:[keep,
    {scope:'all',slot:'dataset:courts',serviceId:'external'}, {scope:'venues',slot:'dataset:parks',serviceId:'hosted-courts_source'}],
    portalCatalog:{folders:[folder('sports','',['dataset:courts','dataset:courts_source','service:hosted-courts_source','dataset:parks'])]}}
  for(const id of ['courts','court_footprints'])
    assert.throws(()=>planResourceRemoval(document,{kind:'dataset',id}),/仅支持预览/)
  const plan=planResourceRemoval(document,{kind:'dataset',id:'courts_source'})
  for(const unconfirmed of [undefined,[],['court_footprints'],['parks']])
    assert.throws(()=>checkDatasetRemovals(document,plan.next,unconfirmed),/整份/)
  assert.doesNotThrow(()=>checkDatasetRemovals(document,plan.next,['courts_source']))
  assert.equal(plan.source.id,'courts_source')
  assert.deepEqual(plan.next.datasets,[datasets[3]])
  assert.deepEqual(plan.next.mapBindings,[keep])
  assert.deepEqual(plan.next.portalCatalog.folders[0].resources,['dataset:parks'])
  assert.equal(document.datasets.length,4)
  checkDocument(plan.next)
})
test('服务删除保留独立的数据集，待删除实例和已移除源的托管服务退出草稿目录',()=>{
  const hosted={id:'hosted-parks',hostedDatasetId:'parks',revision:3}, remote={id:'remote',revision:2}
  const d={mode:'live',rules:{},datasets:[layer('parks')],mapBindings:[{scope:'all',slot:'dataset:parks',serviceId:'remote'}]}
  const plan=planResourceRemoval(d,{kind:'service',service:remote})
  assert.equal(plan.next.datasets.length,1)
  assert.deepEqual(plan.next.serviceRemovals,[{id:'remote',revision:2}])
  assert.deepEqual(draftServices([hosted,remote],plan.next),[hosted])
  checkDocument(plan.next)
  assert.throws(()=>checkDocument({...plan.next,mapBindings:d.mapBindings}),/待删除服务/)
  const cleared=planResourceRemoval(plan.next,{kind:'dataset',id:'parks'}).next
  checkDocument(cleared)
  assert.deepEqual(cleared.datasets,[])
  assert.deepEqual(draftServices([hosted,remote],cleared),[])
})

test('同名的源数据集、展示图层与已发布服务各有唯一入口和来源',()=>{
  const local={...layer('sports'),name:'场地台账'}, view={...layer('courts','sports'),name:'场地台账'}
  const hosted={id:'hosted-sports',name:'场地台账',hostedDatasetId:'sports',kind:'geojson',category:'体育',enabled:true}
  const items=catalogAssets([local,view],[hosted])
  const byKey=new Map(items.map(a=>[a.key,a]))
  assert.equal(byKey.get('dataset:sports').type,'local')
  assert.equal(byKey.get('dataset:courts').type,'views')
  assert.equal(byKey.get('dataset:courts').sourceName,'场地台账')
  assert.equal(byKey.get('service:hosted-sports').type,'services')
  assert.equal(byKey.get('service:hosted-sports').sourceName,'场地台账')
})
