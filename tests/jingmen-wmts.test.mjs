import assert from 'node:assert/strict'
import test from 'node:test'
import { parseJingmenWmts } from '../server/jingmen-wmts.ts'

const radius=Math.PI*6378137
function matrixSet({id='wm',crs='urn:ogc:def:crs:EPSG::3857',geographic=false,corner,offset=0,levels=[0,1,2],scaleFactor=1}={}){
  const topLeft=corner??[-radius,radius]
  return `<TileMatrixSet><o:Identifier>${id}</o:Identifier><o:SupportedCRS>${crs}</o:SupportedCRS>${levels.map(z=>{
    const width=2**z*(geographic?2:1), scale=2*radius/(width*256*.00028)*scaleFactor
    return `<TileMatrix><o:Identifier>L:${z+offset}</o:Identifier><ScaleDenominator>${scale}</ScaleDenominator>
      <TopLeftCorner>${topLeft.join(' ')}</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight>
      <MatrixWidth>${width}</MatrixWidth><MatrixHeight>${2**z}</MatrixHeight></TileMatrix>`
  }).join('')}</TileMatrixSet>`
}
function layer(id='base',title='影像',sets=['wm']){
  return `<Layer><o:Identifier>${id}</o:Identifier><o:Title>${title}</o:Title>
    <Style><o:Identifier>other</o:Identifier></Style><Style isDefault="true"><o:Identifier>normal</o:Identifier></Style>
    <Format>image/svg+xml</Format><Format>image/jpeg</Format>
    ${sets.map(set=>`<TileMatrixSetLink><TileMatrixSet>${set}</TileMatrixSet></TileMatrixSetLink>`).join('')}
    <ResourceURL resourceType="tile" template="https://example.invalid/unused"/></Layer>`
}
const document=(layers=layer(),sets=matrixSet())=>Buffer.from(`<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:o="http://www.opengis.net/ows/1.1" version="1.0.0"><Contents>${layers}${sets}</Contents></Capabilities>`)

test('只使用目标图层关联的矩阵集、声明的格式、样式及级别编号',()=>{
  const layers=layer('old','荆门市 2025 年 0.5 米影像')+layer('actual','荆门市 2026 年 0.5 米影像',['local','geographic'])
  const sets=matrixSet()+matrixSet({id:'local',corner:[0,0]})+matrixSet({id:'geographic',crs:'EPSG:4326',geographic:true,corner:[90,-180],offset:1,levels:[1,2,0]})
  assert.deepEqual(parseJingmenWmts(document(layers,sets)),{layer:'actual',raster:{
    projection:'EPSG:4326',maxLevel:2,matrixOffset:1,matrixPrefix:'L:',matrixSet:'geographic',style:'normal',format:'image/jpeg'
  }})
  assert.equal(parseJingmenWmts(document()).raster.projection,'EPSG:3857')
})
test('识别经纬轴顺序，拒绝局部网格、非连续级别、非标准比例尺或无法表达的编号',()=>{
  const geographic={crs:'urn:ogc:def:crs:OGC:1.3:CRS84',geographic:true,corner:[-180,90]}
  assert.equal(parseJingmenWmts(document(layer(),matrixSet(geographic))).raster.projection,'EPSG:4326')
  for(const config of [{...geographic,corner:[90,-180]},{crs:'EPSG:4490'},{levels:[1,2]},{levels:[0,2]},{scaleFactor:1.5}]){
    assert.throws(()=>parseJingmenWmts(document(layer(),matrixSet(config))),/矩阵/)
  }
  for(const replacement of [['L:1','B:1'],['L:1','L:5'],['>256</TileWidth>','>512</TileWidth>']]){
    assert.throws(()=>parseJingmenWmts(document(layer(),matrixSet().replace(...replacement))),/矩阵/)
  }
})
test('服务说明须为 WMTS 而且明确指向一个图层',()=>{
  assert.throws(()=>parseJingmenWmts(document(layer('a')+layer('b'))),/唯一确定/)
  assert.throws(()=>parseJingmenWmts(document(layer('a','2025年0.5米影像')+layer('b'))),/唯一确定/)
  assert.throws(()=>parseJingmenWmts(Buffer.from('<Capabilities version="1.0.0"/>')),/WMTS/)
  assert.throws(()=>parseJingmenWmts(Buffer.from('<!DOCTYPE Capabilities>'+document())),/解析/)
})

test('荆门 CGCS2000 区域缓存跳过世界概览，按比例尺对应京山瓦片行列',()=>{
  const set=matrixSet({crs:'urn:ogc:def:crs:EPSG::4490',geographic:true,corner:[90,-180],offset:1})
    .replace('<TileMatrix>',`<TileMatrix><o:Identifier>L:0</o:Identifier><ScaleDenominator>559708839.9798112</ScaleDenominator>
      <TopLeftCorner>90 -180</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight>
      <MatrixWidth>1</MatrixWidth><MatrixHeight>1</MatrixHeight></TileMatrix><TileMatrix>`)
    .replace('<MatrixHeight>2</MatrixHeight>','<MatrixHeight>1</MatrixHeight>')
    .replace('<MatrixWidth>8</MatrixWidth>','<MatrixWidth>7</MatrixWidth>')
  const {raster}=parseJingmenWmts(document(layer().replace('image/jpeg','image/jpgpng'),set))
  assert.equal(raster.projection,'EPSG:4326')
  assert.equal(raster.format,'image/jpgpng')
  assert.equal(raster.matrixOffset,1)
  assert.equal(raster.maxLevel,2)
})
