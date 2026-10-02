<template>
  <section class="page" data-module="warning">
    <header class="page-head">
      <div>
        <h2>预警发布管理</h2>
        <p class="page-desc">维护预警信息，围绕预警编号、发布对象、预警级别、触发雨量做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记预警信息</button>
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

    <div class="batch-bar">
      <span>已选 {{ selectedIds.length }} 条</span>
      <button class="btn primary" type="button" :disabled="!selectedIds.length" @click="runBatchPublish">
        批量发布
      </button>
      <button class="btn" type="button" :disabled="!selectedIds.length" @click="runBatchCancel">
        批量解除
      </button>
      <button class="btn ghost" type="button" :disabled="!selectedIds.length" @click="clearSelection">
        清空选择
      </button>
      <span class="batch-hint">状态只进不退：待发布 → 已发布 → 已解除 / 已误报</span>
    </div>

    <div v-if="batchResult" class="batch-result">
      <header class="batch-result-head">
        <strong>{{ batchResult.action }}结果</strong>
        <span>
          成功 {{ batchResult.done }} 条 · 待单独处理 {{ batchResult.needsFix }} 条 ·
          已挡回 {{ batchResult.rejected }} 条 · 跳过 {{ batchResult.skipped }} 条
        </span>
        <button class="link" type="button" @click="batchResult = null">收起</button>
      </header>
      <ul class="batch-result-list">
        <li v-for="item in batchResult.items" :key="item.id" class="batch-result-item" :data-kind="item.kind">
          <span class="batch-code">{{ item.code }}</span>
          <span class="batch-message">{{ item.message }}</span>
          <span v-if="item.kind === 'needs-fix'" class="fix-form">
            <select v-model="fixForms[item.id].预警级别">
              <option value="" disabled>选预警级别</option>
              <option v-for="level in levelOptions" :key="level" :value="level">{{ level }}</option>
            </select>
            <select v-model="fixForms[item.id].发布渠道">
              <option value="" disabled>选发布渠道</option>
              <option v-for="channel in channelOptions" :key="channel" :value="channel">{{ channel }}</option>
            </select>
            <button class="btn primary" type="button" @click="fixAndPublish(item.id)">补录并发布</button>
          </span>
        </li>
      </ul>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th class="check-col">
            <input
              type="checkbox"
              :checked="allChecked"
              :disabled="!rows.length"
              @change="toggleAll"
            />
          </th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td class="check-col">
            <input v-model="selectedIds" type="checkbox" :value="Number(row.id)" />
          </td>
          <td v-for="column in columns" :key="column">{{ row[column] === '' ? '—' : (row[column] ?? '—') }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in rowActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!rowActions(row).length" class="muted-text">终态，不再流转</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无预警发布数据，可先登记预警信息</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条预警发布记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
} from '@/api/local-service'
import {
  cancelWarnings,
  completeAndPublish,
  markFalseAlarm,
  publishWarnings,
  type BatchResult,
} from '@/api/warning-service'
import { WARNING_CHANNELS, WARNING_LEVELS, WARNING_TRANSITIONS } from '@/data/warning-rules'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('warning')
const columns = ["预警编号", "发布对象", "预警级别", "触发雨量", "发布时间", "发布渠道", "解除时间", "预警状态"]
const statuses = ["待发布", "已发布", "已解除", "已误报"]
const channelOptions = WARNING_CHANNELS
const levelOptions = WARNING_LEVELS

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const selectedIds = ref<number[]>([])
const batchResult = ref<BatchResult | null>(null)
const fixForms = ref<Record<number, { 预警级别: string; 发布渠道: string }>>({})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '待发布预警', value: rows.value.filter((row) => String(row.status) === '待发布').length },
  { label: '已发布预警', value: rows.value.filter((row) => String(row.status) === '已发布').length },
  { label: '本月误报数', value: rows.value.filter((row) => String(row.status) === '已误报').length },
])

const allChecked = computed(
  () => rows.value.length > 0 && selectedIds.value.length === rows.value.length,
)

function toggleAll() {
  selectedIds.value = allChecked.value ? [] : rows.value.map((row) => Number(row.id))
}

function clearSelection() {
  selectedIds.value = []
}

function rowActions(row: EntryRow): string[] {
  const targets = WARNING_TRANSITIONS[String(row.status)] ?? []
  return meta.actions.filter((action) => targets.includes(meta.actionTargets[action]))
}

function ensureFixForms(result: BatchResult) {
  for (const item of result.items) {
    if (item.kind !== 'needs-fix' || fixForms.value[item.id]) {
      continue
    }
    const row = rows.value.find((entry) => Number(entry.id) === item.id)
    fixForms.value[item.id] = {
      预警级别: String(row?.['预警级别'] ?? ''),
      发布渠道: String(row?.['发布渠道'] ?? ''),
    }
  }
}

function runBatchPublish() {
  errorMessage.value = ''
  const result = publishWarnings([...selectedIds.value])
  batchResult.value = result
  ensureFixForms(result)
  reload()
}

function runBatchCancel() {
  errorMessage.value = ''
  batchResult.value = cancelWarnings([...selectedIds.value])
  reload()
}

function fixAndPublish(id: number) {
  errorMessage.value = ''
  const form = fixForms.value[id]
  if (!form || form.预警级别 === '' || form.发布渠道 === '') {
    errorMessage.value = '补录时预警级别和发布渠道都要选上'
    return
  }
  const item = completeAndPublish(id, form)
  if (batchResult.value) {
    const items = batchResult.value.items.map((entry) => (entry.id === id ? item : entry))
    batchResult.value = {
      action: batchResult.value.action,
      items,
      done: items.filter((entry) => entry.kind === 'published' || entry.kind === 'cancelled').length,
      needsFix: items.filter((entry) => entry.kind === 'needs-fix').length,
      rejected: items.filter((entry) => entry.kind === 'rejected').length,
      skipped: items.filter((entry) => entry.kind === 'skipped').length,
    }
  }
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const id = Number(row.id)
  if (action === '确认发布') {
    batchResult.value = publishWarnings([id])
    ensureFixForms(batchResult.value)
  } else if (action === '解除预警') {
    batchResult.value = cancelWarnings([id])
  } else if (action === '标记误报') {
    const item = markFalseAlarm(id)
    batchResult.value = { action: '标记误报', items: [item], done: item.kind === 'cancelled' ? 1 : 0, needsFix: 0, rejected: 0, skipped: item.kind === 'skipped' ? 1 : 0 }
  }
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '预警信息登记入口尚未接入审批流'
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    const visible = new Set(payload.items.map((row) => Number(row.id)))
    selectedIds.value = selectedIds.value.filter((id) => visible.has(id))
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '预警发布列表读取失败'
  }
}

onMounted(reload)
</script>
