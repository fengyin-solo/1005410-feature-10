<script setup lang="ts">
import { computed } from 'vue'

import { splitChannels } from '@/data/warning-rules'

// 发布渠道统一渲染：预警发布页和支挡结构页都用它，保证是同一套口径。
const props = defineProps<{ value: unknown }>()

const channels = computed(() => splitChannels(props.value))
const invalid = computed(() => {
  const raw = String(props.value ?? '').trim()
  return raw !== '' && channels.value.length === 0
})
</script>

<template>
  <span class="channel-list">
    <span v-for="channel in channels" :key="channel" class="channel-badge">{{ channel }}</span>
    <span v-if="channels.length === 0" :class="['channel-empty', { 'channel-invalid': invalid }]">
      {{ invalid ? `渠道未登记：${value}` : '—' }}
    </span>
  </span>
</template>

<style scoped>
.channel-list { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.channel-badge {
  background: #e8f1ff;
  color: #1d4ed8;
  border: 1px solid #bfd7ff;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
}
.channel-empty { color: #94a3b8; font-size: 12px; }
.channel-invalid { color: #b42318; }
</style>
