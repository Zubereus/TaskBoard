<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import ToggleSwitch from './ToggleSwitch.vue'

const settings = ref({ clientId: '', clientSecret: '', calendarId: 'primary' })
const status = ref({ configured: false, connected: false })
const calendars = ref([])
const connecting = ref(false)
const banner = ref(null)
const copiedFirewallCommand = ref(false)
let copiedFirewallTimer = null

async function load() {
  if (!window.api?.settings || !window.api?.calendar) return
  settings.value = await window.api.settings.get()
  status.value = await window.api.calendar.status()
  if (status.value.connected) {
    try {
      calendars.value = await window.api.calendar.listCalendars()
    } catch {
      calendars.value = []
    }
  }
}

onMounted(load)

onUnmounted(() => {
  if (copiedFirewallTimer) clearTimeout(copiedFirewallTimer)
})

const cornerWidgetEnabled = computed(() => settings.value.cornerWidgetEnabled !== false)

async function setCornerWidget(enabled) {
  const previous = settings.value.cornerWidgetEnabled
  settings.value = { ...settings.value, cornerWidgetEnabled: enabled }
  try {
    await window.api.settings.save({ cornerWidgetEnabled: enabled })
  } catch (err) {
    settings.value = { ...settings.value, cornerWidgetEnabled: previous }
    flash(err.message, true)
  }
}

function copyFirewallCommand() {
  const command = 'netsh advfirewall firewall add rule name="TaskBoard" dir=in action=allow protocol=TCP localport=22236\nnetsh advfirewall firewall add rule name="TaskBoard discovery" dir=in action=allow protocol=UDP localport=22237'
  navigator.clipboard.writeText(command).then(() => {
    copiedFirewallCommand.value = true
    if (copiedFirewallTimer) clearTimeout(copiedFirewallTimer)
    copiedFirewallTimer = setTimeout(() => {
      copiedFirewallCommand.value = false
      copiedFirewallTimer = null
    }, 2500)
    flash('Đã sao chép lệnh mở cổng tường lửa.')
  }).catch(() => {
    flash('Không thể sao chép tự động. Hãy chọn và sao chép lệnh thủ công.', true)
  })
}

function flash(msg, isError = false) {
  banner.value = { msg, isError }
  setTimeout(() => (banner.value = null), 5000)
}

async function saveCredentials() {
  await window.api.settings.save({
    clientId: (settings.value.clientId || '').trim(),
    clientSecret: (settings.value.clientSecret || '').trim()
  })
  status.value = await window.api.calendar.status()
  flash('Đã lưu thông tin Google Calendar.')
}

async function connect() {
  connecting.value = true
  try {
    await window.api.calendar.connect()
    await load()
    flash('Đã kết nối Google Calendar thành công.')
  } catch (err) {
    flash(err.message, true)
  } finally {
    connecting.value = false
  }
}

async function disconnect() {
  await window.api.calendar.disconnect()
  calendars.value = []
  await load()
  flash('Đã ngắt kết nối Google Calendar.')
}

async function saveCalendarChoice() {
  await window.api.settings.save({ calendarId: settings.value.calendarId })
  flash('Đã lưu lịch đã chọn.')
}
</script>

