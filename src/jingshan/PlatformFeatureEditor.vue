<script setup lang="ts">
import { computed,defineAsyncComponent,ref } from 'vue'
import type { Geometry } from 'geojson'
const SpatialGeometryEditor=defineAsyncComponent(()=>import('./SpatialGeometryEditor.vue'))
import { baiduPlaceUrl, type CityFeature, type Dataset } from './types.ts'
import { acceptsPendingLocation, checkFeature } from './validate.ts'
import { applyLocalProperties, extraProperties, localFields } from './local-feature-fields.ts'
import { courtSourceField, isCourtLedgerId, surveyCourtLedgerId, surveyCourtName } from './court-ledger.ts'
import { browserUuid } from './browser-uuid'
import { venueOwnershipGroup, venueOwnershipGroups } from './venue-ownership.ts'

const props = defineProps<{ dataset:Dataset; feature?:CityFeature }>()
const emit = defineEmits<{ apply:[feature:CityFeature]; cancel:[] }>()
const isCourtLedger = isCourtLedgerId(props.dataset.id)
const nameField = courtSourceField(props.dataset.id,'名称')
const initial = props.feature
const fields = initial?.properties
const id = ref(initial?.id ?? (props.dataset.id + '-' + browserUuid()))
const name = ref(fields?.name ?? '')
const region = ref(fields?.region ?? '')
const kind = ref(fields?.kind ?? props.dataset.features[0]?.properties.kind ?? (props.dataset.id === 'courts' ? 'court' : props.dataset.id))
const type = ref(initial?.geometry.type ?? props.dataset.features[0]?.geometry.type ?? (isCourtLedger || props.dataset.id === 'courts' ? 'Polygon' : 'Point'))
const point = initial?.geometry.type === 'Point' ? initial.geometry.coordinates : []
const lng = ref(String(point[0] ?? ''))
const lat = ref(String(point[1] ?? ''))
const height = ref(String(point[2] ?? ''))
const coordinates = ref(initial && initial.geometry.type !== 'Point' && 'coordinates' in initial.geometry ? JSON.stringify(initial.geometry.coordinates) : '')
const geometryDraft=computed<Geometry|undefined>(()=>{
  if(type.value==='GeometryCollection')return
  if(type.value==='Point')return lng.value.trim() && lat.value.trim() && Number.isFinite(+lng.value) && Number.isFinite(+lat.value)
    ?{type:'Point',coordinates:[+lng.value,+lat.value,...(height.value.trim()?[+height.value]:[])]}:undefined
  try{return coordinates.value?{type:type.value,coordinates:JSON.parse(coordinates.value)} as Geometry:undefined}catch{return}
})
function changeGeometry(g:Geometry){
  if(g.type==='Point'){lng.value=String(g.coordinates[0]);lat.value=String(g.coordinates[1]);height.value=g.coordinates[2]===undefined?'':String(g.coordinates[2])}
  else if('coordinates' in g)coordinates.value=JSON.stringify(g.coordinates)
}
const business = localFields(props.dataset,fields)
const businessFields = isCourtLedger ? business.filter(field => field.key !== nameField) : business
const changes = ref<Record<string,string>>({})
const extra = extraProperties(business,fields ?? {})
let fieldSequence=0
type EditableAttribute={row:number;key:string;type:string;value:string}
const raw=extra.sourceAttributes
const splitSource=raw!==null && typeof raw==='object' && !Array.isArray(raw)
if(splitSource)delete extra.sourceAttributes
function editableRows(attributes:Record<string,unknown>):EditableAttribute[]{return Object.entries(attributes).map(([key,v])=>({row:++fieldSequence,key,
  type:v===null||typeof v==='object'?'JSON':typeof v,value:typeof v==='string'?v:JSON.stringify(v)}))}
const attributeGroups=ref([{id:'extra',label:'扩展属性',rows:editableRows(extra)},
  ...(splitSource?[{id:'original',label:'导入文件属性',rows:editableRows(raw as Record<string,unknown>)}]:[])])
