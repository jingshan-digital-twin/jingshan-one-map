<script setup lang="ts">
import { computed } from 'vue'
import { chain } from './chain-taxonomy'
import type { LedgerId, ledgerEnterprises } from './industry-ledgers'

const props = defineProps<{ ledger: LedgerId; values: Record<string, unknown>; enterprises: ReturnType<typeof ledgerEnterprises> }>()
const emit = defineEmits<{ field: [key: string, value: string | number | boolean | undefined] }>()
const read = (key: string) => String(props.values[key] ?? '')
const input = (e: Event) => (e.target as HTMLInputElement).value.trim()
function writeText(key: string, e: Event) { emit('field', key, input(e) || undefined) }
function writeNumber(key: string, e: Event) {
  const raw = input(e)
  emit('field', key, raw === '' ? undefined : Number(raw))
}
function writeStatus(key: string, e: Event) {
  const raw = input(e)
  emit('field', key, raw === '' ? undefined : raw === 'true')
}
const stage = computed(() => chain.find(item => item.id === props.values.chainStage))
function changeStage(e: Event) {
  writeText('chainStage', e)
  emit('field', 'chainTopic', undefined)
}
const entity = computed(() => props.enterprises.find(item => item.id === props.values.enterpriseId))
function changeEntity(e: Event) {
  const next = props.enterprises.find(item => item.id === input(e))
  emit('field', 'enterpriseId', next?.id)
  emit('field', 'topic', next?.topics.length === 1 ? next.topics[0] : undefined)
  if (next?.region) emit('field', 'region', next.region)
}
</script>

<template>
  <div class="form-grid ledger-fields">
    <label v-if="ledger !== 'industry_procurement'">统计年度<input type="number" min="1000" max="9999" step="1" required :value="read('year')" @input="writeNumber('year', $event)" /></label>
    <template v-if="ledger === 'industry_enterprise_annual'">
      <label>名录企业<select required :value="read('enterpriseId')" @change="changeEntity">
        <option value="">请选择企业</option>
        <option v-if="values.enterpriseId && !entity" :value="read('enterpriseId')">{{ values.enterpriseId }}（历史记录）</option>
        <option v-for="item in enterprises" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select></label>
      <label>经营环节<select required :value="read('topic')" @change="writeText('topic', $event)">
        <option value="">请选择经营环节</option>
        <option v-if="values.topic && !entity?.topics.some(item => item === values.topic)" :value="read('topic')">{{ values.topic }}</option>
        <option v-for="topic in entity?.topics" :key="topic">{{ topic }}</option>
      </select></label>
      <label>核验状态<select required :value="read('sourceStatus')" @change="writeText('sourceStatus', $event)">
        <option value="">请选择</option><option>待核验</option><option>已核验</option>
      </select></label>
      <label>该环节实际经营<select :value="read('operating')" @change="writeStatus('operating', $event)">
        <option value="">待核实</option><option value="true">是</option><option value="false">否</option>
      </select></label>
      <label>规上企业<select :value="read('aboveScale')" @change="writeStatus('aboveScale', $event)">
        <option value="">待核实</option><option value="true">是</option><option value="false">否</option>
      </select></label>
      <label>该环节营收（万元）<input :value="read('topicRevenueWan')" type="number" min="0" step="any" placeholder="待核实时留空" @input="writeNumber('topicRevenueWan', $event)" /></label>
    </template>
    <template v-else>
      <label>{{ ledger === 'industry_output' ? '产值所属阶段' : '采购方所属阶段' }}<select :value="read('chainStage')" :required="ledger === 'industry_procurement'" @change="changeStage">
        <option value="">{{ ledger === 'industry_output' ? '全链合计' : '请选择阶段' }}</option>
        <option v-for="item in chain" :key="item.id">{{ item.id }}</option>
      </select></label>
      <label v-if="stage">产业环节<select :value="read('chainTopic')" :required="ledger === 'industry_procurement'" @change="writeText('chainTopic', $event)">
        <option value="">{{ ledger === 'industry_output' ? '阶段合计' : '请选择环节' }}</option>
        <option v-if="values.chainTopic && !stage.topics.some(topic => topic === values.chainTopic)" :value="read('chainTopic')">{{ values.chainTopic }}（历史口径）</option>
        <option v-for="topic in stage.topics" :key="topic">{{ topic }}</option>
      </select></label>
      <template v-if="ledger === 'industry_output'">
        <label>产值口径<select required :value="values.outputBasis ?? 'reported'" @change="writeText('outputBasis', $event)">
          <option value="reported">实报</option><option value="estimate">估算</option>
        </select></label>
        <label>年度产值（万元）<input type="number" min="0" step="any" required :value="read('outputWanYuan')" @input="writeNumber('outputWanYuan', $event)" /></label>
        <label class="wide">填报依据（选填）<textarea :value="read('outputSource')" rows="2" @change="writeText('outputSource', $event)"></textarea></label>
      </template>
      <template v-else>
        <label>采购日期<input type="date" required :value="read('purchasedAt')" @input="writeText('purchasedAt', $event)" /></label>
        <label>订单编号<input required :value="read('orderId')" @input="writeText('orderId', $event)" /></label>
        <label>采购方名称<input required :value="read('buyer')" @input="writeText('buyer', $event)" /></label>
        <label>采购品类<input required :value="read('category')" @input="writeText('category', $event)" /></label>
        <label>供应商名称<input :value="read('supplier')" placeholder="待核实时留空" @input="writeText('supplier', $event)" /></label>
        <label>供应商属地<select :value="read('supplierLocality')" @change="writeText('supplierLocality', $event)">
          <option value="">待核实</option><option>京山市内</option><option>京山市外</option>
        </select></label>
        <label>采购金额（元）<input type="number" min="0" step="0.01" :value="read('amountYuan')" placeholder="待核实时留空" @input="writeNumber('amountYuan', $event)" /></label>
        <label>凭证编号<input required :value="read('receipt')" placeholder="合同、发票或验收单号" @input="writeText('receipt', $event)" /></label>
        <label>采购已核验<select :value="values.verified === true ? 'true' : values.verified === false ? 'false' : ''" @change="writeStatus('verified', $event)">
          <option v-if="values.verified == null" value="">未标注</option><option value="false">待核验</option><option value="true">已核验</option>
        </select></label>
        <label class="wide">外采原因（选填）<input list="ledger-reasons" :value="read('externalReason')" @input="writeText('externalReason', $event)" />
          <datalist id="ledger-reasons"><option>供需信息不通</option><option>本地产能不足</option><option>本地无同规格产品</option><option>本地无相应资质供应商</option></datalist>
        </label>
      </template>
    </template>
  </div>
</template>

<style scoped>
.ledger-fields { gap: 10px 14px; }
.ledger-fields label,.ledger-fields select { min-width: 0; }
.ledger-fields .wide { grid-column: 1 / -1; }
</style>
