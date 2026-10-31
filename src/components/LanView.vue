<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'

const lanStatus = ref({
  mode: 'standalone',
  deviceName: '',
  localIps: [],
  primaryIp: '127.0.0.1',
  host: { isRunning: false, port: 22236, clientCount: 0, clients: [] },
  client: { connected: false, clientId: '', targetHost: '', targetPort: 22236, autoConnect: true, isDiscovering: false, clients: [] },
  discoveredHosts: []
})

const selectedMode = ref('standalone')
const hostPortInput = ref(22236)
const clientHostIpInput = ref('')
const clientHostPortInput = ref(22236)
const clientAutoConnectInput = ref(true)
const deviceNameInput = ref('')
const savedDeviceName = ref('')
const savingDeviceName = ref(false)

const banner = ref(null)
const loading = ref(false)
const copied = ref(false)
let unsubscribe = null

async function loadStatus() {
  try {
    lanStatus.value = await window.api.lan.getStatus()
    const settings = await window.api.settings.get()
    deviceNameInput.value = settings.deviceName || lanStatus.value.deviceName || ''
    savedDeviceName.value = deviceNameInput.value
    selectedMode.value = lanStatus.value.mode
    hostPortInput.value = lanStatus.value.host.port || 22236
    clientHostIpInput.value = lanStatus.value.client.targetHost || ''
    clientHostPortInput.value = lanStatus.value.client.targetPort || 22236
    clientAutoConnectInput.value = lanStatus.value.client.autoConnect !== false
  } catch (err) {
    flash('Không thể tải trạng thái mạng LAN: ' + (err.message || err), true)
  }
}

onMounted(async () => {
  if (window.api.lan.onStatusChange) {
    unsubscribe = window.api.lan.onStatusChange((status) => {
      lanStatus.value = status
    })
  }
  await loadStatus()
  // If in client mode, trigger discovery probe immediately
  if (lanStatus.value.mode === 'client') {
    triggerScan()
  }
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})

function flash(msg, isError = false) {
  banner.value = { msg, isError }
  setTimeout(() => (banner.value = null), 5000)
}

async function copyIp(ip) {
  try {
    await navigator.clipboard.writeText(ip)
    copied.value = true
    setTimeout(() => (copied.value = false), 2500)
    flash(`Đã sao chép địa chỉ IP: ${ip}`)
  } catch {
    flash('Không thể sao chép tự động. Hãy bôi đen IP để sao chép.', true)
  }
}

async function saveDeviceName() {
  const name = deviceNameInput.value.trim()
  if (!name || savingDeviceName.value) return
  savingDeviceName.value = true
  try {
    await window.api.settings.save({ deviceName: name })
    lanStatus.value = await window.api.lan.getStatus()
    deviceNameInput.value = lanStatus.value.deviceName
    savedDeviceName.value = deviceNameInput.value
    flash('Đã lưu tên hiển thị cho TaskBoard.')
  } catch (err) {
    flash('Không thể lưu tên hiển thị: ' + (err.message || err), true)
  } finally {
    savingDeviceName.value = false
  }
}

async function triggerScan() {
  try {
    await window.api.lan.discoverHosts()
  } catch {
    // ignore
  }
}

async function applyStartHost() {
  loading.value = true
  try {
    const res = await window.api.lan.startHost(hostPortInput.value)
    lanStatus.value = res
    selectedMode.value = 'host'
    flash('Máy chủ LAN đã sẵn sàng tiếp nhận kết nối.')
  } catch (err) {
    flash('Lỗi khởi chạy máy chủ: ' + (err.message || err), true)
  } finally {
    loading.value = false
  }
}

async function applyStopHost() {
  loading.value = true
  try {
    const res = await window.api.lan.stopHost()
    lanStatus.value = res
    selectedMode.value = 'standalone'
    flash('Đã dừng máy chủ LAN.')
  } catch (err) {
    flash('Lỗi dừng máy chủ: ' + (err.message || err), true)
  } finally {
    loading.value = false
  }
}