function readProperties(entries:EditableAttribute[]){
  const rows=new Map<string,unknown>()
  for(const f of entries){
    const key=f.key.trim()
    if(!key||rows.has(key))throw Error('扩展属性名不能为空或重复。')
    let value:unknown=f.value
    if(f.type==='number'){
      if(!f.value.trim()||!Number.isFinite(Number(f.value)))throw Error(key+' 需要填写数值。')
      value=Number(f.value)
    }else if(f.type==='boolean')value=f.value==='true'
    else if(f.type==='JSON')value=JSON.parse(f.value)
    rows.set(key,value)
  }
  return Object.fromEntries(rows)
}
const error = ref('')
function currentValue(key:string) {
  return Object.hasOwn(changes.value,key) ? changes.value[key] : String(fields?.[key] ?? '')
}
function change(key:string,event:Event) {
  changes.value[key] = (event.target as HTMLInputElement | HTMLSelectElement).value
}

function apply() {
  try {
    const attributes=readProperties(attributeGroups.value[0].rows)
    if(splitSource){
      if(Object.hasOwn(attributes,'sourceAttributes'))throw Error('导入文件属性已单独列出。')
      attributes.sourceAttributes=readProperties(attributeGroups.value[1].rows)
    }
    const additional = applyLocalProperties(business,fields ?? {},changes.value,attributes)
    // The source may have a blank ledger name and a separate imported map label.
    const displayName = props.dataset.id===surveyCourtLedgerId ? surveyCourtName(additional) : isCourtLedger
      ? String(additional[nameField] || (fields?.[nameField] ? id.value : fields?.name || id.value)).trim()
      : name.value.trim()
    let geometry:unknown
    if (type.value === 'Point') {
      if (!lng.value.trim() || !lat.value.trim()) throw new Error('请填写经度和纬度')
      const list = [Number(lng.value),Number(lat.value)]
      if (height.value.trim()) list.push(Number(height.value))
      geometry = {type:'Point',coordinates:list}
    } else if (type.value === 'GeometryCollection') geometry = {type:'GeometryCollection',geometries:[]}
    else geometry = {type:type.value,coordinates:JSON.parse(coordinates.value)}
    const { bbox, ...original } = initial ?? {}
    const previous = initial?.geometry
    const sameGeometry = previous?.type === type.value && (previous.type === 'GeometryCollection' ||
      JSON.stringify(previous.coordinates) === JSON.stringify((geometry as {coordinates:unknown}).coordinates))
    const changedIdentity = fields?.locationReview && (name.value.trim() !== fields.name ||
      additional.address !== fields.address || region.value.trim() !== fields.region)
    if ((!sameGeometry || changedIdentity) && (acceptsPendingLocation(props.dataset.id) || props.dataset.id === 'charging')) {
      delete additional.locationRef
      delete additional.locationReview
      if (initial && acceptsPendingLocation(props.dataset.id)) additional.locationManuallyEdited = true
      if (type.value === 'GeometryCollection') delete additional.locationSource
      else if (!changes.value.locationSource?.trim()) additional.locationSource = sameGeometry ? '留用原点位，场所信息已修改' : '数据中台人工定位'
    }
    const feature:unknown = {...original,...(sameGeometry && bbox ? {bbox} : {}), type:'Feature', id:id.value.trim(), geometry:sameGeometry ? previous : geometry,
      properties:{...additional, name:displayName, region:region.value.trim(), kind:kind.value.trim()}}
    checkFeature(feature, '当前要素',props.dataset.id)
    emit('apply',feature)
  } catch (e) { error.value = e instanceof SyntaxError ? '请检查坐标数组或扩展属性的 JSON 格式' : String(e instanceof Error ? e.message : e) }
}
</script>

