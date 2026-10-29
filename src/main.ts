import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useSettingsStore } from './stores/settingsStore'
import { useHistoryStore } from './stores/historyStore'
import { useTaskStore } from './stores/taskStore'
import { initializeNativeSafeArea, isNativeRuntime } from './api/runtimeApi'
import { authorizeWeb, webSession } from './api/webClient'
import { useAccountStore } from './stores/accountStore'
import './style.css'

const app = createApp(App)
const pinia = createPinia()

// 保存任务事件监听的清理函数，用于在应用退出时注销监听器
let cleanupTaskListeners: (() => void) | null = null
let initialization = 0

app.use(pinia)
app.use(router)

async function init() {
    const current = ++initialization
    cleanupTaskListeners?.()
    cleanupTaskListeners = null
    // 原生安全区域只在 Tauri 环境加载，普通浏览器页面无需等待原生插件。
    try {
        await initializeNativeSafeArea()
    } catch (error) {
        console.warn('初始化安全区域失败:', error)
    }
    const settingsStore = useSettingsStore()
    const historyStore = useHistoryStore()
    const taskStore = useTaskStore()
    const accountStore = useAccountStore()

    // 先建立任务订阅，再读取快照；读取期间的事件由 store 排队回放。
    const loaded = await Promise.allSettled([
        settingsStore.loadSettings(),
        historyStore.loadHistory(),
    ])
    if (current !== initialization) return
    for (const result of loaded)
        if (result.status === 'rejected')
            console.error('加载持久化数据失败，使用默认值:', result.reason)

    // 注册任务事件监听；若注册失败，仍继续加载快照。
    try {
        // 保存清理函数，并在页面卸载时调用，避免内存泄漏
        const cleanup = await taskStore.setupListeners()
        if (current !== initialization) {
            cleanup()
            return
        }
        cleanupTaskListeners = cleanup
    } catch (e) {
        console.error('注册下载事件监听失败:', e)
    }
    if (current !== initialization) return
    // 不阻塞原生挂载或 Web 首屏；读取到用户设置后，每次授权会话只尝试一次。
    if (loaded[0].status === 'fulfilled')
        void accountStore.initialize(
            settingsStore.settings.autoRefreshLoginOnStartup,
        )
    try {
        await taskStore.loadTasks()
    } catch (e) {
        console.error('加载任务失败:', e)
    }
}

if (isNativeRuntime()) {
    // 保持原生端原有的初始化顺序，避免窗口内容先于安全区域插件挂载。
    void init().finally(() => app.mount('#app'))
} else {
    // Web 先确认认证模式，认证后再加载设置和任务投影。
    app.mount('#app')
    // 认证失败时显示对应的输入页。
    watch(
        () => webSession.authorized,
        (authorized) => {
            if (authorized) void init()
            else {
                initialization++
                cleanupTaskListeners?.()
                cleanupTaskListeners = null
                useAccountStore().reset()
            }
        },
    )
    void authorizeWeb()
}

window.addEventListener('beforeunload', () => {
    initialization++
    cleanupTaskListeners?.()
    cleanupTaskListeners = null
})
