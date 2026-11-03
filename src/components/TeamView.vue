<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

const employees = ref([])
const tasks = ref([])
const draft = ref({ name: '', role: '' })
const editingId = ref(null)
const banner = ref(null)
const deleteCandidate = ref(null)
const activePersonIds = ref(new Set())
const hostPersonId = ref('')
const isLocalHost = ref(false)
let unregisterLanSync = null
let unregisterLanStatus = null
let bannerTimer = null

async function load() {
  try {
    employees.value = await window.api.employees.list()
    tasks.value = await window.api.tasks.list()
  } catch (err) {
    flash(`Không tải được dữ liệu: ${err.message || err}`, true)
  }
}

onMounted(() => {
  load()
  if (window.api?.lan?.onDataSync) {
    unregisterLanSync = window.api.lan.onDataSync(() => {
      load()
    })
  }
  if (window.api?.lan?.onStatusChange) {
    unregisterLanStatus = window.api.lan.onStatusChange(updateActivePeople)
  }
  window.api.lan.getStatus().then(updateActivePeople).catch((err) => {
    console.error('Không tải được trạng thái thành viên:', err)
  })
})

onUnmounted(() => {
  if (unregisterLanSync) unregisterLanSync()
  if (unregisterLanStatus) unregisterLanStatus()
  if (bannerTimer) clearTimeout(bannerTimer)
})

function flash(msg, isError = false) {
  if (bannerTimer) clearTimeout(bannerTimer)
  banner.value = { msg, isError }
  bannerTimer = setTimeout(() => {
    banner.value = null
    bannerTimer = null
  }, isError ? 6000 : 4000)
}

function updateActivePeople(status) {
  isLocalHost.value = status.mode === 'host'
  hostPersonId.value = isLocalHost.value ? status.personId : status.hostPersonId || ''
  const activeIds = new Set(
    (status.mode === 'host' ? status.host.clients : status.client.clients).map((client) => client.id)
  )
  if (status.mode !== 'client' || status.client.connected) activeIds.add(status.personId)
  if (status.mode === 'client' && status.client.connected && status.hostPersonId) {
    activeIds.add(status.hostPersonId)
  }
  activePersonIds.value = activeIds
}

function isActive(employeeId) {
  return activePersonIds.value.has(employeeId)
}

const rosterSections = computed(() => {
  const host = employees.value.find((employee) => employee.id === hostPersonId.value)
  const members = employees.value.filter((employee) => employee.id !== hostPersonId.value)
  return [
    ...(host ? [{
      key: 'host',
      title: isLocalHost.value ? 'Máy chủ · Bạn' : 'Máy chủ',
      employees: [host]
    }] : []),
    ...(members.length ? [{ key: 'members', title: 'Thành viên', employees: members }] : [])
  ]
})

async function save() {
  if (!draft.value.name.trim()) {
    flash('Cần nhập tên trước khi thêm.', true)
    return
  }
  try {
    const payload = { name: draft.value.name.trim(), role: draft.value.role.trim() }
    const sameKey = (employee) =>
      employee.name.trim().toLocaleLowerCase() === payload.name.toLocaleLowerCase() &&
      (employee.role || '').trim().toLocaleLowerCase() === payload.role.toLocaleLowerCase()
    if (employees.value.some((employee) => employee.id !== editingId.value && sameKey(employee))) {
      flash('Thành viên này đã có trong nhóm.', true)
      return
    }
    if (editingId.value) {
      await window.api.employees.update(editingId.value, payload)
    } else {
      await window.api.employees.add(payload)
    }
    draft.value = { name: '', role: '' }
    editingId.value = null
    await load()
  } catch (err) {
    flash(`Không thể lưu thành viên: ${err.message || err}`, true)
  }
}

function edit(emp) {
  editingId.value = emp.id
  draft.value = { name: emp.name, role: emp.role || '' }
}
function cancelEdit() {
  editingId.value = null
  draft.value = { name: '', role: '' }
}

async function remove(emp) {
  deleteCandidate.value = emp
}

function cancelDelete() {
  deleteCandidate.value = null
}

async function confirmDelete() {
  const emp = deleteCandidate.value
  if (!emp) return
  deleteCandidate.value = null
  try {
    await window.api.employees.delete(emp.id)
    flash(`Đã xóa ${emp.name}. Các công việc của họ giờ chưa được giao.`)
    await load()
  } catch (err) {
    flash(`Không thể xóa thành viên: ${err.message || err}`, true)
  }
}

function assigneesOf(t) {
  return t.assigneeIds || (t.assigneeId ? [t.assigneeId] : [])
}

function tasksFor(employeeId) {
  return tasks.value
    .filter((t) => assigneesOf(t).includes(employeeId) && !t.done)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
}

const unassigned = computed(() => tasks.value.filter((t) => assigneesOf(t).length === 0 && !t.done))

function priorityClass(p) {
  if (p >= 50) return 'high'
  if (p >= 10) return 'mid'
  return 'low'
}
</script>

