/**
 * The single seam between "local filesystem" and "peer over HTTP". Everything
 * above it works with `FsProvider`; nothing above it branches on node id.
 */
import { LOCAL_NODE_ID, type NodePlatform } from '@shared/types'
import { ErrorCode, OmniError } from '@shared/errors'
import { PeerProvider } from '../net/client'
import * as registry from '../net/registry'
import type { FsProvider } from './provider'
import { local } from './local'

const peerProviders = new Map<string, PeerProvider>()

export function providerFor(nodeId: string): FsProvider {
  if (nodeId === LOCAL_NODE_ID) return local

  const peer = registry.get(nodeId)
  if (peer === undefined) {
    throw new OmniError(ErrorCode.UNKNOWN_NODE, 'That machine is no longer on the network')
  }
  if (peer.state === 'incompatible') {
    throw new OmniError(
      ErrorCode.PROTOCOL,
      `${peer.name} runs an incompatible protocol version (v${peer.protocolVersion})`
    )
  }

  const cached = peerProviders.get(nodeId)
  // The platform can change if a peer is reinstalled on a different OS with the
  // same identity file, so the cache is keyed on it too.
  if (cached !== undefined && cached.platform === peer.platform) return cached
  const provider = new PeerProvider(nodeId, peer.platform)
  peerProviders.set(nodeId, provider)
  return provider
}

export function platformOf(nodeId: string): NodePlatform {
  return providerFor(nodeId).platform
}

export function forgetProvider(nodeId: string): void {
  peerProviders.delete(nodeId)
}