<template>
  <div class="help-view">
    <header class="header">
      <h1>Hướng dẫn sử dụng</h1>
    </header>

    <div v-if="banner" class="banner" :class="{ error: banner.isError }">{{ banner.msg }}</div>

    <section class="guide-card">
      <div class="section-title">
        <span class="step">01</span>
        <div>
          <h2>Báo thức và xác nhận thông báo</h2>
          <p>Nhận nhắc lại cho những công việc quan trọng.</p>
        </div>
      </div>
      <ol>
        <li>Mở hoặc sửa một công việc, đặt <strong>Ngày hết hạn</strong> và bật <strong>Báo thức lặp mỗi 1 giờ đến khi tôi xác nhận</strong>.</li>
        <li>Báo thức này <strong>chỉ bắt đầu khi công việc đến hạn</strong>: đến ngày hết hạn, hoặc đến đúng giờ hết hạn nếu bạn đã đặt giờ. Nó không phải là thông báo nhắc trước hạn.</li>
        <li>Đến hạn, TaskBoard sẽ hiện thông báo Windows; ứng dụng có thể chạy nền trong system tray.</li>
        <li>Bấm vào thông báo để mở TaskBoard và hiện hộp thoại xác nhận của công việc đó.</li>
        <li>Trong hộp thoại, bấm <strong>Hoãn 15 phút</strong> hoặc <strong>Hoãn 1 giờ</strong> để nhắc lại sau; bấm <strong>Đã nhận thông báo</strong> để dừng các lần nhắc tiếp theo. Nếu không bấm, thông báo sẽ lặp lại mỗi giờ.</li>
        <li>Để app tiếp tục chạy nền, hãy đóng cửa sổ; muốn thoát hoàn toàn, chọn <strong>Thoát</strong> từ biểu tượng TaskBoard trong system tray.</li>
      </ol>
      <div class="note">
        Muốn nhận thông báo trước hạn, hãy dùng mục <strong>Nhắc trước hạn</strong> trong biểu mẫu công việc
        và chọn số ngày trước hạn cần nhắc. Các thông báo này gửi một lần ở mỗi mốc đã chọn.
      </div>
      <div class="note">
        Nếu bấm thông báo nhưng không mở hộp thoại, hãy đảm bảo đang dùng bản `.exe` mới nhất sau khi build lại,
        không phải notification được tạo bởi phiên bản cũ.
      </div>
    </section>

    <section class="guide-card">
      <div class="section-title">
        <span class="step">02</span>
        <div>
          <h2>Đồng bộ trong mạng nội bộ</h2>
          <p>Chọn một máy làm máy chủ, các máy còn lại kết nối vào máy đó.</p>
        </div>
      </div>
      <ol>
        <li>Mở <strong>Đồng bộ LAN</strong> và bật <strong>Máy chủ</strong> trên máy lưu dữ liệu chính.</li>
        <li>Trên các máy khác, chọn <strong>Máy trạm</strong>, nhập địa chỉ IP của máy chủ rồi kết nối.</li>
        <li>Đặt tên dễ nhận biết trong mục <strong>Tên hiển thị trong mạng LAN</strong>. Tên này xuất hiện trong danh sách thiết bị và khi gửi tin nhắn; tên máy tính Windows không thay đổi.</li>
        <li>Mở mục <strong>Trò chuyện</strong> ở thanh bên để nhắn trong nhóm hoặc chọn tên thiết bị để nhắn riêng. Tin nhắn mới sẽ hiện dấu báo ở mục Trò chuyện; bấm lời nhắc trên trang <strong>Công việc</strong> để mở cuộc trò chuyện.</li>
        <li>Trong Windows Firewall, cho phép ứng dụng truy cập cổng <code>TCP 22236</code> và <code>UDP 22237</code>. Khi Windows hỏi, chọn <strong>Allow access</strong>.</li>
      </ol>
      <div class="note">
        <strong>Nếu không tìm thấy máy chủ:</strong> kiểm tra các máy đang cùng Wi-Fi/LAN,
        máy chủ vẫn đang mở, và Windows Firewall không chặn TaskBoard.
      </div>
      <details class="firewall-guide">
        <summary>Khi cần mở cổng thủ công trên Windows</summary>
        <p>
          Thông thường bạn không cần làm bước này. Khi Windows hiện hộp thoại bảo mật
          lúc bật máy chủ, hãy chọn <strong>Allow access</strong>. Nếu hộp thoại không
          xuất hiện hoặc trước đó bạn đã chọn Block, hãy làm như sau:
        </p>
        <ol>
          <li>Mở <strong>Windows Defender Firewall with Advanced Security</strong> từ menu Start.</li>
          <li>Chọn <strong>Inbound Rules</strong> → <strong>New Rule...</strong>.</li>
          <li>Chọn <strong>Port</strong> → <strong>TCP</strong> → <strong>Specific local ports</strong>, nhập <code>22236</code>.</li>
          <li>Chọn <strong>Allow the connection</strong>, giữ các profile phù hợp với mạng đang dùng, rồi đặt tên <strong>TaskBoard TCP 22236</strong>.</li>
          <li>Lặp lại các bước trên cho <strong>UDP</strong>, cổng <code>22237</code>, đặt tên <strong>TaskBoard UDP 22237</strong>.</li>
          <li>Khởi động lại TaskBoard, vào <strong>Đồng bộ LAN</strong> và bật <strong>Máy chủ</strong>.</li>
        </ol>
        <div class="command-instructions">
          <strong>Cách chạy nhanh bằng lệnh:</strong>
          <ol>
            <li>Mở menu Start, tìm <strong>Command Prompt</strong> hoặc <strong>PowerShell</strong>.</li>
            <li>Nhấp chuột phải vào ứng dụng đó, chọn <strong>Run as administrator</strong> (Chạy với quyền quản trị).</li>
            <li>Bấm nút <strong>Sao chép lệnh</strong> bên dưới, dán vào cửa sổ vừa mở và chạy <strong>từng dòng một</strong>.</li>
            <li>Nếu Windows hỏi xác nhận, chọn <strong>Yes</strong>. Sau đó mở lại TaskBoard và bật <strong>Máy chủ</strong>.</li>
          </ol>
        </div>
        <div class="command-block">
          <code>netsh advfirewall firewall add rule name="TaskBoard" dir=in action=allow protocol=TCP localport=22236<br>netsh advfirewall firewall add rule name="TaskBoard discovery" dir=in action=allow protocol=UDP localport=22237</code>
          <button class="copy-command" type="button" @click="copyFirewallCommand">
            {{ copiedFirewallCommand ? 'Đã sao chép' : 'Sao chép lệnh' }}
          </button>
        </div>
        <div class="command-explanations">
          <p><strong>Dòng 1 (TCP 22236):</strong> mở cổng để các máy khác kết nối và đồng bộ dữ liệu với máy chủ.</p>
          <p><strong>Dòng 2 (UDP 22237):</strong> mở cổng để các máy khác có thể tự động tìm thấy máy chủ khi quét mạng.</p>
          <p class="firewall-note">Nếu lệnh báo <code>Access is denied</code>, cửa sổ chưa được mở bằng quyền Administrator. Nếu công ty quản lý máy tính bằng chính sách mạng, hãy nhờ quản trị viên thực hiện.</p>
        </div>
        <p class="firewall-note">
          Chỉ mở hai cổng cho mạng nội bộ đáng tin cậy, không mở cổng ra Internet.
        </p>
      </details>
    </section>

    <section class="guide-card">
      <div class="section-title">
        <span class="step">03</span>
        <div>
          <h2>Đồng bộ Google Calendar</h2>
          <p>Kết nối một lần, sau đó thêm công việc có ngày hết hạn vào lịch.</p>
        </div>
      </div>
      <ol>
        <li>Trong Google Cloud Console, tạo dự án, bật <strong>Google Calendar API</strong>, rồi mở <strong>Google Auth Platform</strong>.</li>
        <li>Cấu hình màn hình đồng ý, chọn <strong>External</strong>, thêm tài khoản Google của bạn vào <strong>Test users</strong>.</li>
        <li>Vào <strong>Clients → Create Client</strong>, chọn loại ứng dụng <strong>Desktop app</strong>, rồi sao chép Client ID và Client Secret.</li>
        <li>Dán hai thông tin đó bên dưới, lưu lại rồi chọn <strong>Kết nối Google Calendar</strong>.</li>
        <li>Khi tạo hoặc sửa công việc, bật <strong>Thêm vào Google Calendar</strong>. Công việc phải có ngày hết hạn.</li>
      </ol>

      <div class="calendar-config">
        <label>Google Client ID</label>
        <input v-model="settings.clientId" placeholder="xxxxxxxx.apps.googleusercontent.com" />
        <label>Google Client Secret</label>
        <input v-model="settings.clientSecret" type="password" placeholder="GOCSPX-••••••••••••" />
        <div class="actions">
          <button class="btn btn-secondary" @click="saveCredentials">Lưu thông tin</button>
          <button
            class="btn btn-primary"
            :disabled="!settings.clientId || !settings.clientSecret || connecting"
            @click="connect"
          >
            {{ connecting ? 'Đang kết nối…' : (status.connected ? 'Kết nối lại' : 'Kết nối Google Calendar') }}
          </button>
          <button v-if="status.connected" class="btn btn-ghost" @click="disconnect">Ngắt kết nối</button>
        </div>
        <div class="status-row">
          <span class="pulse-dot" :class="status.connected ? 'online' : 'offline'"></span>
          {{ status.connected ? 'Đã kết nối Google Calendar' : 'Chưa kết nối Google Calendar' }}
        </div>
        <template v-if="status.connected && calendars.length">
          <label>Lịch nhận sự kiện</label>
          <select v-model="settings.calendarId" @change="saveCalendarChoice">
            <option v-for="calendar in calendars" :key="calendar.id" :value="calendar.id">
              {{ calendar.summary }}{{ calendar.primary ? ' (chính)' : '' }}
            </option>
          </select>
        </template>
      </div>
      <div class="note">
        <strong>Lưu ý:</strong> TaskBoard chỉ tạo sự kiện khi công việc có ngày hết hạn.
        Bạn có thể chọn lịch nhận sự kiện sau khi kết nối. Nếu gặp lỗi quyền truy cập,
        hãy chọn <strong>Ngắt kết nối</strong> rồi kết nối lại để cấp quyền mới.
      </div>
    </section>

    <section class="guide-card">
      <div class="section-title">
        <span class="step">04</span>
        <div>
          <h2>Làm việc hằng ngày</h2>
          <p>Các thao tác chính trong TaskBoard.</p>
        </div>
      </div>
      <ul class="tips">
        <li><strong>Công việc:</strong> tạo việc mới, đặt ngày hết hạn, giờ, độ ưu tiên và người phụ trách.</li>
        <li><strong>Nhóm:</strong> thêm thành viên để có thể giao việc và xem tiến độ theo từng người.</li>
        <li><strong>Thống kê:</strong> xem số việc đã hoàn thành theo thành viên.</li>
        <li><strong>Hoàn tác:</strong> sau khi đánh dấu hoàn thành, dùng nút Hoàn tác trong thông báo trong vòng 6 giây nếu thao tác nhầm.</li>
      </ul>
    </section>

    <section class="guide-card">
      <div class="section-title">
        <span class="step">05</span>
        <div>
          <h2>Lọc danh sách công việc</h2>
          <p>Hai nhóm bộ lọc giúp tìm đúng việc cần xem.</p>
        </div>
      </div>
      <ul class="tips">
        <li><strong>Chưa hoàn thành:</strong> chỉ hiển thị những việc chưa được đánh dấu xong.</li>
        <li><strong>Tất cả công việc:</strong> hiển thị cả việc đang làm và việc đã hoàn thành.</li>
        <li><strong>Cá nhân:</strong> chỉ hiển thị việc được lưu trên máy này; những việc này không đồng bộ qua LAN.</li>
        <li><strong>Chung:</strong> chỉ hiển thị việc được chia sẻ và đồng bộ với nhóm khi kết nối LAN.</li>
      </ul>
    </section>

    <section class="guide-card">
      <div class="section-title">
        <span class="step">06</span>
        <div>
          <h2>Công việc quá hạn</h2>
          <p>Ba cách để không bỏ sót việc khi bạn vắng mặt.</p>
        </div>
      </div>
      <ul class="tips">
        <li><strong>Bảng quá hạn:</strong> nằm ở đầu ứng dụng, giữ nguyên cho đến khi bạn hoàn thành công việc hoặc bấm <strong>Đã nhận</strong>.</li>
        <li><strong>Biểu tượng khay hệ thống:</strong> bấm một lần để xem nhanh việc quá hạn và việc hôm nay; bấm ra ngoài để đóng. Bấm đúp để mở TaskBoard.</li>
        <li><strong>Thông báo chờ bạn quay lại:</strong> khi máy không có người dùng (không di chuột hoặc gõ phím trong 10 phút, khóa màn hình hoặc ngủ), thông báo đến hạn và nhắc việc được giữ lại; báo thức cũng không kêu. Khi di chuột, gõ phím hoặc mở khóa, các thông báo đang chờ sẽ hiện trên màn hình và báo thức sẽ kêu.</li>
        <li><strong>Khi quay lại máy:</strong> sau khi vắng mặt từ 5 phút, TaskBoard tóm tắt những việc vừa quá hạn trong lúc bạn đi.</li>
      </ul>
      <div class="setting-row">
        <div>
          <strong id="corner-widget-label">Cửa sổ nhắc nhỏ ở góc màn hình</strong>
          <p id="corner-widget-hint">
            Tự hiện khi có việc mới quá hạn mà bạn chưa thấy. Không chiếm bàn phím và không ghim lên trên các ứng dụng khác.
            Bấm <strong>Ẩn</strong> để tắt cho đến khi có việc quá hạn mới. Khi tắt cài đặt này, biểu tượng khay và bảng quá hạn vẫn hoạt động.
          </p>
        </div>
        <ToggleSwitch
          :model-value="cornerWidgetEnabled"
          labelledby="corner-widget-label"
          describedby="corner-widget-hint"
          @update:model-value="setCornerWidget"
        />
      </div>
    </section>

    <section class="guide-card">
      <div class="section-title">
        <span class="step">07</span>
        <div>
          <h2>Khi có sự cố</h2>
          <p>Cách xử lý nhanh các trạng thái thường gặp.</p>
        </div>
      </div>
      <dl class="troubleshooting">
        <div>
          <dt>LAN vẫn đang kết nối</dt>
          <dd>Sau vài lần thử, TaskBoard sẽ tự dừng kết nối và chuyển về Cục bộ. Kiểm tra máy chủ rồi thử lại.</dd>
        </div>
        <div>
          <dt>Không đồng bộ được lịch</dt>
          <dd>Kiểm tra ngày hết hạn của công việc và trạng thái Google Calendar ở phần trên.</dd>
        </div>
        <div>
          <dt>Không thấy công việc mới</dt>
          <dd>Kiểm tra trạng thái LAN ở cuối thanh bên và đảm bảo các máy đang kết nối cùng một máy chủ.</dd>
        </div>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.help-view { max-width: 660px; }
