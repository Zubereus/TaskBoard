<script setup>
import { computed, nextTick } from 'vue'

const props = defineProps({
  modelValue: { type: String, required: true },
  options: { type: Array, required: true }, // [{ value, label, count? }]
  label: { type: String, default: undefined },
  labelledby: { type: String, default: undefined },
  block: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

// Plain array on purpose: only read inside handlers, never rendered.
const items = []

const activeIndex = computed(() =>
  Math.max(0, props.options.findIndex((option) => option.value === props.modelValue))
)

function selectAndFocus(index) {
  emit('update:modelValue', props.options[index].value)
  nextTick(() => items[index]?.focus())
}

function onKeydown(event) {
  const last = props.options.length - 1
  const next = activeIndex.value === last ? 0 : activeIndex.value + 1
  const previous = activeIndex.value === 0 ? last : activeIndex.value - 1
  const target = {
    ArrowRight: next,
    ArrowDown: next,
    ArrowLeft: previous,
    ArrowUp: previous,
    Home: 0,
    End: last
  }[event.key]
  if (target === undefined) return
  event.preventDefault()
  selectAndFocus(target)
}

defineExpose({ focus: () => items[activeIndex.value]?.focus() })
</script>

<template>
  <div
    class="seg"
    :class="{ 'seg--block': block }"
    role="radiogroup"
    :aria-label="label"
    :aria-labelledby="labelledby"
    :style="{ '--seg-count': options.length, '--seg-index': activeIndex }"
    @keydown="onKeydown"
  >
    <span class="seg__pill" aria-hidden="true"></span>
    <button
      v-for="(option, index) in options"
      :key="option.value"
      :ref="(element) => { items[index] = element }"
      type="button"
      role="radio"
      class="seg__option"
      :class="{ 'is-active': index === activeIndex }"
      :aria-checked="index === activeIndex"
      :tabindex="index === activeIndex ? 0 : -1"
      @click="emit('update:modelValue', option.value)"
    >
      <span>{{ option.label }}</span>
      <span v-if="option.count !== undefined" class="seg__count">{{ option.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.seg {
  position: relative;
  display: inline-grid;
  grid-template-columns: repeat(var(--seg-count), minmax(0, 1fr));
  padding: 3px;
  border-radius: 11px;
  background: #EDF1F6;
}
.seg--block {
  display: grid;
  width: 100%;
}
.seg__pill {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 3px;
  width: calc((100% - 6px) / var(--seg-count));
  border-radius: 8px;
  background: var(--panel, #fff);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.1), 0 0 0 1px rgba(15, 23, 42, 0.04);
  transform: translateX(calc(var(--seg-index) * 100%));
  transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}
.seg__option {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 34px;
  padding: 0 18px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.16s ease;
}
.seg__option:hover:not(.is-active) {
  color: var(--text);
}
.seg__count {
  color: var(--text-dim);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.seg__option.is-active { color: var(--accent); }
.seg__option.is-active .seg__count { color: var(--accent); opacity: 0.7; }
.seg__option:focus-visible {
  outline: 3px solid var(--border-focus);
  outline-offset: 1px;
}
@media (prefers-reduced-motion: reduce) {
  .seg__pill,
  .seg__option {
    transition: none;
  }
}
</style>
