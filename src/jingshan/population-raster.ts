import type { Coordinate, CityFeature, Dataset } from './types.ts'

export const residentGridId = 'jingshan_population_100m'
export const residentRasterUrl = '/jingshan/jingshan-building-population-100m.tif'
const blockSize = 32
const cellPrefix = 'js-pop-'
type Bounds = [number, number, number, number]
export type PopulationBlock = {
  row:number; col:number; width:number; height:number; offset:number
  controls:Coordinate[]; nw:Coordinate; sw:Coordinate; se:Coordinate; ne:Coordinate; bounds:Bounds
  people:Int32Array; zones:Uint8Array; regions:string[]; lon:Float64Array; lat:Float64Array
}
export type PopulationRaster = ReturnType<typeof unpack>
export type RasterSelection = {grid:PopulationRaster; mask?:Uint8Array; bit:number; planned?:ReadonlySet<number>}
const cache = new WeakMap<CityFeature[], PopulationRaster>()

export function isPopulationRaster(dataset: Dataset | undefined) {
  return dataset?.id===residentGridId && dataset.features.some(f=>f.properties.kind==='population-raster-block')
}

export function gridPosition(block:PopulationBlock, x:number, y:number):Coordinate {
  const u=x/block.width, v=y/block.height
  // Inverse Gauss–Krüger is curved. Nine inverse-projection samples per 3.2 km block
  // keep native cell centres accurate even at the boundary of a service circle.
  const wx=[(1-u)*(1-2*u),4*u*(1-u),u*(2*u-1)], wy=[(1-v)*(1-2*v),4*v*(1-v),v*(2*v-1)]
  let lon=0,lat=0
  for(let j=0;j<3;j++)for(let k=0;k<3;k++){
    const pos=block.controls[j*3+k],weight=wx[k]*wy[j]
    lon+=weight*pos[0];lat+=weight*pos[1]
  }
  return [lon,lat]
}

function unpack(source:CityFeature[]) {
  const blocks:PopulationBlock[]=[], byBlock=new Map<string,PopulationBlock>()
  const bounds:Bounds=[Infinity,Infinity,-Infinity,-Infinity]
  const densityHistogram=new Map<number,number>()
  let slots=0,count=0,total=0,populated=0
  for (const feature of source) {
    const p=feature.properties, {row,col,width,height,regions,runs}=p
    if (p.kind!=='population-raster-block' || feature.geometry.type!=='Polygon' || !(feature.geometry.coordinates[0]?.length===5) ||
        typeof row!=='number' || typeof col!=='number' || row<0 || col<0 || row%blockSize || col%blockSize ||
        typeof width!=='number' || !Number.isInteger(width) || width<1 || width>blockSize ||
        typeof height!=='number' || !Number.isInteger(height) || height<1 || height>blockSize ||
        !Array.isArray(regions) || regions.length<1 || regions.length>255 || !regions.every(s=>typeof s==='string' && s.length) ||
        !Array.isArray(runs) || runs.length%3 || p.cellSizeM!==100) throw Error('人口栅格的分块格式无效')
    const key=row+','+col
    if (byBlock.has(key)) throw Error('人口栅格存在重叠分块')
    const [nw,sw,se,ne]=feature.geometry.coordinates[0] as Coordinate[]
    if(!Array.isArray(p.controls) || p.controls.length!==5 ||
        !p.controls.every(pt=>Array.isArray(pt) && pt.length===2 && pt.every(Number.isFinite)))throw Error('人口栅格缺少投影控制点')
    const [north,east,south,west,center]=p.controls as Coordinate[]
    const controls=[nw,north,ne,west,center,east,sw,south,se]
    const xs=[nw[0],sw[0],se[0],ne[0]], ys=[nw[1],sw[1],se[1],ne[1]]
    const box:Bounds=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]
    const size=width*height
    const block:PopulationBlock={row,col,width,height,regions,offset:slots,controls,nw,sw,se,ne,bounds:box,
      people:new Int32Array(size),zones:new Uint8Array(size),lon:new Float64Array(size),lat:new Float64Array(size)}
    let end=0, valid=0
    for (let i=0;i<runs.length;i+=3) {
      const len=runs[i], n=runs[i+1], zone=runs[i+2]
      if (!Number.isInteger(len)||len<1||end+len>size || !Number.isSafeInteger(n)||n < -1||n>2147483647 ||
          !Number.isInteger(zone)||zone<0||zone>=regions.length) throw Error('人口格值或镇街索引无效')
      block.people.fill(n,end,end+len); block.zones.fill(zone,end,end+len); end+=len
      if(n>=0){ valid+=len; total+=len*n }
      if(n>0){populated+=len; densityHistogram.set(n,(densityHistogram.get(n)??0)+len)}
    }
    if (end!==size || valid!==p.validCells) throw Error('人口栅格的有效像元数不一致')
    for(let i=0;i<size;i++){
      const [x,y]=gridPosition(block,i%width+.5,Math.floor(i/width)+.5)
      block.lon[i]=x; block.lat[i]=y
    }
    count+=valid; slots+=size; blocks.push(block); byBlock.set(key,block)
    bounds[0]=Math.min(bounds[0],box[0]);bounds[1]=Math.min(bounds[1],box[1]);bounds[2]=Math.max(bounds[2],box[2]);bounds[3]=Math.max(bounds[3],box[3])
  }
  let highDensityThreshold:number|null=null, accumulated=0
  for(const [people,n] of [...densityHistogram].sort(([a],[b])=>a-b)){
    accumulated+=n
    if(accumulated>=Math.ceil(populated*.75)){highDensityThreshold=people*100;break}
  }
  return {blocks,byBlock,bounds,count,total,slots,populated,highDensityThreshold}
}