.header { margin-bottom: 24px; }
h1 { margin: 0 0 4px; font-size: 25px; letter-spacing: -.03em; }
.guide-card {
  margin-bottom: 14px;
  padding: 21px 23px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}
.section-title { display: flex; gap: 12px; align-items: flex-start; }
.step {
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  padding-top: 3px;
}
h2 { margin: 0 0 3px; font-size: 15px; }
.section-title p { margin: 0; color: var(--text-dim); font-size: 12.5px; }
ol { margin: 16px 0 0 27px; padding: 0; color: var(--text-muted); font-size: 13px; }
li { padding: 4px 0; }
code {
  padding: 2px 5px;
  border-radius: 4px;
  background: var(--tag-gray-bg);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
}
.calendar-config {
  margin: 18px 0 0 27px;
  padding-top: 17px;
  border-top: 1px solid var(--border);
}
.setting-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin: 17px 0 0 27px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 13px;
}
.setting-row p {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.55;
}
.note {
  margin: 17px 0 0 27px;
  padding: 11px 13px;
  border-left: 3px solid var(--accent);
  background: var(--accent-subtle);
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.55;
}
.firewall-guide {
  margin: 18px 0 0 27px;
  padding-top: 17px;
  border-top: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 12.5px;
  line-height: 1.55;
}
.firewall-guide summary {
  cursor: pointer;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  transition: color 0.18s ease;
}
.firewall-guide summary:hover {
  color: var(--accent);
}
.firewall-guide p {
  margin: 12px 0 0;
}
.firewall-guide ol {
  margin-top: 10px;
  margin-bottom: 0;
}
.firewall-note {
  margin-top: 12px !important;
  color: var(--text-dim);
  font-size: 11.5px;
}
.command-block {
  position: relative;
  margin-top: 14px;
  padding: 12px 92px 12px 13px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #F8FAFC;
}
.command-block code {
  display: block;
  padding: 0;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  line-height: 1.65;
  white-space: normal;
}
.command-instructions {
  margin: 16px 0 0;
  padding: 12px 13px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #FFFFFF;
  color: var(--text-muted);
  font-size: 12.5px;
  line-height: 1.55;
}
.command-instructions strong {
  color: var(--text);
}
.command-instructions ol {
  margin: 8px 0 0 20px;
}
.command-instructions li {
  padding: 3px 0;
}
.command-explanations {
  margin: 12px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}
