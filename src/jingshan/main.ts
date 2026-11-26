import { createApp } from 'vue'
import App from './App.vue'
import './jingshan.css'
import './cockpit-light.css'
import './overview-reference.css'
import './industry-panels.css'
import './service-capacity.css'
import './event-scene-ui.css'

if (new URLSearchParams(location.search).get('admin') === '1') {
  location.replace('/admin/' + location.hash)
} else {
  createApp(App).mount('#app')
}
