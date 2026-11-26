<script setup lang="ts">
// 公众端骨架：入口卡片先占位，后续每个模块独立成 src/modules/<name> 下的页面。
const entries = [
  { key: 'venue', title: '场馆预约', desc: '网球场馆查询、时段预约与订单', status: '待开发' },
  { key: 'event', title: '赛事资讯', desc: '赛程发布、报名入口与观赛指南', status: '待开发' },
  { key: 'industry', title: '产业招商', desc: '产业链图谱、招商载体与政策解读', status: '待开发' },
]
</script>

<template>
  <main class="portal">
    <header class="portal__head">
      <h1>数智京山 · 公众端</h1>
      <p class="portal__sub">面向市民与游客的网球产业服务入口</p>
    </header>

    <section class="portal__grid">
      <article v-for="entry in entries" :key="entry.key" class="card">
        <span class="card__tag">{{ entry.status }}</span>
        <h2>{{ entry.title }}</h2>
        <p>{{ entry.desc }}</p>
      </article>
    </section>

    <footer class="portal__foot">
      <span>骨架已就绪，模块开发中</span>
      <a href="/apps/one-map/">进入一张图 →</a>
    </footer>
  </main>
</template>
