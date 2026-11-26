import { createApp } from 'vue'
import './data-platform.css'
import './portal-theme.css'
import './portal-catalog.css'
import './workspace-pages.css'
import './workspace-modules.css'
import DataCenter from './DataCenter.vue'
import WorkspaceShell from './WorkspaceShell.vue'
import WorkspaceCatalog from './WorkspaceCatalog.vue'

createApp(DataCenter, { workspaceShell: WorkspaceShell, workspaceCatalog: WorkspaceCatalog }).mount('#app')