export function populationRaster(dataset?:Dataset) {
  if (!dataset || dataset.id!==residentGridId || !dataset.features.length) return
  let result=cache.get(dataset.features)
  if(!result && isPopulationRaster(dataset)){result=unpack(dataset.features);cache.set(dataset.features,result)}
  return result
}

export function populationCellId(block:PopulationBlock, i:number) {
  return cellPrefix+(block.row+Math.floor(i/block.width))+'-'+(block.col+i%block.width)
}

export function populationCellAttributes(block:PopulationBlock, i:number) {
  const x=i%block.width, y=Math.floor(i/block.width), row=block.row+y, col=block.col+x
  const region=block.regions[block.zones[i]], n=block.people[i]
  return {name:region+'人口网格 '+row+'-'+col,kind:'population-grid',region,center:[block.lon[i],block.lat[i]],
    population:n,densityPerKm2:n*100}
}

export function populationCell(block:PopulationBlock, i:number):CityFeature {
  const x=i%block.width, y=Math.floor(i/block.width), nw=gridPosition(block,x,y)
  return {type:'Feature', id:populationCellId(block,i), properties:populationCellAttributes(block,i),geometry:{type:'Polygon',coordinates:[
    [nw,gridPosition(block,x,y+1),gridPosition(block,x+1,y+1),gridPosition(block,x+1,y),nw],
  ]}}
}

export function selectedPixel(selection:RasterSelection,block:PopulationBlock,i:number){
  return block.people[i]>=0 && (!selection.mask || Boolean(selection.mask[block.offset+i]&selection.bit))
}
export function rasterCellById(grid:PopulationRaster, id:string, selection?:RasterSelection) {
  const match=/^js-pop-(\d+)-(\d+)$/.exec(id)
  if (!match) return
  const row=Number(match[1]), col=Number(match[2])
  const block=grid.byBlock.get((row-row%blockSize)+','+(col-col%blockSize))
  if (!block || row-block.row>=block.height || col-block.col>=block.width) return
  const index=(row-block.row)*block.width+col-block.col
  if(block.people[index]<0 || selection && !selectedPixel(selection,block,index)) return
  return {block,index}
}
export function rasterFeatureById(grid:PopulationRaster, id:string, selection?:RasterSelection){
  const hit=rasterCellById(grid,id,selection)
  if(hit)return populationCell(hit.block,hit.index)
}

export function pickRaster(selection:RasterSelection,x:number,y:number) {
  for(const block of selection.grid.blocks){
    const [w,s,e,n]=block.bounds
    if(x<w||x>e||y<s||y>n)continue
    let u=.5,v=.5
    for(let j=0;j<3;j++){
      const ax=(block.ne[0]-block.nw[0])*(1-v)+(block.se[0]-block.sw[0])*v
      const ay=(block.ne[1]-block.nw[1])*(1-v)+(block.se[1]-block.sw[1])*v
      const bx=(block.sw[0]-block.nw[0])*(1-u)+(block.se[0]-block.ne[0])*u
      const by=(block.sw[1]-block.nw[1])*(1-u)+(block.se[1]-block.ne[1])*u
      const pos=gridPosition(block,u*block.width,v*block.height), dx=x-pos[0],dy=y-pos[1], det=ax*by-ay*bx
      u+=(dx*by-dy*bx)/det;v+=(ax*dy-ay*dx)/det
    }
    if(u<0||u>=1||v<0||v>=1)continue
    const cx=Math.floor(u*block.width), cy=Math.floor(v*block.height), i=cy*block.width+cx
    if(selectedPixel(selection,block,i)) return populationCellId(block,i)
  }
}
const inhabited = new WeakMap<PopulationRaster,CityFeature[]>()
export function populationDemandRows(dataset?:Dataset):CityFeature[]{
  const grid=populationRaster(dataset)
  if(!grid)return dataset?.features ?? []
  const previous=inhabited.get(grid)
  if(previous)return previous
  const rows:CityFeature[]=[]
  for(const block of grid.blocks)for(let i=0;i<block.people.length;i++)if(block.people[i]>0)rows.push(populationCell(block,i))
  inhabited.set(grid,rows)
  return rows
}
export function populationRecordCount(dataset:Dataset){
  return dataset.id===residentGridId && dataset.features[0]?.properties.kind==='population-raster-block'
    ? dataset.features.reduce((n,row)=>n+Number(row.properties.validCells),0) : dataset.features.length
}

