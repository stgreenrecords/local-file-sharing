import { describe, expect, it } from 'vitest'
import { chooseInterface, isPrivateAddress, listCandidates, refreshRouteAddress } from './interfaces'

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
