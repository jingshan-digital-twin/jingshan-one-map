import { computed, inject, onBeforeUnmount, provide, shallowRef, type ComputedRef, type InjectionKey } from 'vue'

export type AssistantSelection = { id: string; title: string; detail: string; enterpriseKey?: string }
export type AssistantScope = {
  key: string
  title: string
  prompts: string[]
  selection?: AssistantSelection | null
  beforeLocate?: () => void
  answer: (question: string) => string
}

function createAssistant() {
  const launcherVisible = shallowRef(true)
  try { launcherVisible.value = localStorage.getItem('jingshan-assistant-hidden') !== 'true' } catch { /* Storage may be disabled. */ }
  function setLauncherVisible(visible: boolean) {
    launcherVisible.value = visible
    try { localStorage.setItem('jingshan-assistant-hidden', String(!visible)) } catch { /* Storage may be disabled. */ }
  }
  const source = shallowRef<ComputedRef<AssistantScope | null>>()
  const scope = computed(() => source.value?.value ?? null)
  const origin = shallowRef<HTMLElement | null>(null)
  const opened = shallowRef(false)

  function openFrom(event: Event) {
    origin.value = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
    opened.value = true
  }
  function close(restoreFocus = true) {
    opened.value = false
    if (restoreFocus && origin.value?.isConnected) origin.value.focus({ preventScroll: true })
    origin.value = null
  }
  function register(context: ComputedRef<AssistantScope | null>) {
    source.value = context
    onBeforeUnmount(() => {
      if (source.value !== context) return
      source.value = undefined
      close(false)
    })
  }
  return { scope, opened, origin, openFrom, close, register, launcherVisible, setLauncherVisible }
}

const assistantKey: InjectionKey<ReturnType<typeof createAssistant>> = Symbol('scene-assistant')
export function provideSceneAssistant() {
  const assistant = createAssistant()
  provide(assistantKey, assistant)
  return assistant
}
export function useSceneAssistant() {
  const assistant = inject(assistantKey)
  if (!assistant) throw new Error('SceneAssistant must be mounted inside the dashboard')
  return assistant
}