<template>
  <form class="local-form workspace-feature-form" @submit.prevent="apply">
    <div class="local-form-grid">
      <label v-if="isCourtLedger">{{ dataset.id===surveyCourtLedgerId ? '实体名称' : '场地名称' }}<input :value="currentValue(nameField)" :required="dataset.id===surveyCourtLedgerId" maxlength="120" autofocus @input="change(nameField,$event)"></label>
      <label v-else>名称<input v-model="name" required maxlength="120" autofocus></label>
      <label>{{ dataset.id===surveyCourtLedgerId ? '地图所属镇街' : '所属行政区' }}<input v-model="region" required maxlength="120" placeholder="京山市或所属镇街"></label>
      <label>要素编号<input v-model="id" required maxlength="150" :readonly="Boolean(initial)"></label>
      <label>业务类别<input v-model="kind" required maxlength="120"></label>
    </div>
    <fieldset v-if="businessFields.length"><legend>业务属性</legend>
      <div class="local-form-grid">
        <label v-for="field in businessFields" :key="field.key">{{ field.label }}
          <select v-if="field.type === 'boolean'" :aria-label="field.label" :value="currentValue(field.key)" @change="change(field.key,$event)">
            <option value="">未填写</option><option value="true">是</option><option value="false">否</option>
          </select>
          <select v-else-if="field.key==='ownership' && (dataset.id==='venues' || dataset.id==='courts')" :aria-label="field.label"
            :value="venueOwnershipGroup(currentValue(field.key))?.label ?? currentValue(field.key)" @change="change(field.key,$event)">
            <option value="">未填写</option>
            <option v-if="currentValue(field.key) && !venueOwnershipGroup(currentValue(field.key))" :value="currentValue(field.key)" disabled>{{ currentValue(field.key) }}（原值）</option>
            <option v-for="group in venueOwnershipGroups" :key="group.label" :value="group.label">{{ group.shortLabel }}</option>
          </select>
          <input v-else :type="field.type" :step="field.type === 'number' ? 'any' : undefined"
            :value="currentValue(field.key)" @input="change(field.key,$event)">
        </label>
      </div>
    </fieldset>
    <fieldset class="workspace-geometry-field"><legend>空间位置</legend>
      <div v-if="fields?.locationReview" class="local-help">
        <b>地图核对 · {{ fields.locationReview.checkedOn }}</b>
        <p>{{ fields.locationReview.note }}</p>
        <p v-if="fields.locationReview.poi">
          <a :href="baiduPlaceUrl(fields.locationReview.poi.uid)" target="_blank" rel="noopener noreferrer">{{ fields.locationReview.poi.name }} ↗</a>
          · {{ fields.locationReview.poi.address }}
        </p>
      </div>
      <label>几何类型<select v-model="type">
        <option value="Point">点</option><option value="MultiPoint">多点</option><option value="LineString">线</option><option value="MultiLineString">多线</option><option value="Polygon">面</option><option value="MultiPolygon">多面</option>
        <option v-if="kind === 'business' || acceptsPendingLocation(dataset.id)" value="GeometryCollection">待定位</option>
      </select></label>
      <SpatialGeometryEditor :dataset-id="dataset.id" :type="type" :geometry="geometryDraft" @change="changeGeometry"/>
      <div v-if="type === 'Point'" class="local-form-grid local-coordinates">
        <label>经度（WGS84）<input v-model="lng" type="text" inputmode="decimal" required /></label>
        <label>纬度（WGS84）<input v-model="lat" type="text" inputmode="decimal" required /></label>
        <label>高程（选填）<input v-model="height" type="text" inputmode="decimal" /></label>
      </div>
      <label v-else-if="type !== 'GeometryCollection'">WGS84 坐标数组<textarea v-model="coordinates" rows="5" required spellcheck="false" placeholder="填写 GeoJSON 几何对象的 coordinates 数组，经度在前，面环需闭合"></textarea></label>
    </fieldset>
    <details v-for="group in attributeGroups" :key="group.id" :open="group.id==='extra'"><summary>{{group.label}}（{{group.rows.length}}）</summary>
      <div v-for="f in group.rows" :key="f.row" class="local-form-grid"><label>字段名<input v-model="f.key" required></label>
        <label>类型<select v-model="f.type"><option value="string">文本</option><option value="number">数值</option><option value="boolean">是 / 否</option><option>JSON</option></select></label>
        <label>属性值<select v-if="f.type==='boolean'" v-model="f.value"><option value="true">是</option><option value="false">否</option></select><textarea v-else-if="f.type==='JSON'" v-model="f.value" rows="2"/><input v-else v-model="f.value" :type="f.type==='number'?'number':'text'" step="any"></label>
        <button type="button" @click="group.rows=group.rows.filter(x=>x.row!==f.row)">移除字段</button></div>
      <button type="button" @click="group.rows.push({row:++fieldSequence,key:'',type:'string',value:''})">{{group.id==='original'?'新增导入字段':'新增属性'}}</button>
    </details>
    <p v-if="initial?.properties.sourceServiceId && dataset.source" class="local-help">此要素关联 {{ dataset.source.serviceName }}。再次同步该服务时，源要素会随服务数据更新。</p>
    <p v-if="error" class="local-error" role="alert">{{ error }}</p>
    <footer><button type="button" @click="emit('cancel')">取消</button><button class="local-primary" type="submit">应用到草稿</button></footer>
  </form>
</template>
