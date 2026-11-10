import { createApp } from 'vue'
import App from './App.vue'
import PopupApp from './PopupApp.vue'
import './style.css'

// The tray flyout and corner widget are separate Electron windows that load
// this same bundle with a hash; everything else is the normal app.
const isPopupWindow = ['#flyout', '#widget'].includes(window.location.hash)

createApp(isPopupWindow ? PopupApp : App).mount('#app')
