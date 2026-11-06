<script setup>
defineProps({
  modelValue: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  labelledby: { type: String, default: undefined },
  describedby: { type: String, default: undefined }
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <button
    type="button"
    class="switch"
    role="switch"
    :aria-checked="modelValue"
    :aria-labelledby="labelledby"
    :aria-describedby="describedby"
    :disabled="disabled"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="switch__knob" aria-hidden="true"></span>
  </button>
</template>

<style scoped>
.switch {
  position: relative;
  flex: 0 0 auto;
  width: 38px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: #CBD5E1;
  cursor: pointer;
  transition: background-color 0.16s ease;
}
.switch__knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.25);
  transition: transform 0.16s ease;
}
.switch[aria-checked="true"] {
  background: var(--accent);
}
.switch[aria-checked="true"] .switch__knob {
  transform: translateX(16px);
}
.switch:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.switch:focus-visible {
  outline: 3px solid var(--border-focus);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .switch,
  .switch__knob {
    transition: none;
  }
}
</style>
