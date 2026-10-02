<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import { publishWarnings } from '@/api/local-service'
import type { BatchItemResult, EntryRow } from '@/data/types'
import {
  isWarningLevel,
  precheckWarnings,
  splitChannels,
  WARNING_CHANNELS,
  WARNING_LEVELS,
  type WarningChannel,
} from '@/data/warning-rules'
import ChannelBadges from './ChannelBadges.vue'

// 批量发布弹窗：先按业务口径分组，缺级别/渠道的在这里补齐，挡回的只告知不允许改。
const props = defineProps<{ rows: EntryRow[]; open: boolean }>()
const emit = defineEmits<{
  (event: 'close'): void
  (event: 'done'): void
}>()

const step = ref<'check' | 'result'>('check')
const results = ref<BatchItemResult[]>([])

// 缺项条目逐行补填：级别默认给雨量反算建议，渠道勾选统一清单。
const fills = reactive<Record<number, { level: string; channels: WarningChannel[] }>>({})

const groups = computed(() => precheckWarnings(props.rows))

watch(
  () => props.open,
  (open) => {
    if (open) {
      step.value = 'check'
      results.value = []
      for (const item of precheckWarnings(props.rows).incomplete) {
        const rawLevel = String(item.row.预警级别 ?? '').trim()
        fills[Number(item.row.id)] = {
          level: isWarningLevel(rawLevel) ? rawLevel : item.suggestedLevel ?? '',
          channels: [],
        }
      }
    }
  },
)

const readyIds = computed(() => groups.value.ready.map((item) => Number(item.row.id)))
const completableIds = computed(() =>
  groups.value.incomplete
    .filter((item) => {
      const fill = fills[Number(item.row.id)]
      if (!fill) {
        return false
      }
      const rawLevel = String(item.row.预警级别 ?? '').trim()
      const hasValidLevel = isWarningLevel(rawLevel) || fill.level !== ''
      const hasChannel = splitChannels(item.row.发布渠道).length > 0 || fill.channels.length > 0
      return hasValidLevel && hasChannel
    })
    .map((item) => Number(item.row.id)),
)

function toggleChannel(id: number, channel: WarningChannel) {
  const fill = fills[id]
  if (!fill) {
    return
  }
  const index = fill.channels.indexOf(channel)
  if (index >= 0) {
    fill.channels.splice(index, 1)
  } else {
    fill.channels.push(channel)
  }
}

function execute() {
  const ids = [...readyIds.value, ...completableIds.value]
  const supplements: Record<number, { level: string; channels: WarningChannel[] }> = {}
  for (const id of completableIds.value) {
    supplements[id] = fills[id]
  }
  const batch = publishWarnings(ids, supplements)
  results.value = batch.items
  step.value = 'result'
  emit('done')
}

function close() {
  emit('close')
}

const resultTone = (item: BatchItemResult) => ({
  'result-ok': item.ok && item.outcome !== 'skipped',
  'result-skip': item.outcome === 'skipped',
  'result-denied': !item.ok,
})
</script>