export function* matchingRasterCells(grid:PopulationRaster, search='') {
  const key=search.trim().toLowerCase()
  for(const block of grid.blocks){
    for(let index=0;index<block.people.length;index++){
      if(block.people[index]<0)continue
      if(key){
        const rc=(block.row+Math.floor(index/block.width))+'-'+(block.col+index%block.width)
        if(!(cellPrefix+rc+' '+block.regions[block.zones[index]]+'人口网格 '+rc).toLowerCase().includes(key))continue
      }
      yield {block,index}
    }
  }
}

export function rasterPage(grid:PopulationRaster, page:number, size:number, search=''){
  const filtered=!!search.trim(), start=(page-1)*size, rows:CityFeature[]=[]
  let matches=0
  for(const {block,index} of matchingRasterCells(grid,search)){
    if(matches>=start && rows.length<size)rows.push(populationCell(block,index))
    matches++
    if(!filtered && rows.length===size)return {rows,total:grid.count}
  }
  return {rows,total:filtered ? matches : grid.count}
}

export function withPixelPopulations(dataset:Dataset,ids:Iterable<string>,value:number|null):Dataset{
  if(value!==null && (!Number.isSafeInteger(value) || value<0 || value>2147483647))throw Error('格内人口需为非负整数')
  function* entries(){
    for(const id of ids)yield [id,value] as const
  }
  return withPixelValues(dataset,entries())
}

export function withPixelValues(dataset:Dataset,entries:Iterable<readonly [string,number|null]>):Dataset{
  const grid=populationRaster(dataset)
  if(!grid)throw Error('找不到所选人口网格')
  const selected=new Map<PopulationBlock,Map<number,number>>()
  for(const [id,value] of entries){
    if(value!==null && (!Number.isSafeInteger(value) || value<0 || value>2147483647))throw Error('格内人口需为非负整数')
    const hit=rasterCellById(grid,id)
    if(!hit)throw Error('找不到所选人口网格：'+id)
    let indices=selected.get(hit.block)
    if(!indices){indices=new Map();selected.set(hit.block,indices)}
    indices.set(hit.index,value??-1)
  }
  if(!selected.size)return dataset
  let removed=0
  const features=dataset.features.map(tile=>{
    const block=grid.byBlock.get(tile.properties.row+','+tile.properties.col)
    const indices=block && selected.get(block)
    if(!block || !indices)return tile
    const runs:number[]=[]
    let deleted=0
    for(let i=0;i<block.people.length;i++){
      const n=indices.get(i)??block.people[i], zone=block.zones[i], end=runs.length
      if(n<0 && block.people[i]>=0)deleted++
      if(end && runs[end-2]===n && runs[end-1]===zone)runs[end-3]++
      else runs.push(1,n,zone)
    }
    removed+=deleted
    return {...tile,properties:{...tile.properties,runs,validCells:Number(tile.properties.validCells)-deleted}}
  })
  return {...dataset,features,source:dataset.source && {...dataset.source,count:grid.count-removed}}
}
export function withPixelPopulation(dataset:Dataset,id:string,value:number|null){
  return withPixelPopulations(dataset,[id],value)
}

export function* rasterGeoJsonChunks(grid:PopulationRaster,name:string,search='',included?:ReadonlySet<string>){
  yield '{"type":"FeatureCollection","name":'+JSON.stringify(name)+',"features":['
  let chunk:string[]=[], first=true
  for(const {block:b,index:i} of matchingRasterCells(grid,search)){
    if(included && !included.has(populationCellId(b,i)))continue
    chunk.push(JSON.stringify(populationCell(b,i)))
    if(chunk.length===256){yield (first?'':',')+chunk.join(',');first=false;chunk=[]}
  }
  if(chunk.length)yield (first?'':',')+chunk.join(',')
  yield ']}'
}