async function applyConnectClient() {
  if (!clientHostIpInput.value.trim()) {
    flash('Vui lòng nhập địa chỉ IP của máy chủ.', true)
    return
  }
  loading.value = true
  try {
    const res = await window.api.lan.startClient(
      clientHostIpInput.value.trim(),
      clientHostPortInput.value,
      clientAutoConnectInput.value
    )
    lanStatus.value = res
    selectedMode.value = 'client'
    flash(`Đang kết nối tới ${clientHostIpInput.value.trim()}...`)
  } catch (err) {
    flash('Lỗi kết nối máy chủ: ' + (err.message || err), true)
  } finally {
    loading.value = false
  }
}

async function applyDisconnectClient() {
  loading.value = true
  try {
    const res = await window.api.lan.stopClient()
    lanStatus.value = res
    selectedMode.value = 'client'
    flash('Đã ngắt kết nối với máy chủ.')
  } catch (err) {
    flash('Lỗi ngắt kết nối: ' + (err.message || err), true)
  } finally {
    loading.value = false
  }
}

async function applySetStandalone() {
  loading.value = true
  try {
    const res = await window.api.lan.setStandalone()
    lanStatus.value = res
    selectedMode.value = 'standalone'
    flash('Đã chuyển sang chế độ làm việc cục bộ.')
  } catch (err) {
    flash('Lỗi chuyển chế độ: ' + (err.message || err), true)
  } finally {
    loading.value = false
  }
}

function connectToDiscovered(host) {
  clientHostIpInput.value = host.ip
  clientHostPortInput.value = host.port
  applyConnectClient()
}

const statusBadge = computed(() => {
  if (lanStatus.value.mode === 'host') {
    return {
      text: `Máy chủ đang chạy (${lanStatus.value.host.clientCount} thiết bị kết nối)`,
      type: 'online'
    }
  }
  if (lanStatus.value.mode === 'client') {
    if (lanStatus.value.client.connected) {
      return {
        text: `Đã kết nối (${lanStatus.value.client.targetHost})`,
        type: 'online'
      }
    }
    return {
      text: `Đang kết nối (${lanStatus.value.client.targetHost || 'máy chủ'})...`,
      type: 'connecting'
    }
  }
  return {
    text: 'Cục bộ',
    type: 'offline'
  }
})
</script>