<template>
  <div v-if="open" class="modal-mask" @click.self="close">
    <div class="modal-card batch-card">
      <header class="modal-head">
        <h3>批量发布预警（{{ rows.length }} 条）</h3>
        <button class="btn ghost" type="button" @click="close">关闭</button>
      </header>

      <!-- 第一步：分组核对 + 缺项补填 -->
      <div v-if="step === 'check'" class="modal-body">
        <section class="bucket">
          <h4 class="bucket-title ready">
            照常发布（{{ groups.ready.length }} 条）
            <span class="bucket-note">级别以触发雨量所在雨量档为准，不符已按雨量口径校正</span>
          </h4>
          <table class="batch-table">
            <thead>
              <tr><th>预警编号</th><th>发布对象</th><th>触发雨量</th><th>发布级别</th><th>发布渠道</th><th>核对</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in groups.ready" :key="String(item.row.id)">
                <td>{{ item.row.预警编号 }}</td>
                <td>{{ item.row.发布对象 }}</td>
                <td>{{ item.row.触发雨量 }}</td>
                <td>{{ item.derivedLevel }}</td>
                <td><ChannelBadges :value="item.row.发布渠道" /></td>
                <td>
                  <span v-if="item.reasons.length" class="cell-warn">
                    {{ item.reasons.join('；') }}
                  </span>
                  <span v-else class="cell-ok">口径一致</span>
                </td>
              </tr>
              <tr v-if="!groups.ready.length">
                <td colspan="6" class="bucket-empty">本次没有可直接发布的条目</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="bucket">
          <h4 class="bucket-title incomplete">
            缺项待补（{{ groups.incomplete.length }} 条）
            <span class="bucket-note">补齐级别和渠道后随本次一起发布，未补齐不发</span>
          </h4>
          <table class="batch-table">
            <thead>
              <tr><th>预警编号</th><th>触发雨量</th><th>问题</th><th>补填预警级别</th><th>补填发布渠道</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in groups.incomplete" :key="String(item.row.id)">
                <td>{{ item.row.预警编号 }}</td>
                <td>{{ item.row.触发雨量 }}</td>
                <td class="cell-warn">{{ item.reasons.join('；') }}</td>
                <td>
                  <select
                    v-if="!isWarningLevel(String(item.row.预警级别 ?? '').trim())"
                    v-model="fills[Number(item.row.id)].level"
                  >
                    <option value="" disabled>选择级别</option>
                    <option v-for="level in WARNING_LEVELS" :key="level" :value="level">{{ level }}</option>
                  </select>
                  <span v-else>{{ item.row.预警级别 }}</span>
                </td>
                <td>
                  <span
                    v-for="channel in WARNING_CHANNELS"
                    :key="channel"
                    :class="['channel-pick', { on: fills[Number(item.row.id)]?.channels.includes(channel) }]"
                    @click="toggleChannel(Number(item.row.id), channel)"
                  >
                    {{ channel }}
                  </span>
                </td>
              </tr>
              <tr v-if="!groups.incomplete.length">
                <td colspan="5" class="bucket-empty">没有缺级别或缺渠道的条目</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="bucket">
          <h4 class="bucket-title rejected">
            雨量越界挡回（{{ groups.rejected.length }} 条）
            <span class="bucket-note">触发雨量不合法，本次不放行</span>
          </h4>
          <table class="batch-table">
            <thead>
              <tr><th>预警编号</th><th>触发雨量</th><th>挡回原因</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in groups.rejected" :key="String(item.row.id)">
                <td>{{ item.row.预警编号 }}</td>
                <td class="cell-denied">{{ item.row.触发雨量 || '未填' }}</td>
                <td class="cell-denied">{{ item.reasons.join('；') }}</td>
              </tr>
              <tr v-if="!groups.rejected.length">
                <td colspan="3" class="bucket-empty">没有越界条目</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <!-- 第二步：逐条结果 -->
      <div v-else class="modal-body">
        <p class="result-summary">
          共处理 {{ results.length }} 条：成功 {{ results.filter((i) => i.ok && i.outcome !== 'skipped').length }} 条，
          重复跳过 {{ results.filter((i) => i.outcome === 'skipped').length }} 条，
          挡回 {{ results.filter((i) => !i.ok).length }} 条
        </p>
        <ul class="result-list">
          <li v-for="item in results" :key="item.id" :class="resultTone(item)">
            <span class="result-code">{{ item.code }}</span>
            <span>{{ item.message }}</span>
          </li>
        </ul>
      </div>

      <footer class="modal-foot">
        <template v-if="step === 'check'">
          <span class="foot-hint">
            将发布 {{ readyIds.length + completableIds.length }} 条
            （含补填 {{ completableIds.length }} 条），挡回 {{ groups.rejected.length }} 条
          </span>
          <button
            class="btn primary"
            type="button"
            :disabled="readyIds.length + completableIds.length === 0"
            @click="execute"
          >
            确认批量发布
          </button>
        </template>
        <button v-else class="btn primary" type="button" @click="close">完成</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 40;
}
.modal-card {
  background: #fff;
  border-radius: 10px;
  width: 880px;
  max-width: 94vw;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.25);
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.modal-head h3 { margin: 0; font-size: 15px; }
.modal-body { padding: 14px 18px; overflow: auto; }
.bucket { margin-bottom: 16px; }
.bucket-title { font-size: 13px; margin: 0 0 8px; display: flex; align-items: baseline; gap: 8px; }
.bucket-title.ready { color: #15803d; }
.bucket-title.incomplete { color: #b45309; }
.bucket-title.rejected { color: #b42318; }
.bucket-note { font-size: 12px; font-weight: 400; color: var(--muted); }
.batch-table { width: 100%; border-collapse: collapse; }
.batch-table th, .batch-table td {
  border: 1px solid var(--border);
  padding: 6px 8px;
  font-size: 12px;
  text-align: left;
  vertical-align: middle;
}
.batch-table th { background: #f8fafc; }
.bucket-empty { text-align: center; color: var(--muted); padding: 10px; }
.cell-ok { color: #15803d; }
.cell-warn { color: #b45309; }
.cell-denied { color: #b42318; }
.channel-pick {
  display: inline-block;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 1px 8px;
  margin: 2px 4px 2px 0;
  font-size: 12px;
  cursor: pointer;
  background: #fff;
}
.channel-pick.on { background: #e8f1ff; border-color: #1f6feb; color: #1d4ed8; }
.modal-foot {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
}
.foot-hint { margin-right: auto; font-size: 12px; color: var(--muted); }
.result-summary { font-size: 13px; margin: 0 0 10px; }
.result-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.result-list li {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 13px;
  display: flex;
  gap: 10px;
}
.result-code { font-weight: 600; min-width: 150px; }
.result-ok { background: #f0fdf4; border-color: #bbf7d0; }
.result-skip { background: #f8fafc; color: var(--muted); }
.result-denied { background: #fef2f2; border-color: #fecaca; color: #b42318; }
select { padding: 4px 6px; font-size: 12px; }
</style>
