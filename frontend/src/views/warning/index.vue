<template>
  <section class="page" data-module="warning">
    <header class="page-head">
      <div>
        <h2>预警发布管理</h2>
        <p class="page-desc">预警成片到达时勾选多条一次发布：缺级别或缺渠道的挑出来补填，触发雨量越界的挡回；解除同样支持多选。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" :disabled="!hasSelection" @click="openPublish">批量发布（{{ selectedIds.size }}）</button>
        <button class="btn" type="button" :disabled="!hasSelection" @click="openRelease">批量解除（{{ selectedIds.size }}）</button>
        <button class="btn" type="button" @click="exportRows">导出预警发布清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

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
          <th class="check-cell">
            <input
              type="checkbox"
              :checked="allVisibleSelected"
              :indeterminate.prop="someVisibleSelected && !allVisibleSelected"
              @change="toggleAll"
            />
          </th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-selected': selectedIds.has(Number(row.id)) }">
          <td class="check-cell">
            <input type="checkbox" :checked="selectedIds.has(Number(row.id))" @change="toggleOne(Number(row.id))" />
          </td>
          <td>
            <button class="link" type="button" @click="detailWarning = row">{{ row.预警编号 }}</button>
          </td>
          <td>{{ row.发布对象 ?? '—' }}</td>
          <td :class="{ 'level-conflict-text': levelConflict(row) }">{{ row.预警级别 || '未填' }}</td>
          <td :class="{ 'rain-invalid': !rainOk(row) }">{{ row.触发雨量 || '未填' }}</td>
          <td>{{ row.发布时间 || '—' }}</td>
          <td><ChannelBadges :value="row.发布渠道" /></td>
          <td>{{ row.解除时间 || '—' }}</td>
          <td>{{ row.预警状态 || '—' }}</td>
          <td>
            <span class="row-status-tag">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <button
              v-if="String(row.status) === '待发布'"
              class="link"
              type="button"
              @click="publishOne(row)"
            >
              确认发布
            </button>
            <button
              v-if="String(row.status) === '已发布'"
              class="link"
              type="button"
              @click="releaseOne(row)"
            >
              解除预警
            </button>
            <button
              v-if="String(row.status) === '已发布'"
              class="link link-warn"
              type="button"
              @click="falseAlarmOne(row)"
            >
              标记误报
            </button>
            <button class="link" type="button" @click="detailWarning = row">查看</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无预警发布数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条预警发布记录，已选 {{ selectedIds.size }} 条</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <BatchPublishDialog
      :rows="selectedRows"
      :open="publishOpen"
      @close="publishOpen = false"
      @done="afterMutation"
    />
    <BatchReleaseDialog
      :rows="selectedRows"
      :open="releaseOpen"
      @close="releaseOpen = false"
      @done="afterMutation"
    />
    <WarningDetail :warning="detailWarning" @close="detailWarning = null" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import BatchPublishDialog from '@/components/BatchPublishDialog.vue'
import BatchReleaseDialog from '@/components/BatchReleaseDialog.vue'
import ChannelBadges from '@/components/ChannelBadges.vue'
import WarningDetail from '@/components/WarningDetail.vue'
import {
  downloadEntries,
  listEntries,
  markFalseAlarm,
  moduleMeta,
  publishWarnings,
  releaseWarnings,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { checkRainfall, levelByRainfall } from '@/data/warning-rules'

const meta = moduleMeta('warning')
const columns = ['预警编号', '发布对象', '预警级别', '触发雨量', '发布时间', '发布渠道', '解除时间', '预警状态']
const statuses = ['待发布', '已发布', '已解除', '已误报']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const selectedIds = ref<Set<number>>(new Set())
const publishOpen = ref(false)
const releaseOpen = ref(false)
const detailWarning = ref<EntryRow | null>(null)

const stats = computed(() => [
  { label: '待发布预警', value: rows.value.filter((row) => String(row.status) === '待发布').length },
  { label: '已发布预警', value: rows.value.filter((row) => String(row.status) === '已发布').length },
  { label: '本月误报数', value: rows.value.filter((row) => String(row.status) === '已误报').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const selectedRows = computed(() =>
  rows.value.filter((row) => selectedIds.value.has(Number(row.id))),
)
const hasSelection = computed(() => selectedIds.value.size > 0)
const allVisibleSelected = computed(
  () => rows.value.length > 0 && rows.value.every((row) => selectedIds.value.has(Number(row.id))),
)
const someVisibleSelected = computed(() =>
  rows.value.some((row) => selectedIds.value.has(Number(row.id))),
)

function rainOk(row: EntryRow): boolean {
  return checkRainfall(row.触发雨量).ok
}

function levelConflict(row: EntryRow): boolean {
  const rain = checkRainfall(row.触发雨量)
  if (!rain.ok) {
    return false
  }
  const raw = String(row.预警级别 ?? '').trim()
  return raw !== '' && raw !== levelByRainfall(rain.value)
}

function toggleOne(id: number) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selectedIds.value = next
}

function toggleAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  selectedIds.value = checked ? new Set(rows.value.map((row) => Number(row.id))) : new Set()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openPublish() {
  if (!hasSelection.value) {
    return
  }
  publishOpen.value = true
}

function openRelease() {
  if (!hasSelection.value) {
    return
  }
  releaseOpen.value = true
}

function publishOne(row: EntryRow) {
  errorMessage.value = ''
  const batch = publishWarnings([Number(row.id)])
  const item = batch.items[0]
  if (item && item.outcome === 'denied') {
    errorMessage.value = `${row.预警编号}：${item.message}`
  }
  afterMutation()
}

function releaseOne(row: EntryRow) {
  errorMessage.value = ''
  const batch = releaseWarnings([Number(row.id)])
  const item = batch.items[0]
  if (item && !item.ok) {
    errorMessage.value = `${row.预警编号}：${item.message}`
  }
  afterMutation()
}

function falseAlarmOne(row: EntryRow) {
  errorMessage.value = ''
  const result = markFalseAlarm(Number(row.id))
  if (!result.ok) {
    errorMessage.value = result.message
  }
  afterMutation()
}

function afterMutation() {
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    // 清掉已经不在筛选结果里的勾选项，避免批量时带入选不到的记录
    const visibleIds = new Set(rows.value.map((row) => Number(row.id)))
    selectedIds.value = new Set([...selectedIds.value].filter((id) => visibleIds.has(id)))
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '预警发布列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.check-cell { width: 36px; text-align: center; }
.row-selected { background: #f5f9ff; }
.row-status-tag {
  display: inline-block;
  border-radius: 4px;
  padding: 1px 8px;
  font-size: 12px;
  background: #eef2f7;
}
.rain-invalid { color: #b42318; font-weight: 600; }
.level-conflict-text { color: #b45309; }
.link-warn { color: #b45309; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