<template>
  <div class="lan-panel">
    <header class="header">
      <div>
        <h1>Đồng bộ LAN</h1>
        <p class="subtitle">
          Chia sẻ công việc với các máy tính trong cùng mạng nội bộ.
        </p>
      </div>
      <div class="status-pill" :class="statusBadge.type">
        <span class="pulse-dot" :class="statusBadge.type"></span>
        <span class="status-text">{{ statusBadge.text }}</span>
      </div>
    </header>

    <div v-if="banner" class="banner" :class="{ error: banner.isError }">{{ banner.msg }}</div>

    <section class="device-name-card">
      <div class="device-name-copy">
        <h2>Tên hiển thị trong mạng LAN</h2>
        <p>Đây là tên TaskBoard dùng trong danh sách thiết bị và trò chuyện. Tên máy tính Windows không thay đổi.</p>
      </div>
      <form class="device-name-form" @submit.prevent="saveDeviceName">
        <input
          v-model="deviceNameInput"
          maxlength="40"
          aria-label="Tên hiển thị trong mạng LAN"
          placeholder="Ví dụ: Minh - Kế toán"
          :disabled="savingDeviceName"
        />
        <button
          class="btn btn-secondary btn-sm"
          type="submit"
          :disabled="savingDeviceName || !deviceNameInput.trim() || deviceNameInput.trim() === savedDeviceName"
        >
          {{ savingDeviceName ? 'Đang lưu...' : 'Lưu tên' }}
        </button>
      </form>
    </section>

    <!-- Mode Selector -->
    <div class="mode-selector" role="tablist" aria-label="Chế độ đồng bộ LAN">
      <div
        role="tab"
        :aria-selected="selectedMode === 'host'"
        tabindex="0"
        class="mode-card"
        :class="{ active: selectedMode === 'host' }"
        @click="selectedMode = 'host'"
        @keydown.enter="selectedMode = 'host'"
        @keydown.space.prevent="selectedMode = 'host'"
      >
        <div class="mode-info">
          <h3>Máy chủ</h3>
        </div>
      </div>

      <div
        role="tab"
        :aria-selected="selectedMode === 'client'"
        tabindex="0"
        class="mode-card"
        :class="{ active: selectedMode === 'client' }"
        @click="selectedMode = 'client'"
        @keydown.enter="selectedMode = 'client'"
        @keydown.space.prevent="selectedMode = 'client'"
      >
        <div class="mode-info">
          <h3>Kết nối máy chủ</h3>
        </div>
      </div>

      <div
        role="tab"
        :aria-selected="selectedMode === 'standalone'"
        tabindex="0"
        class="mode-card"
        :class="{ active: selectedMode === 'standalone' }"
        @click="selectedMode = 'standalone'"
        @keydown.enter="selectedMode = 'standalone'"
        @keydown.space.prevent="selectedMode = 'standalone'"
      >
        <div class="mode-info">
          <h3>Dùng riêng</h3>
        </div>
      </div>
    </div>

    <Transition name="mode-content" mode="out-in">
      <!-- HOST MODE CONTENT -->
      <div v-if="selectedMode === 'host'" key="host" class="section-card">
      <div class="section-header">
        <div>
          <h2>Cấu hình máy chủ</h2>
          <p class="section-hint">Tên máy của bạn: <strong>{{ lanStatus.deviceName }}</strong></p>
        </div>
        <div class="controls">
          <button
            v-if="!lanStatus.host.isRunning"
            class="btn btn-primary"
            :disabled="loading"
            @click="applyStartHost"
          >
            {{ loading ? 'Đang bật...' : 'Bật máy chủ' }}
          </button>
          <button
            v-else
            class="btn btn-danger"
            :disabled="loading"
            @click="applyStopHost"
          >
            {{ loading ? 'Đang dừng...' : 'Dừng máy chủ' }}
          </button>
        </div>
      </div>

      <!-- IP Display Banner -->
      <div class="ip-callout">
        <div class="ip-main">
          <span class="ip-label">Địa chỉ IP kết nối của máy chủ:</span>
          <div class="ip-value-row">
            <span class="ip-number">{{ lanStatus.primaryIp }}</span>
            <span class="port-number">:{{ lanStatus.host.port || hostPortInput }}</span>
            <button class="btn btn-secondary btn-sm copy-btn" @click="copyIp(lanStatus.primaryIp)">
              {{ copied ? 'Đã sao chép' : 'Sao chép IP' }}
            </button>
          </div>
        </div>
        <p class="ip-guide">
          Cung cấp địa chỉ IP này cho các thành viên trong phòng ban nếu máy của họ không tự động tìm thấy máy chủ.
        </p>
      </div>

      <!-- Additional local IPs if multiple network cards -->
      <div v-if="lanStatus.localIps.length > 1" class="extra-ips">
        <details>
          <summary>Xem danh sách các card mạng khác ({{ lanStatus.localIps.length }})</summary>
          <div class="ip-chips">
            <div
              v-for="net in lanStatus.localIps"
              :key="net.address"
              class="ip-chip"
              :class="{ primary: net.address === lanStatus.primaryIp }"
              @click="copyIp(net.address)"
            >
              <span class="chip-name">{{ net.name }}</span>
              <span class="chip-ip">{{ net.address }}</span>
            </div>
          </div>
        </details>
      </div>

      <!-- Connected Clients Table -->
      <div class="clients-section">
        <div class="clients-header">
          <h3>Thiết bị đang kết nối ({{ lanStatus.host.clientCount }})</h3>
          <span v-if="lanStatus.host.isRunning" class="live-tag">
            <span class="pulse-dot online"></span> Đang lắng nghe phản hồi UDP
          </span>
        </div>

        <div v-if="!lanStatus.host.isRunning" class="empty-state">
          Máy chủ đang tắt. Nhấn nút "Bật máy chủ" để bắt đầu tiếp nhận kết nối.
        </div>

        <div v-else-if="lanStatus.host.clients.length === 0" class="empty-state">
          Chưa có thiết bị nào kết nối. Mở TaskBoard trên máy trạm và kết nối tới IP ở trên.
        </div>

        <table v-else class="clients-table">
          <thead>
            <tr>
              <th>Tên thiết bị</th>
              <th>Địa chỉ IP</th>
              <th>Thời gian kết nối</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="client in lanStatus.host.clients" :key="client.id">
              <td class="client-name">{{ client.name }}</td>
              <td class="client-ip font-mono">{{ client.ip }}</td>
              <td class="client-time">{{ client.connectedAt }}</td>
              <td><span class="badge-online">Đã kết nối</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      </div>

      <!-- CLIENT MODE CONTENT -->
      <div v-else-if="selectedMode === 'client'" key="client" class="section-card">
      <div class="section-header">
        <div>
          <h2>Kết nối máy chủ</h2>
          <p class="section-hint">Tự động phát hiện qua mạng nội bộ hoặc nhập IP trực tiếp.</p>
        </div>
        <button class="btn btn-secondary btn-sm" :disabled="lanStatus.client.isDiscovering" @click="triggerScan">
          {{ lanStatus.client.isDiscovering ? 'Đang quét...' : 'Quét lại mạng' }}
        </button>
      </div>

      <!-- Auto-discovered Hosts -->
      <div class="discovery-box">
        <h3>Máy chủ tìm thấy trong mạng LAN</h3>
        <div v-if="lanStatus.discoveredHosts.length === 0" class="discovery-empty">
          <span v-if="lanStatus.client.isDiscovering" class="spinner-dot"></span>
          <span>{{ lanStatus.client.isDiscovering ? 'Đang gửi tín hiệu tìm kiếm máy chủ...' : 'Không tìm thấy máy chủ nào qua quét tự động. Hãy nhập IP thủ công bên dưới.' }}</span>
        </div>
        <div v-else class="discovered-list">
          <div
            v-for="host in lanStatus.discoveredHosts"
            :key="`${host.ip}:${host.port}`"
            class="discovered-card"
          >
            <div class="discovered-info">
              <div class="host-title">{{ host.hostName }}</div>
              <div class="host-endpoint font-mono">{{ host.ip }}:{{ host.port }}</div>
            </div>
            <button
              class="btn btn-primary btn-sm"
              :disabled="loading || (lanStatus.client.connected && lanStatus.client.targetHost === host.ip)"
              @click="connectToDiscovered(host)"
            >
              {{ lanStatus.client.connected && lanStatus.client.targetHost === host.ip ? 'Đang kết nối' : 'Kết nối' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Manual Connection Form -->
      <div class="manual-form">
        <h3>Nhập IP máy chủ thủ công</h3>
        <div class="form-grid">
          <div class="field">
            <label>Địa chỉ IP máy chủ</label>
            <input
              v-model="clientHostIpInput"
              placeholder="Ví dụ: 192.168.1.3 hoặc 127.0.0.1"
              :disabled="lanStatus.client.connected"
            />
          </div>
          <div class="field field-port">
            <label>Cổng</label>
            <input
              v-model.number="clientHostPortInput"
              type="number"
              placeholder="22236"
              :disabled="lanStatus.client.connected"
            />
          </div>
        </div>

        <div class="checkbox-row">
          <label class="checkbox-label">
            <input v-model="clientAutoConnectInput" type="checkbox" />
            <span>Tự động kết nối lại khi mở ứng dụng</span>
          </label>
        </div>

        <div class="form-actions">
          <button
            v-if="!lanStatus.client.connected"
            class="btn btn-primary"
            :disabled="loading || !clientHostIpInput"
            @click="applyConnectClient"
          >
            {{ loading ? 'Đang kết nối...' : 'Kết nối máy chủ' }}
          </button>
          <button
            v-else
            class="btn btn-danger"
            :disabled="loading"
            @click="applyDisconnectClient"
          >
            {{ loading ? 'Đang ngắt...' : 'Ngắt kết nối' }}
          </button>
        </div>
      </div>
      </div>

      <!-- STANDALONE MODE CONTENT -->
      <div v-else key="standalone" class="section-card standalone-card">
      <div class="standalone-content">
        <h2>Chế độ làm việc cục bộ</h2>
        <p>
          TaskBoard đang hoạt động ngoại tuyến. Dữ liệu công việc được lưu trên máy này và không chia sẻ qua mạng nội bộ.
        </p>
        <button
          v-if="lanStatus.mode !== 'standalone'"
          class="btn btn-secondary"
          @click="applySetStandalone"
        >
          Lưu chế độ Cục bộ
        </button>
        </div>
      </div>
      </Transition>

  </div>
</template>

<style scoped>
.lan-panel {
  max-width: 760px;
  margin: 0 auto;
}

.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 22px;
}

h1 {
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 4px;
  color: var(--text);
  letter-spacing: -0.01em;
}

.subtitle {
  color: var(--text-dim);
  font-size: 13px;
  margin: 0;
  line-height: 1.4;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  background: var(--tag-gray-bg);
  color: var(--tag-gray-fg);
  border: 1px solid var(--border);
}
.status-pill.online {
  background: var(--success-subtle);
  color: var(--success-text);
  border-color: rgba(16, 185, 129, 0.25);
}
.status-pill.connecting {
  background: var(--warning-subtle);
  color: var(--warning-text);
  border-color: rgba(245, 158, 11, 0.25);
}
.status-pill.offline {
  background: transparent;
  color: var(--text-dim);
  border-color: transparent;
  padding-left: 0;
  padding-right: 0;
}

.banner {
  background: var(--success-subtle);
  color: var(--success-text);
  padding: 10px 14px;
  margin-bottom: 16px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  border: 1px solid rgba(16, 185, 129, 0.2);
}
.banner.error {
  background: var(--danger-subtle);
  color: var(--danger-text);
  border-color: rgba(239, 68, 68, 0.2);
}

/* Mode selector */
.mode-selector {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: #F0F2F5;
  border-radius: 12px;
  margin-bottom: 20px;
}

.mode-card {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  text-align: center;
  transition: background 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease, color 0.22s ease;
}
.mode-card:hover {
  color: var(--accent);
  background: rgba(255, 255, 255, 0.55);
}
.mode-card.active {
  border-color: #E3E7ED;
  background: #FFFFFF;
  box-shadow: 0 1px 4px rgba(31, 41, 55, 0.12);
}
.mode-card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.mode-info h3 {
  font-size: 13px;
  font-weight: 600;
  margin: 0;
  color: var(--text);
}

.mode-content-enter-active,
.mode-content-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.mode-content-enter-from,
.mode-content-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

/* Section Card */
.device-name-card {
  margin-bottom: 16px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--panel);
  box-shadow: var(--shadow-card);
}
.device-name-copy h2 {
  margin: 0 0 3px;
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
}
.device-name-copy p {
  margin: 0;
  color: var(--text-dim);
  font-size: 11.5px;
}
.device-name-form {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.device-name-form input {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #FFFFFF;
}
.section-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 22px;
  box-shadow: var(--shadow-card);
  margin-bottom: 18px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}
