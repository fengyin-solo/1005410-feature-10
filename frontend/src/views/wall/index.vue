<template>
  <section class="page" data-module="wall">
    <header class="page-head">
      <div>
        <h2>支挡结构管理</h2>
        <p class="page-desc">维护支挡结构，围绕结构编号、所属工程、结构形式、结构长度做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记支挡结构</button>
        <button class="btn" type="button" @click="exportRows">导出支挡结构清单</button>
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

    <section class="transfer-panel">
      <header class="transfer-head">
        <div>
          <h3>待转移预警清单</h3>
          <p class="page-desc">预警发布的结论会落到这里，按预警编号去重，重复提交不会多出第二条。</p>
        </div>
        <label class="filter-item">
          <span>发布渠道</span>
          <select v-model="transferChannel">
            <option value="">全部渠道</option>
            <option v-for="channel in channelOptions" :key="channel" :value="channel">{{ channel }}</option>
          </select>
        </label>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in transferColumns" :key="column">{{ column }}</th>
            <th>转移状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in transferRows" :key="String(row.id)">
            <td v-for="column in transferColumns" :key="column">{{ row[column] === '' ? '—' : (row[column] ?? '—') }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-if="row.status === '待转移'"
                class="link"
                type="button"
                @click="runTransfer(row)"
              >
                确认转移
              </button>
              <span v-else class="muted-text">已办结</span>
            </td>
          </tr>
          <tr v-if="!transferRows.length">
            <td :colspan="transferColumns.length + 2" class="empty-state">暂无待转移预警，预警发布后会自动落到这张清单</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>共 {{ transferRows.length }} 条待转移预警</span>
        <span v-if="transferMessage" class="error-text">{{ transferMessage }}</span>
      </footer>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { confirmTransfer, listTransferWarnings } from '@/api/warning-service'
import { WARNING_CHANNELS } from '@/data/warning-rules'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('wall')
const columns = ["结构编号", "所属工程", "结构形式", "结构长度", "结构高度", "基础埋深", "验收日期", "结构状态"]
const actions = ["确认浇筑", "提交验收", "确认通过"]
const statuses = ["待浇筑", "施工中", "待验收", "已验收"]
const stats = [{"label": "施工中结构", "value": 0}, {"label": "待验收结构", "value": 0}, {"label": "结构总长度", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

// 待转移预警清单：数据来自预警发布的结论，渠道目录与预警发布页是同一套。
const transferColumns = ["预警编号", "发布对象", "预警级别", "触发雨量", "发布渠道", "发布时间"]
const channelOptions = WARNING_CHANNELS
const transferAll = ref<EntryRow[]>([])
const transferChannel = ref('')
const transferMessage = ref('')
const transferRows = computed(() =>
  transferChannel.value === ''
    ? transferAll.value
    : transferAll.value.filter((row) => String(row['发布渠道']) === transferChannel.value),
)

function reloadTransfers() {
  transferAll.value = listTransferWarnings()
}

function runTransfer(row: EntryRow) {
  transferMessage.value = ''
  const result = confirmTransfer(Number(row.id))
  if (!result.ok) {
    transferMessage.value = result.message
  }
  reloadTransfers()
}
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

function openCreate() {
  errorMessage.value = '支挡结构登记入口尚未接入审批流'
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
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '支挡结构列表读取失败'
  }
}

onMounted(() => {
  reload()
  reloadTransfers()
})
</script>
