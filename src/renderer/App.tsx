import { useEffect, useState, type ReactNode } from 'react'
import { StatusBar, TitleBar, TopNav } from './components/chrome'
import { ConflictDialog } from './components/dialogs'
import { Icon } from './components/primitives'
import { Commander } from './views/Commander'
import { Discovery } from './views/Discovery'
import { Queue } from './views/Queue'
import { Settings } from './views/Settings'
import { subscribeNodes } from './state/useNodes'
import { subscribeTransfers, useTransfers } from './state/useTransfers'
import { usePanes } from './state/usePanes'
import { useSettings } from './state/useSettings'
import { useToasts, type Toast } from './state/useToasts'

export type ViewId = 'commander' | 'queue' | 'discovery' | 'settings'

export function App(): ReactNode {
  const [view, setView] = useState<ViewId>('commander')
  const conflict = useTransfers((s) => s.conflict)
  const resolve = useTransfers((s) => s.resolve)

  useEffect(() => {
    const unsubscribeNodes = subscribeNodes()
    const unsubscribeTransfers = subscribeTransfers()
    void useSettings.getState().load()
    void usePanes.getState().init()
    return () => {
      unsubscribeNodes()
      unsubscribeTransfers()
    }
  }, [])

  return (
    <div className="h-full flex flex-col bg-surface text-on-surface overflow-hidden">
      <TitleBar />
      <TopNav view={view} onNavigate={setView} />

      {/* Views stay mounted so pane state and scroll position survive a tab switch. */}
      <main className="flex-1 min-h-0 flex flex-col">
        <View active={view === 'commander'}>
          <Commander onOpenQueue={() => setView('queue')} />
        </View>
        <View active={view === 'queue'}>
          <Queue />
        </View>
        <View active={view === 'discovery'}>
          <Discovery onOpenCommander={() => setView('commander')} />
        </View>
        <View active={view === 'settings'}>
          <Settings />
        </View>
      </main>

      <StatusBar />
      <ToastRail />

      {conflict !== null && (
        <ConflictDialog prompt={conflict} onResolve={(resolution) => void resolve(resolution)} />
      )}
    </div>
  )
}

function View({ active, children }: { active: boolean; children: ReactNode }): ReactNode {
  return (
    <div hidden={!active} className={active ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
      {children}
    </div>
  )
}

const TOAST_TONE: Record<Toast['tone'], { border: string; icon: string; text: string }> = {
  error: { border: 'border-error/50', icon: 'error', text: 'text-error' },
  warning: { border: 'border-warning/50', icon: 'warning', text: 'text-warning' },
  success: { border: 'border-secondary/50', icon: 'check_circle', text: 'text-secondary' },
  info: { border: 'border-primary/50', icon: 'info', text: 'text-primary' }
}

function ToastRail(): ReactNode {
  const { toasts, dismiss } = useToasts()
  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-space-xl right-space-lg z-50 flex flex-col gap-space-sm w-[380px]">
      {toasts.map((toast) => {
        const tone = TOAST_TONE[toast.tone]
        return (
          <div
            key={toast.id}
            role="status"
            className={`flex items-start gap-space-sm bg-surface-container/95 backdrop-blur-md border ${tone.border} rounded-lg px-space-base py-space-base shadow-[0_8px_24px_-4px_rgba(0,0,0,0.65)]`}
          >
            <Icon name={tone.icon} size={16} className={`${tone.text} shrink-0 mt-space-2xs`} />
            <div className="flex-1 min-w-0">
              <p className="font-body-lg text-body-lg text-on-surface break-words">{toast.title}</p>
              {toast.detail !== undefined && (
                <p className="font-data-tabular-sm text-data-tabular-sm text-on-surface-variant mt-space-2xs break-all">
                  {toast.detail}
                </p>
              )}
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(toast.id)}
              className="text-on-surface-variant hover:text-on-surface shrink-0"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