.section-header h2 {
  font-size: 16px;
  font-weight: 700;
  margin: 0 0 2px;
}
.section-hint {
  font-size: 12px;
  color: var(--text-dim);
  margin: 0;
}

/* IP Callout */
.ip-callout {
  background: #F8FAFC;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 14px 16px;
  margin-bottom: 16px;
}
.ip-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ip-label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.ip-value-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.ip-number {
  font-family: var(--font-mono);
  font-size: 20px;
  font-weight: 700;
  color: var(--accent);
}
.port-number {
  font-family: var(--font-mono);
  font-size: 20px;
  font-weight: 600;
  color: var(--text-dim);
}
.copy-btn {
  margin-left: 10px;
}
.ip-guide {
  font-size: 12px;
  color: var(--text-muted);
  margin: 8px 0 0;
  line-height: 1.45;
}

.extra-ips {
  margin-bottom: 16px;
  font-size: 12px;
}
.extra-ips summary {
  color: var(--accent);
  cursor: pointer;
  font-weight: 500;
}
.ip-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.ip-chip {
  background: #FFFFFF;
  border: 1px solid var(--border);
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  gap: 6px;
  font-size: 12px;
}
.ip-chip.primary {
  border-color: var(--accent);
  background: var(--accent-subtle);
}
.chip-name { color: var(--text-dim); }
.chip-ip { font-family: var(--font-mono); font-weight: 600; }

