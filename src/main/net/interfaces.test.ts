import { describe, expect, it } from 'vitest'
import {
  chooseInterface,
  isPrivateAddress,
  listCandidates,
  rankPeerAddresses,
  refreshRouteAddress,
  sameSubnet
} from './interfaces'

describe('isPrivateAddress', () => {
  it.each([
    ['10.0.0.5', true],
    ['192.168.1.26', true],
    ['172.16.0.1', true],
    ['172.29.176.1', true],
    ['172.31.255.254', true],
    ['172.32.0.1', false],
    ['169.254.98.24', true],
    ['100.64.0.1', true],
    ['127.0.0.1', true],
    ['8.8.8.8', false],
    ['203.0.113.7', false],
    ['not-an-ip', false]
  ])('%s -> %s', (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected)
  })
})

describe('chooseInterface', () => {
  /** The real adapter list from a Windows box with WSL, Bluetooth and Wi-Fi. */
  const realWorld = [
    { name: 'vEthernet (WSL (Hyper-V firewall))', address: '172.29.176.1' },
    { name: 'Bluetooth Network Connection', address: '169.254.234.139' },
    { name: 'Wi-Fi 5', address: '169.254.98.24' },
    { name: 'Ethernet', address: '192.168.1.26' },
    { name: 'Wi-Fi', address: '192.168.1.18' }
  ]

  it('prefers the interface owning the default route', () => {
    // This is the regression: the WSL adapter enumerates first, but Ethernet
    // is the one a peer can actually reach.
    expect(chooseInterface(realWorld, '192.168.1.26')).toEqual({
      name: 'Ethernet',
      address: '192.168.1.26',
      privateNetwork: true
    })
  })

  it('skips virtual adapters when the route is unknown', () => {
    const chosen = chooseInterface(realWorld, null)
    expect(chosen.name).not.toContain('WSL')
    expect(chosen.name).toBe('Bluetooth Network Connection')
  })

  it('honours the route even when it points at a virtual adapter', () => {
    // A user routing everything through Tailscale should see that address.
    const withVpn = [
      { name: 'Ethernet', address: '192.168.1.26' },
      { name: 'tailscale0', address: '100.101.102.103' }
    ]
    expect(chooseInterface(withVpn, '100.101.102.103').name).toBe('tailscale0')
  })

  it('falls back to a virtual adapter when it is the only option', () => {
    const onlyVirtual = [{ name: 'vEthernet (WSL)', address: '172.29.176.1' }]
    expect(chooseInterface(onlyVirtual, null)).toEqual({
      name: 'vEthernet (WSL)',
      address: '172.29.176.1',
      privateNetwork: true
    })
  })

  it('reports nothing when the machine has no external address', () => {
    expect(chooseInterface([], null)).toEqual({
      name: null,
      address: null,
      privateNetwork: false
    })
  })

  it('flags a public address so the UI can warn about plaintext', () => {
    const public_ = [{ name: 'Ethernet', address: '203.0.113.7' }]
    expect(chooseInterface(public_, null).privateNetwork).toBe(false)
  })

  it('ignores a stale routed address that no longer belongs to any adapter', () => {
    expect(chooseInterface(realWorld, '10.9.9.9').name).toBe('Bluetooth Network Connection')
  })
})

describe('refreshRouteAddress on this machine', () => {
  it('resolves to an address this machine actually holds', async () => {
    const routed = await refreshRouteAddress()
    const held = listCandidates().map((c) => c.address)
    // Null only when there is no default route at all (offline machine).
    if (routed === null) {
      expect(held.every((a) => a.startsWith('169.254.'))).toBe(true)
      return
    }
    expect(held).toContain(routed)
  })

  it('coalesces concurrent lookups', async () => {
    const [a, b] = await Promise.all([refreshRouteAddress(), refreshRouteAddress()])
    expect(a).toBe(b)
  })
})

describe('sameSubnet', () => {
  it('matches inside a /24', () => {
    expect(sameSubnet('192.168.1.26', '192.168.1.18', '255.255.255.0')).toBe(true)
  })
  it('rejects across /24 boundaries', () => {
    expect(sameSubnet('192.168.1.26', '192.168.2.18', '255.255.255.0')).toBe(false)
  })
  it('honours a wider mask', () => {
    expect(sameSubnet('172.29.176.1', '172.29.180.5', '255.255.240.0')).toBe(true)
    expect(sameSubnet('172.29.176.1', '172.29.200.5', '255.255.240.0')).toBe(false)
  })
  it('returns false on malformed input', () => {
    expect(sameSubnet('nope', '192.168.1.1', '255.255.255.0')).toBe(false)
  })
})

describe('rankPeerAddresses', () => {
  // The Mac's view of a Windows box that also runs WSL. Dialing the WSL address
  // from another machine cannot work; this is the bug that broke PC<->Mac pairing.
  const windowsPeer = ['172.29.176.1', '192.168.1.26', 'fe80::1%eth0']
  const macSubnets = [{ address: '192.168.1.42', netmask: '255.255.255.0' }]

  it('puts the address on our own subnet first', () => {
    expect(rankPeerAddresses(windowsPeer, macSubnets)[0]).toBe('192.168.1.26')
  })

  it('still offers the other private address as a fallback', () => {
    expect(rankPeerAddresses(windowsPeer, macSubnets)).toEqual([
      '192.168.1.26',
      '172.29.176.1'
    ])
  })

  it('drops IPv6 link-local, which cannot be dialed without a scope', () => {
    expect(rankPeerAddresses(['fe80::1', 'fe80::2%en0', '10.0.0.5'], [])).toEqual(['10.0.0.5'])
  })

  it('drops IPv4 link-local, which means DHCP failed on that interface', () => {
    expect(rankPeerAddresses(['169.254.98.24', '192.168.1.5'], [])).toEqual(['192.168.1.5'])
  })

  it('keeps a stable order when nothing is on our subnet', () => {
    expect(rankPeerAddresses(['10.1.1.1', '172.16.0.9'], [])).toEqual(['10.1.1.1', '172.16.0.9'])
  })

  it('ranks a public address below any private one', () => {
    expect(rankPeerAddresses(['203.0.113.7', '10.0.0.4'], [])).toEqual(['10.0.0.4', '203.0.113.7'])
  })

  it('de-duplicates repeated announcements', () => {
    expect(rankPeerAddresses(['10.0.0.4', '10.0.0.4'], [])).toEqual(['10.0.0.4'])
  })

  it('returns nothing when every address is unusable', () => {
    expect(rankPeerAddresses(['fe80::1', '169.254.1.1', ''], [])).toEqual([])
  })

  it('works from the Windows side too, symmetrically', () => {
    const macPeer = ['192.168.1.42', '10.211.55.2'] // second is a Parallels adapter
    const winSubnets = [
      { address: '172.29.176.1', netmask: '255.255.240.0' },
      { address: '192.168.1.26', netmask: '255.255.255.0' }
    ]
    expect(rankPeerAddresses(macPeer, winSubnets)[0]).toBe('192.168.1.42')
  })
})
