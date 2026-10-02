<template>
  <section class="page" data-module="wall">
    <header class="page-head">
      <div>
        <h2>支挡结构管理</h2>
        <p class="page-desc">维护支挡结构，并接收预警发布的结论：已发布且发布对象命中结构编号的预警，会在这里形成待转移预警。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出支挡结构清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="relocate-panel">
      <header class="panel-head">
        <h3>待转移预警（{{ filteredPending.length }}）</h3>
        <label class="channel-filter">
          <span>按发布渠道筛选</span>
          <select v-model="channelFilter">
            <option value="">全部渠道</option>
            <option v-for="channel in WARNING_CHANNELS" :key="channel" :value="channel">{{ channel }}</option>
          </select>
        </label>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>预警编号</th>
            <th>对应支挡结构</th>
            <th>预警级别</th>
            <th>触发雨量</th>
            <th>发布时间</th>
            <th>发布渠道</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in filteredPending" :key="String(item.warning.id)">
            <td>{{ item.warning.预警编号 }}</td>
            <td>
              <span v-if="item.wall">{{ item.wall.结构编号 }}（{{ item.wall.结构形式 }}）</span>
              <span v-else class="unmatched">未匹配到结构：{{ item.warning.发布对象 }}</span>
            </td>
            <td>{{ item.warning.预警级别 }}</td>
            <td>{{ item.warning.触发雨量 }}</td>
            <td>{{ item.warning.发布时间 || '—' }}</td>
            <td><ChannelBadges :value="item.warning.发布渠道" /></td>
            <td>
              <button class="link" type="button" @click="detailWarning = item.warning">查看预警</button>
            </td>
          </tr>
          <tr v-if="!filteredPending.length">
            <td colspan="7" class="empty-state">暂无待转移预警</td>
          </tr>
        </tbody>
      </table>
    </section>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无支挡结构数据，可先登记支挡结构</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条支挡结构记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <WarningDetail :warning="detailWarning" @close="detailWarning = null" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import ChannelBadges from '@/components/ChannelBadges.vue'
import WarningDetail from '@/components/WarningDetail.vue'
import {
  downloadEntries,
  listEntries,
  listPendingRelocationWarnings,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { splitChannels, WARNING_CHANNELS, type WarningChannel } from '@/data/warning-rules'

const meta = moduleMeta('wall')
const columns = ['结构编号', '所属工程', '结构形式', '结构长度', '结构高度', '基础埋深', '验收日期', '结构状态']
const actions = ['确认浇筑', '提交验收', '确认通过']
const statuses = ['待浇筑', '施工中', '待验收', '已验收']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const detailWarning = ref<EntryRow | null>(null)
const channelFilter = ref('')

const pendingWarnings = ref(listPendingRelocationWarnings())

const filteredPending = computed(() => {
  if (!channelFilter.value) {
    return pendingWarnings.value
  }
  return pendingWarnings.value.filter((item) =>
    splitChannels(item.warning.发布渠道).includes(channelFilter.value as WarningChannel),
  )
})

const stats = computed(() => {
  const pendingCount = pendingWarnings.value.length
  const matched = pendingWarnings.value.filter((item) => item.wall !== null).length
  return [
    { label: '待转移预警', value: pendingCount },
    { label: '已命中结构', value: matched },
    { label: '待验收结构', value: rows.value.filter((row) => String(row.status) === '待验收').length },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    pendingWarnings.value = listPendingRelocationWarnings()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '支挡结构列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.relocate-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-left: 4px solid #d97706;
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 14px;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.panel-head h3 { margin: 0; font-size: 14px; color: #92400e; }
.channel-filter span { font-size: 12px; color: var(--muted); margin-right: 6px; }
.channel-filter select { padding: 4px 6px; font-size: 12px; }
.unmatched { color: #b45309; font-size: 12px; }
</style>
