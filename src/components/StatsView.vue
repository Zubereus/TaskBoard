<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { vnTodayStr } from '../utils/vnDate'
import { calculateStats } from '../utils/stats'

const tasks = ref([])
const employees = ref([])
let unregisterLanSync = null

async function load() {
  tasks.value = await window.api.tasks.list()
  employees.value = await window.api.employees.list()
}

onMounted(() => {
  load()
  if (window.api?.lan?.onDataSync) {
    unregisterLanSync = window.api.lan.onDataSync(() => {
      load()
    })
  }
})

onUnmounted(() => {
  if (unregisterLanSync) unregisterLanSync()
})

const stats = computed(() => calculateStats(tasks.value, employees.value, vnTodayStr()))
const rows = computed(() => stats.value.rows)
const uniqueCompletedTasks = computed(() => stats.value.uniqueCompletedTasks)
const completedThisWeek = computed(() => stats.value.completedThisWeek)
const openTasks = computed(() => stats.value.openTasks)
const dueSoonTasks = computed(() => stats.value.dueSoonTasks)
const overdueTasks = computed(() => stats.value.overdueTasks)
const workloadRows = computed(() => [
  ...rows.value,
  {
    id: 'unassigned',
    name: 'Chưa giao',
    openAssigned: stats.value.unassignedOpenTasks,
    overdue: stats.value.unassignedOverdueTasks
  }
])
const maxOpenAssigned = computed(() => Math.max(1, ...workloadRows.value.map((r) => r.openAssigned)))
</script>

<template>
  <div>
    <header class="header">
      <h1>Thống kê</h1>
    </header>

    <p class="subtitle">Tổng quan tiến độ và khối lượng công việc của nhóm.</p>

    <div class="summary">
      <div class="summary-card">
        <span class="summary-value">{{ openTasks.length }}</span>
        <span class="summary-label">Đang thực hiện</span>
      </div>
      <div class="summary-card overdue-card">
        <span class="summary-value">{{ overdueTasks.length }}</span>
        <span class="summary-label">Quá hạn</span>
      </div>
      <div class="summary-card">
        <span class="summary-value">{{ dueSoonTasks.length }}</span>
        <span class="summary-label">Đến hạn 7 ngày tới</span>
      </div>
      <div class="summary-card">
        <span class="summary-value">{{ uniqueCompletedTasks }}</span>
        <span class="summary-label">Đã hoàn thành</span>
      </div>
      <div class="summary-card">
        <span class="summary-value">{{ completedThisWeek }}</span>
        <span class="summary-label">Đã hoàn thành tuần này</span>
      </div>
      <div class="summary-card">
        <span class="summary-value">{{ stats.unassignedOpenTasks }}</span>
        <span class="summary-label">Chưa giao</span>
      </div>
    </div>
    <div class="charts-row">
      <div class="chart">
        <h2 class="chart-title">Đang thực hiện theo người phụ trách</h2>
        <div v-for="row in workloadRows" :key="row.id" class="chart-row">
          <div class="chart-label">
            <span class="chart-name">{{ row.name }}</span>
            <span class="chart-fraction">{{ row.openAssigned }} việc · {{ row.overdue }} quá hạn</span>
          </div>
          <div
            class="bar-row"
            :aria-label="`${row.name}: ${row.openAssigned} việc đang thực hiện, ${row.overdue} quá hạn`"
          >
            <div class="bar-track workload-track">
              <div
                class="bar-fill workload-fill"
                :class="{ zero: row.openAssigned === 0 }"
                :style="{ width: (row.openAssigned / maxOpenAssigned) * 100 + '%' }"
              ></div>
              <div
                v-if="row.overdue > 0"
                class="overdue-fill"
                :style="{ width: (row.overdue / maxOpenAssigned) * 100 + '%' }"
              ></div>
            </div>
            <span class="bar-count">{{ row.openAssigned }}</span>
          </div>
        </div>
      </div>

      <div class="chart">
        <h2 class="chart-title">Tỉ lệ việc đã hoàn thành của từng người</h2>
        <div v-if="employees.length === 0" class="chart-empty">
          Chưa có thành viên nào. Thêm ở mục Nhóm để xem tỉ lệ hoàn thành theo người phụ trách.
        </div>
        <template v-else>
          <div v-for="row in rows" :key="row.id" class="chart-row">
            <div class="chart-label">
              <span class="chart-name">{{ row.name }}</span>
              <span v-if="row.completionRate !== null" class="chart-fraction">
                {{ row.completed }}/{{ row.assigned }} đã hoàn thành · {{ Math.round(row.completionRate * 100) }}%
              </span>
              <span v-else class="chart-fraction">Chưa có việc được giao</span>
            </div>
            <div class="bar-track">
              <div
                class="bar-fill completion-fill"
                :style="{ width: (row.completionRate || 0) * 100 + '%' }"
                :class="{ zero: row.completionRate === null || row.completionRate === 0 }"
              ></div>
            </div>
          </div>
        </template>
      </div>
    </div>
    <p class="chart-footnote">
      Phần màu đỏ là công việc quá hạn. Việc giao cho nhiều người được tính vào khối lượng và tỉ lệ của từng người.
    </p>
  </div>
</template>

<style scoped>
.header { margin-bottom: 6px; }
h1 { font-size: 22px; margin: 0; }
.subtitle {
  color: var(--text-dim);
  font-size: 13px;
  margin: 0 0 22px;
}
.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 26px;
}
.summary-card {
  flex: 1 1 180px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.summary-value { font-size: 26px; font-weight: 700; color: var(--accent); }
.summary-label { font-size: 12px; color: var(--text-dim); }
.stats-note {
  color: var(--text-dim);
  font-size: 11px;
  margin: -16px 0 22px;
}

.chart {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 20px 20px 8px;
}
.charts-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-start;
}
.charts-row .chart { flex: 1; min-width: 260px; }
.chart-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-dim);
  margin: 0 0 16px;
}
.chart-row { margin-bottom: 16px; }
.chart-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 5px;
  font-size: 13px;
}
.chart-name { font-weight: 600; color: var(--text); }
.chart-fraction { color: var(--text-dim); font-size: 12px; }

.bar-track {
  position: relative;
  background: var(--bg);
  border-radius: 999px;
  height: 20px;
  overflow: hidden;
}
.bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bar-row .bar-track { flex: 1; }
.bar-count {
  width: 18px;
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 700;
  text-align: right;
}
.bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  min-width: 4px;
  background: linear-gradient(90deg, #4A8DDB, #3D7DCB);
  border-radius: 999px;
  transition: width 0.3s ease;
}
.bar-fill.zero { background: var(--border); }
.workload-fill { background: linear-gradient(90deg, #E8A93A, #D78920); }
.overdue-fill {
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 1;
  border-radius: 999px;
  background: linear-gradient(90deg, #E2572B, #C93824);
  pointer-events: none;
}
.completion-fill { background: linear-gradient(90deg, #4A8DDB, #3D7DCB); }
.chart-footnote {
  color: var(--text-dim);
  font-size: 11px;
  margin: 10px 0 0;
}
.chart-empty {
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.5;
  padding: 12px 0;
}
</style>