/* Clients table */
.clients-section {
  margin-top: 18px;
}
.clients-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.clients-header h3 {
  font-size: 14px;
  font-weight: 700;
  margin: 0;
}
.live-tag {
  font-size: 12px;
  color: var(--success-text);
  display: flex;
  align-items: center;
  gap: 6px;
}

.clients-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.clients-table th {
  text-align: left;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}
.clients-table td {
  padding: 9px 12px;
  border-bottom: 1px solid #F1F5F9;
}
.client-name { font-weight: 600; color: var(--text); }
.client-ip { color: var(--text-dim); }
.client-time { color: var(--text-light); font-size: 12px; }
.badge-online {
  background: var(--success-subtle);
  color: var(--success-text);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}

.empty-state {
  text-align: center;
  padding: 24px 16px;
  color: var(--text-dim);
  font-size: 12.5px;
  background: #F8FAFC;
  border-radius: var(--radius-sm);
  border: 1px dashed var(--border);
}

/* Discovery box */
.discovery-box {
  background: #F8FAFC;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 14px 16px;
  margin-bottom: 18px;
}
.discovery-box h3 {
  font-size: 13px;
  font-weight: 700;
  margin: 0 0 8px;
}
.discovery-empty {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text-dim);
  padding: 6px 0;
}
.spinner-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulseAnim 1.4s infinite;
}
.discovered-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.discovered-card {
  background: #FFFFFF;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.host-title { font-weight: 600; font-size: 13.5px; color: var(--text); }
.host-endpoint { font-size: 12px; color: var(--accent); margin-top: 1px; }

/* Manual Form */
.manual-form h3 {
  font-size: 13.5px;
  font-weight: 700;
  margin: 0 0 10px;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 110px;
  gap: 12px;
  margin-bottom: 10px;
}
.field label {
  display: block;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-dim);
  margin-bottom: 5px;
}
.field input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #FFFFFF;
}
.checkbox-row {
  margin: 6px 0 14px;
}
.checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-muted);
  cursor: pointer;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

/* Standalone Card */
.standalone-content {
  text-align: center;
  padding: 24px 16px;
}
.standalone-content h2 { font-size: 16px; margin: 0 0 6px; }
.standalone-content p { color: var(--text-muted); font-size: 13px; max-width: 480px; margin: 0 auto 14px; line-height: 1.5; }

/* Troubleshoot Box */
.troubleshoot-box {
  background: #F8FAFC;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 14px 18px;
  font-size: 12px;
  color: var(--text-dim);
}
.troubleshoot-box h4 {
  margin: 0 0 6px;
  font-size: 12.5px;
  color: var(--text-muted);
}
.troubleshoot-box ul {
  margin: 0;
  padding-left: 18px;
  line-height: 1.6;
}
.troubleshoot-box code {
  background: #E2E8F0;
  padding: 1px 4px;
  border-radius: 4px;
  font-family: var(--font-mono);
}

.font-mono { font-family: var(--font-mono); }
</style>