.command-explanations p {
  margin: 5px 0;
}
.command-explanations strong {
  color: var(--text);
}
.copy-command {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  transition: border-color 0.18s ease, color 0.18s ease, background 0.18s ease;
}
.copy-command:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-subtle);
}
.tips {
  margin: 16px 0 0 27px;
  padding: 0;
  color: var(--text-muted);
  font-size: 13px;
  list-style: none;
}
.tips li {
  position: relative;
  padding: 5px 0 5px 15px;
}
.tips li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 13px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
}
.troubleshooting {
  margin: 16px 0 0 27px;
  color: var(--text-muted);
  font-size: 12.5px;
}
.troubleshooting div + div {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}
.troubleshooting dt {
  color: var(--text);
  font-weight: 700;
}
.troubleshooting dd {
  margin: 3px 0 0;
  line-height: 1.5;
}
label {
  display: block;
  margin: 12px 0 5px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
}
input, select {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
}
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 15px; }
.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 15px;
  color: var(--text-muted);
  font-size: 12.5px;
}
.banner {
  margin-bottom: 14px;
  padding: 10px 14px;
  border: 1px solid rgba(16, 185, 129, .2);
  border-radius: var(--radius-sm);
  background: var(--success-subtle);
  color: var(--success-text);
  font-size: 13px;
}
.banner.error {
  border-color: rgba(239, 68, 68, .2);
  background: var(--danger-subtle);
  color: var(--danger-text);
}
</style>
