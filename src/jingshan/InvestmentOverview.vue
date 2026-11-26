<script setup lang="ts">
import { computed } from 'vue'
import { investmentOverview, type Demand } from './investment-demand'
import ServicePager from './ServicePager.vue'
import { useServicePage } from './service-pagination'
import type { Dataset, Result } from './types'
import { field } from './industry-panorama'

const props=defineProps<{ data:Dataset[]; region:string; demands:Demand[]; tasks:Result[] }>()
const emit=defineEmits<{task:[id:number]}>()
const overview=computed(()=>investmentOverview(props.data,props.region,props.demands,props.tasks))
const projects=computed(()=>overview.value.projects)
const reminders=computed(()=>overview.value.reminders)
const projectPage=useServicePage(projects,[()=>props.region])
const taskPage=useServicePage(reminders,[()=>props.region])
// The glyphs, illustrated users, shield and funds icon come from the V1.4 cockpit specification.
const metricIcons = [
  {src:'investment-v14/demand.png', glyph:true}, {src:'mastergo-overview-users.png'},
  {src:'mastergo-overview-shield.png'}, {src:'investment-v14/project.png', glyph:true},
  {src:'investment-v14/investment.png', glyph:true}, {src:'investment-v14/funds.png'},
]
const stages = ['项目储备','对接','洽谈','签约','落地']
</script>
<template>
  <section class="investment-summary-grid" aria-label="招商指标">
    <div v-for="([label,value],i) in overview.cards" :key="label" class="investment-summary" :title="label+' · '+value">
      <span class="metric-art" aria-hidden="true">
        <i v-if="metricIcons[i].glyph" :style="{'--glyph':'url(/jingshan/ui/'+metricIcons[i].src+')'}"></i>
        <img v-else :src="'/jingshan/ui/'+metricIcons[i].src" alt=""/>
      </span>
      <div class="metric-copy"><span>{{ label }}</span><strong>{{ value }}</strong></div>
    </div>
  </section>
  <section class="investment-chart">
    <h4>项目漏斗分析</h4>
    <ol class="investment-funnel" aria-label="项目各阶段累计数量">
      <li v-for="(stage,i) in overview.funnel" :key="stage.label" :style="{'--level':i}" :title="stage.label+' '+stage.count+' 项'">
        <span>{{ stages[i] }}</span><strong>{{ stage.count }}</strong>
      </li>
    </ol>
    <div class="investment-conversion" title="各阶段累计包含已进入后续阶段的项目"><span>项目落地转化率 <strong>{{ overview.conversion }}</strong></span><span>（落地 {{ overview.funnel[4].count }} / 储备 {{ overview.funnel[0].count }}）</span></div>
  </section>
  <section class="investment-feed"><h4>招商动态</h4>
    <ul v-if="projects.length" class="investment-activity">
      <li v-for="project in projectPage.rows" :key="project.id"><span class="activity-title" :title="project.properties.name">{{ project.properties.name }}</span>
        <span class="industry-status">{{ field(project.properties,['status']) }}</span></li>
    </ul><p v-else class="industry-empty">当前区域暂无项目动态</p>
    <ServicePager v-if="projectPage.pageCount>1" :pagination="projectPage" label="招商动态分页"/>
  </section>
  <section class="investment-feed"><h4>待办提醒</h4>
    <div v-for="item in taskPage.rows" :key="item.id" class="investment-task-link"><i aria-hidden="true">!</i>
      <button type="button" class="industry-row-action" :title="item.name" @click="emit('task',item.id)">{{ item.name }}</button><span class="industry-status" data-tone="amber">{{ item.detail }}</span></div>
    <p v-if="!reminders.length" class="industry-empty">当前区域暂无待办</p>
    <ServicePager v-if="taskPage.pageCount>1" :pagination="taskPage" label="待办分页"/>
  </section>