<template>
  <div>
    <header class="header"><h1>Nhóm</h1></header>
    <p class="hint">
      Thiết bị đã kết nối sẽ tự xuất hiện trong danh sách; bạn cũng có thể thêm người đang ngoại tuyến.
      Chấm xanh cho biết người đó đang kết nối.
    </p>

    <div v-if="banner" class="banner" :class="{ error: banner.isError }">{{ banner.msg }}</div>

    <div class="form-card">
      <div class="grid">
        <input v-model="draft.name" placeholder="Họ và tên" />
        <input v-model="draft.role" placeholder="Vai trò (tùy chọn)" />
      </div>
      <div class="form-actions">
        <button v-if="editingId" class="btn btn-ghost" @click="cancelEdit">Hủy</button>
        <button class="btn btn-primary" @click="save">{{ editingId ? 'Lưu thay đổi' : '+ Thêm thành viên' }}</button>
      </div>
    </div>

    <div v-if="employees.length === 0" class="empty">Chưa có thành viên nào — thêm ở trên.</div>

    <section v-for="section in rosterSections" :key="section.key" class="roster-section">
      <h2 class="section-title">{{ section.title }}</h2>
      <div class="employee-card" v-for="emp in section.employees" :key="emp.id">
        <div class="employee-header">
          <div>
            <div class="employee-name">
              <span
                class="presence-dot"
                :class="{ active: isActive(emp.id) }"
                :title="isActive(emp.id) ? 'Đang kết nối' : 'Ngoại tuyến'"
                :aria-label="isActive(emp.id) ? 'Đang kết nối' : 'Ngoại tuyến'"
              ></span>
              {{ emp.name }}
            </div>
            <div class="employee-role" v-if="emp.role">{{ emp.role }}</div>
          </div>
          <div class="employee-actions">
            <span class="task-count">{{ tasksFor(emp.id).length }} việc</span>
            <button class="btn btn-ghost small" @click="edit(emp)">Sửa</button>
            <button class="btn btn-danger small" @click="remove(emp)">Xóa</button>
          </div>
        </div>

        <ul class="task-mini-list" v-if="tasksFor(emp.id).length">
          <li v-for="t in tasksFor(emp.id)" :key="t.id">
            <span class="mini-priority" :class="priorityClass(t.priority)"></span>
            {{ t.title }}
          </li>
        </ul>
        <div class="no-tasks" v-else>Hiện chưa có việc nào được giao.</div>
      </div>
    </section>

    <template v-if="unassigned.length">
      <h2 class="section-title">Chưa giao</h2>
      <ul class="task-mini-list standalone">
        <li v-for="t in unassigned" :key="t.id">
          <span class="mini-priority" :class="priorityClass(t.priority)"></span>
          {{ t.title }}
        </li>
      </ul>
    </template>

    <div v-if="deleteCandidate" class="delete-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-member-title">
      <section class="delete-dialog">
        <div class="delete-icon" aria-hidden="true">!</div>
        <h2 id="delete-member-title">Xóa thành viên?</h2>
        <p>Bạn có chắc muốn xóa thành viên này không?</p>
        <strong>{{ deleteCandidate.name }}</strong>
        <div class="delete-actions">
          <button class="btn btn-ghost" @click="cancelDelete">Hủy</button>
          <button class="btn btn-danger" @click="confirmDelete">Xóa thành viên</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.header { margin-bottom: 6px; }
h1 { font-size: 22px; margin: 0; }
.hint { color: var(--text-dim); font-size: 13px; margin: 0 0 18px; }
.banner {
  background: #E6F4EA;
  color: #276B39;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  margin-bottom: 14px;
  font-size: 13px;
}
.banner.error { background: var(--tag-rose-bg); color: var(--tag-rose-fg); }

.form-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 16px;
  margin-bottom: 22px;
}
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.grid input {
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #FAFBFC;
}
.form-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px; }

.empty { color: var(--text-dim); padding: 20px 0; text-align: center; }

.employee-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 14px 16px;
  margin-bottom: 12px;
}
.employee-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.employee-name { display: flex; align-items: center; gap: 7px; font-weight: 700; font-size: 14.5px; }
.presence-dot { width: 8px; height: 8px; flex-shrink: 0; border-radius: 50%; background: #a3aab5; }
.presence-dot.active { background: #2ca66f; }
.employee-role { font-size: 12px; color: var(--text-dim); margin-top: 2px; }
.employee-actions { display: flex; align-items: center; gap: 8px; }
.task-count {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--accent);
  background: #EAF1FB;
  padding: 3px 9px;
  border-radius: 999px;
  white-space: nowrap;
  flex-shrink: 0;
}
.small { padding: 5px 10px; font-size: 12px; }

.task-mini-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 10px 0 0;
  border-top: 1px solid var(--border);
}
.task-mini-list.standalone {
  border-top: none;
  padding-top: 0;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 12px 16px;
}
.task-mini-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 5px 0;
}
.mini-priority {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.mini-priority.high { background: var(--pri-high); }
.mini-priority.mid { background: var(--pri-mid); }
.mini-priority.low { background: var(--pri-low); }

.no-tasks { color: var(--text-dim); font-size: 12.5px; margin-top: 10px; }
.section-title { font-size: 15px; margin: 24px 0 10px; color: var(--text-dim); }

.delete-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.42);
}
.delete-dialog {
  width: min(420px, 100%);
  padding: 26px 28px 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.24);
  text-align: center;
}
.delete-icon {
  width: 40px;
  height: 40px;
  margin: 0 auto 12px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--danger-subtle);
  color: var(--danger-text);
  font-size: 21px;
  font-weight: 800;
}
.delete-dialog h2 {
  margin: 0 0 10px;
  color: var(--text);
  font-size: 19px;
}
.delete-dialog p {
  margin: 0 0 12px;
  color: var(--text-dim);
  font-size: 13px;
}
.delete-dialog > strong {
  display: block;
  margin-bottom: 28px;
  color: var(--text);
  overflow-wrap: anywhere;
}
.delete-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
}
</style>
