import type { InjectionKey, Ref } from 'vue'
import type { Dataset } from './types'
import type { CimService } from './cim-types'

export interface EditorReferenceSetting {
  key: string
  color: string
  visible: boolean
  opacity: number
}

export const editorReferences: InjectionKey<{
  datasets: Readonly<Ref<Dataset[]>>
  services: Readonly<Ref<CimService[]>>
  selected: Ref<EditorReferenceSetting[]>
}> = Symbol('editor reference layers')