</template>
<style scoped>
.investment-summary-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
.investment-summary {
  display:flex; align-items:center; gap:8px; min-width:0; min-height:76px; padding:8px;
  border:1px solid var(--v14-edge); border-radius:5px;
  background:linear-gradient(130deg,rgb(32 83 146 / 94%),rgb(20 49 99 / 93%) 62%,rgb(12 63 91 / 88%));
  box-shadow:inset 0 -1px 0 rgb(90 219 255 / 62%);
}
.cockpit-light .investment-summary { background:var(--v14-list); }
.cockpit-light .metric-art i { background:linear-gradient(135deg,#2474c1,#33b3eb); }
.metric-art { position:relative; display:grid; place-items:center; flex:0 0 auto; width:42px; height:48px; }
.metric-art::before { content:""; position:absolute; bottom:1px; left:4%; width:92%; height:14px; border-radius:50%; background:radial-gradient(ellipse,#97ecff 0%,#4891e5 58%,#a7ebff 66%,#467dce 70%); box-shadow:0 4px 0 -1px #2867ac,0 6px 8px #3485cc66; }
.metric-art img,.metric-art i { position:relative; width:34px; height:34px; align-self:start; margin-top:3px; object-fit:contain; filter:drop-shadow(0 2px 3px #22bcff66); }
.metric-art i { background:linear-gradient(145deg,#f0fdff,#6ce8ff 60%,#4793e3); mask:var(--glyph) center/contain no-repeat; }
.metric-copy { display:grid; gap:3px; flex:1; min-width:0; }
.metric-copy span,.metric-copy strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.metric-copy span { font-size:16px; font-weight:700; }
.metric-copy strong { color:var(--v14-metric); font:400 20px/30px "Cockpit Bebas",var(--v14-font); }
.investment-chart { display:grid; gap:8px; padding:6px 0; }
.investment-chart h4,.investment-feed h4 { margin:0; font:700 18px/26px var(--v14-font); }
.investment-funnel { list-style:none; margin:2px 0; padding:0 3%; display:grid; justify-items:center; gap:3px; }
.investment-funnel li {
  width:calc(100% - var(--level)*17%); min-height:32px; display:flex; justify-content:center; align-items:center; gap:10px;
  clip-path:polygon(0 0,100% 0,calc(100% - 8.5cqi) 100%,8.5cqi 100%); color:#fff; font-size:16px;
}
.investment-funnel {container-type:inline-size;}
.investment-funnel li:nth-child(1) {background:#b0f0fe;color:#133453}
.investment-funnel li:nth-child(2) {background:#63adc9;color:#102e47}
.investment-funnel li:nth-child(3) {background:#3981b4}
.investment-funnel li:nth-child(4) {background:#245d9c}
.investment-funnel li:nth-child(5) {background:#193f75}
.investment-conversion {display:flex;justify-content:center;flex-wrap:wrap;gap:0 4px;font-size:16px}
.investment-conversion span {white-space:nowrap}
.investment-feed { padding:8px 10px; border:1px solid var(--v14-edge); border-radius:3px; background:var(--v14-list); min-width:0; }
.investment-feed h4 {border-left:4px solid var(--v14-list-line);padding-left:8px;margin-bottom:6px}
.investment-activity {list-style:none;padding:0;margin:0;}
.investment-activity li,.investment-task-link {display:flex;align-items:center;gap:8px;min-height:32px;padding:3px 0;}
.investment-activity li::before {content:"";width:5px;height:5px;border-radius:50%;background:var(--v14-list-line);flex:none}
.investment-feed .industry-status {flex:none;font-size:16px;line-height:22px;white-space:nowrap}
.activity-title,.investment-task-link button {flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left}
.investment-task-link button {padding:0;border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;}
.investment-task-link button:hover {color:var(--v14-metric);text-decoration:underline;}
.investment-task-link {background:var(--v14-chart-track);padding-inline:8px;margin-top:4px}
.investment-task-link i {display:grid;place-items:center;width:18px;height:18px;border-radius:50%;background:#ff8b38;color:#163556;font:700 16px/1 var(--v14-font)}
@container (max-width:500px) {
  .investment-summary-grid {gap:6px}
  .investment-summary {gap:4px;padding:6px;min-height:64px}
  .metric-art {width:24px;height:34px}.metric-art img,.metric-art i {width:24px;height:24px}
  .metric-copy strong {font-size:18px;line-height:26px}
}
@container (max-width:375px) {
  .investment-summary-grid {grid-template-columns:repeat(2,minmax(0,1fr))}
}
@container (max-width: 310px) {
  .investment-summary { flex-direction: column; align-items: flex-start; }
  .metric-copy { width: 100%; }
  .investment-funnel li {
    width: calc(100% - var(--level) * 14%);
    clip-path: polygon(0 0,100% 0,calc(100% - 7cqi) 100%,7cqi 100%);
  }
}
@container (max-width: 235px) {
  .investment-summary-grid { grid-template-columns: 1fr; }
  .investment-summary { flex-direction: row; align-items: center; }
  .investment-feed { padding-inline: 4px; }
  .investment-feed .service-pager { width: auto; margin-inline: -3px; }
}
</style>
