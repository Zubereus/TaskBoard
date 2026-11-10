<script setup>
import { ref } from 'vue'

defineProps({
  candidates: { type: Array, default: () => [] },
  busy: Boolean,
  error: { type: String, default: '' }
})
const emit = defineEmits(['claim', 'decline', 'later'])

const selectedId = ref('')
</script>

<template>
  <div class="claim-overlay" role="dialog" aria-modal="true" aria-labelledby="claim-title">
    <section class="claim-dialog">
      <h2 id="claim-title">Bạn là ai trong danh sách?</h2>
      <p class="claim-intro">
        TaskBoard giờ gắn công việc và thông báo với từng máy. Chọn tên của bạn để các công việc
        cũ đã giao cho bạn tiếp tục được nhắc trên máy này.
      </p>

      <div class="claim-list" role="radiogroup" aria-labelledby="claim-title">
        <label
          v-for="person in candidates"
          :key="person.id"
          class="claim-item"
          :class="{ selected: selectedId === person.id }"
        >
          <input v-model="selectedId" type="radio" name="claim-person" :value="person.id" :disabled="busy" />
          <span class="claim-name">{{ person.name }}</span>
          <span v-if="person.role" class="claim-role">{{ person.role }}</span>
        </label>
      </div>

      <p v-if="error" class="claim-error" role="alert">{{ error }}</p>

      <div class="claim-actions">
        <button class="btn btn-ghost" type="button" :disabled="busy" @click="emit('later')">Để sau</button>
        <button class="btn btn-secondary" type="button" :disabled="busy" @click="emit('decline')">
          Tôi là người mới
        </button>
        <button
          class="btn btn-primary"
          type="button"
          :disabled="busy || !selectedId"
          @click="emit('claim', selectedId)"
        >
          Đây là tôi
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.claim-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.42);
}
.claim-dialog {
  width: min(460px, 100%);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  padding: 28px;
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.3);
}
.claim-dialog h2 {
  margin: 0 0 8px;
  color: var(--text);
}
.claim-intro {
  margin: 0 0 16px;
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.5;
}
.claim-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  overflow-y: auto;
}
.claim-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
}
.claim-item.selected {
  border-color: var(--accent);
}
.claim-item input {
  width: auto;
  margin: 0;
}
.claim-name {
  font-weight: 600;
  word-break: break-word;
}
.claim-role {
  margin-left: auto;
  color: var(--text-dim);
  font-size: 12px;
}
.claim-error {
  margin: 12px 0 0;
  color: #b42318;
  font-size: 13px;
}
.claim-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
</style>
