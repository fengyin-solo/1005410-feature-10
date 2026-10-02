<script setup lang="ts">
import { ref, watch } from 'vue'

import { releaseWarnings } from '@/api/local-service'
import type { BatchItemResult, EntryRow } from '@/data/types'
import ChannelBadges from './ChannelBadges.vue'

// 批量解除：只有已发布放行；待发布不能跳级，已解除幂等跳过，已误报不开口子。
const props = defineProps<{ rows: EntryRow[]; open: boolean }>()
const emit = defineEmits<{
  (event: 'close'): void
  (event: 'done'): void
}>()

const step = ref<'check' | 'result'>('check')
const results = ref<BatchItemResult[]>([])

watch(
  () => props.open,
  (open) => {
    if (open) {
      step.value = 'check'
      results.value = []
    }
  },
)

function execute() {
  const batch = releaseWarnings(props.rows.map((row) => Number(row.id)))
  results.value = batch.items
  step.value = 'result'
  emit('done')
}
</script>

<template>
  <div v-if="open" class="modal-mask" @click.self="emit('close')">
    <div class="modal-card">
      <header class="modal-head">
        <h3>批量解除预警（{{ rows.length }} 条）</h3>
        <button class="btn ghost" type="button" @click="emit('close')">关闭</button>
      </header>

      <div v-if="step === 'check'" class="modal-body">
        <p class="check-hint">仅「已发布」可解除；「待发布」不能越级解除，「已解除」自动跳过，「已误报」不允许解除。</p>
        <table class="batch-table">
          <thead>
            <tr><th>预警编号</th><th>发布对象</th><th>预警级别</th><th>发布渠道</th><th>当前状态</th><th>判定</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="String(row.id)">
              <td>{{ row.预警编号 }}</td>
              <td>{{ row.发布对象 }}</td>
              <td>{{ row.预警级别 || '—' }}</td>
              <td><ChannelBadges :value="row.发布渠道" /></td>
              <td>{{ row.status }}</td>
              <td :class="String(row.status) === '已发布' ? 'cell-ok' : 'cell-denied'">
                {{ String(row.status) === '已发布' ? '将解除' : '将挡回' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="modal-body">
        <p class="result-summary">
          共处理 {{ results.length }} 条：解除 {{ results.filter((i) => i.outcome === 'released').length }} 条，
          重复跳过 {{ results.filter((i) => i.outcome === 'skipped').length }} 条，
          挡回 {{ results.filter((i) => !i.ok).length }} 条
        </p>
        <ul class="result-list">
          <li
            v-for="item in results"
            :key="item.id"
            :class="{
              'result-ok': item.ok && item.outcome !== 'skipped',
              'result-skip': item.outcome === 'skipped',
              'result-denied': !item.ok,
            }"
          >
            <span class="result-code">{{ item.code }}</span>
            <span>{{ item.message }}</span>
          </li>
        </ul>
      </div>

      <footer class="modal-foot">
        <template v-if="step === 'check'">
          <span class="foot-hint">
            可解除 {{ rows.filter((r) => String(r.status) === '已发布').length }} 条
          </span>
          <button class="btn primary" type="button" @click="execute">确认批量解除</button>
        </template>
        <button v-else class="btn primary" type="button" @click="emit('close')">完成</button>
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
  width: 760px;
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
.check-hint { font-size: 12px; color: var(--muted); margin: 0 0 10px; }
.batch-table { width: 100%; border-collapse: collapse; }
.batch-table th, .batch-table td {
  border: 1px solid var(--border);
  padding: 6px 8px;
  font-size: 12px;
  text-align: left;
}
.batch-table th { background: #f8fafc; }
.cell-ok { color: #15803d; }
.cell-denied { color: #b42318; }
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
</style>
