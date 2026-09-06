/**
 * Wires the transfer engine to the running app. Kept separate from `engine.ts`
 * so the engine itself stays free of Electron and can be tested directly.
 */
import type { NodeRef } from '@shared/types'
import { LOCAL_NODE_ID } from '@shared/types'
import { providerFor } from '../fs/resolve'
import * as registry from '../net/registry'
import { store } from '../store'
import { TransferEngine, type EngineDeps } from './engine'

const deps: EngineDeps = {
  providerFor,
  settings: () => store().settings(),
  nodeRef: (nodeId: string): NodeRef => {
    if (nodeId === LOCAL_NODE_ID) {
      const identity = store().identity()
      return { id: LOCAL_NODE_ID, name: identity.displayName, platform: identity.platform }
    }
    const peer = registry.get(nodeId)
    return {
      id: nodeId,
      name: peer?.name ?? nodeId,
      platform: peer?.platform ?? 'linux'
    }
  }
}

export const engine = new TransferEngine(deps)
export { TransferEngine, type EngineDeps } from './engine'
