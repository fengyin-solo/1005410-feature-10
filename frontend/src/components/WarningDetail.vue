<script setup lang="ts">
import { computed } from 'vue'

import type { EntryRow } from '@/data/types'
import { checkRainfall, levelByRainfall, WARNING_LEVELS } from '@/data/warning-rules'
import ChannelBadges from './ChannelBadges.vue'

// 预警详情：预警发布页与支挡结构页点开看到的渠道、级别口径完全一致。
const props = defineProps<{ warning: EntryRow | null }>()
const emit = defineEmits<{ (event: 'close'): void }>()

const rainCheck = computed(() =>
  props.warning ? checkRainfall(props.warning.触发雨量) : { ok: false as const, reason: '' },
)
const derivedLevel = computed(() =>
  rainCheck.value.ok ? levelByRainfall(rainCheck.value.value) : null,
)
const levelConflict = computed(() => {
  if (!props.warning || !derivedLevel.value) {
    return false
  }
  const raw = String(props.warning.预警级别 ?? '').trim()
  return raw !== '' && WARNING_LEVELS.includes(raw as (typeof WARNING_LEVELS)[number]) && raw !== derivedLevel.value
})
</script>

<template>
  <div v-if="warning" class="modal-mask" @click.self="emit('close')">
    <div class="modal-card detail-card">
      <header class="modal-head">
        <h3>预警详情 · {{ warning.预警编号 }}</h3>
        <button class="btn ghost" type="button" @click="emit('close')">关闭</button>
      </header>
      <dl class="detail-grid">
        <div><dt>发布对象</dt><dd>{{ warning.发布对象 || '—' }}</dd></div>
        <div>
          <dt>预警级别</dt>
          <dd>
            <span :class="{ 'level-conflict': levelConflict }">{{ warning.预警级别 || '未填' }}</span>
            <span v-if="levelConflict" class="detail-hint">按雨量口径应为 {{ derivedLevel }}</span>
          </dd>
        </div>
        <div>
          <dt>触发雨量</dt>
          <dd :class="{ 'field-invalid': !rainCheck.ok }">
            {{ warning.触发雨量 || '未填' }}
            <span v-if="!rainCheck.ok" class="detail-hint">{{ rainCheck.reason }}</span>
          </dd>
        </div>
        <div><dt>当前状态</dt><dd>{{ warning.status }}</dd></div>
        <div><dt>发布时间</dt><dd>{{ warning.发布时间 || '—' }}</dd></div>
        <div><dt>解除时间</dt><dd>{{ warning.解除时间 || '—' }}</dd></div>
        <div class="detail-channels">
          <dt>发布渠道</dt>
          <dd><ChannelBadges :value="warning.发布渠道" /></dd>
        </div>
      </dl>
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
  z-index: 50;
}
.modal-card {
  background: #fff;
  border-radius: 10px;
  min-width: 520px;
  max-width: 720px;
  max-height: 86vh;
  overflow: auto;
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
.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 24px;
  padding: 16px 18px;
  margin: 0;
}
.detail-grid dt { font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.detail-grid dd { margin: 0; font-size: 13px; }
.detail-channels { grid-column: 1 / -1; }
.detail-hint { display: block; color: #b45309; font-size: 12px; margin-top: 2px; }
.level-conflict { color: #b45309; font-weight: 600; }
.field-invalid { color: #b42318; }
</style>
