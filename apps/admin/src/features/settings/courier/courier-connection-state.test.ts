import { describe, it, expect } from 'vitest'
import {
  missingCourierCredentials,
  resolveCourierConnectionState,
  REQUIRED_COURIER_CREDENTIALS,
} from './courier-connection-state'

/**
 * D2 — the card label must describe reality:
 * enabled + required credentials present → Connected
 * enabled + required credentials missing → warning label
 * disabled                            → Disabled
 *
 * Required fields come from the backend dispatch validation, so these tests
 * also pin that optional fields (Pathao storeId, Carrybee clientContext, RedX
 * username/password) do NOT block "Connected".
 */
describe('resolveCourierConnectionState', () => {
  it('reports Connected only when enabled with the courier’s required credentials', () => {
    const info = resolveCourierConnectionState({
      courier: 'steadfast',
      enabled: true,
      values: { apiKey: 'test-key', secretKey: 'test-secret' },
    })

    expect(info.state).toBe('connected')
    expect(info.label).toBe('Connected')
    expect(info.tone).toBe('success')
    expect(info.missingFields).toEqual([])
  })

  it('warns when enabled but required credentials are missing (never "Connected")', () => {
    const info = resolveCourierConnectionState({
      courier: 'steadfast',
      enabled: true,
      values: { apiKey: 'test-key', secretKey: '' },
    })

    expect(info.state).toBe('enabled-credentials-missing')
    expect(info.label).toBe('Enabled — credentials missing')
    expect(info.tone).toBe('warning')
    expect(info.missingFields).toEqual(['secretKey'])
    expect(info.missingFieldLabels).toEqual(['Secret Key'])
  })

  it('reports Disabled for a disabled courier even when credentials are present', () => {
    const info = resolveCourierConnectionState({
      courier: 'steadfast',
      enabled: false,
      values: { apiKey: 'test-key', secretKey: 'test-secret' },
    })

    expect(info.state).toBe('disabled')
    expect(info.label).toBe('Disabled')
    expect(info.tone).toBe('muted')
    expect(info.missingFields).toEqual([])
  })

  it('does not leak credential values into the label', () => {
    const info = resolveCourierConnectionState({
      courier: 'pathao',
      enabled: true,
      values: {
        clientId: 'test-key',
        clientSecret: 'dummy-token',
        username: 'test-user',
        password: 'test-pass',
      },
    })

    expect(info.label).toBe('Connected')
    expect(JSON.stringify(info)).not.toContain('dummy-token')
    expect(JSON.stringify(info)).not.toContain('test-pass')
  })

  it('requires exactly the Pathao dispatch fields — storeId is optional', () => {
    expect(REQUIRED_COURIER_CREDENTIALS['pathao']).toEqual([
      'clientId',
      'clientSecret',
      'username',
      'password',
    ])

    const info = resolveCourierConnectionState({
      courier: 'pathao',
      enabled: true,
      values: {
        clientId: 'test-key',
        clientSecret: 'dummy-token',
        username: 'test-user',
        password: 'test-pass',
        storeId: '',
      },
    })

    expect(info.state).toBe('connected')
  })

  it('reports Pathao credentials-missing listing only the empty required fields', () => {
    const info = resolveCourierConnectionState({
      courier: 'pathao',
      enabled: true,
      values: { clientId: 'test-key', clientSecret: '', username: '', password: 'test-pass' },
    })

    expect(info.state).toBe('enabled-credentials-missing')
    expect(info.missingFields).toEqual(['clientSecret', 'username'])
    expect(info.missingFieldLabels).toEqual(['Client Secret', 'Username'])
  })

  it('treats RedX as connected with only the API token (username/password are optional extras)', () => {
    const info = resolveCourierConnectionState({
      courier: 'redx',
      enabled: true,
      values: { apiKey: 'test-key', username: '', password: '' },
    })

    expect(info.state).toBe('connected')
  })

  it('requires Carrybee clientId + clientSecret only', () => {
    const connected = resolveCourierConnectionState({
      courier: 'carrybee',
      enabled: true,
      values: { clientId: 'test-key', clientSecret: 'dummy-token', clientContext: '' },
    })
    const missing = resolveCourierConnectionState({
      courier: 'carrybee',
      enabled: true,
      values: { clientId: 'test-key' },
    })

    expect(connected.state).toBe('connected')
    expect(missing.state).toBe('enabled-credentials-missing')
    expect(missing.missingFields).toEqual(['clientSecret'])
  })

  it('counts whitespace-only values as missing', () => {
    const info = resolveCourierConnectionState({
      courier: 'steadfast',
      enabled: true,
      values: { apiKey: '   ', secretKey: '\t' },
    })

    expect(info.state).toBe('enabled-credentials-missing')
    expect(info.missingFields).toEqual(['apiKey', 'secretKey'])
  })

  it('accepts a default Steadfast credential set as covering the legacy row', () => {
    const info = resolveCourierConnectionState({
      courier: 'steadfast',
      enabled: true,
      values: { apiKey: '', secretKey: '' },
      hasManagedCredentialSet: true,
    })

    expect(info.state).toBe('connected')
    // The empty legacy fields are still reported, but the label is truthful:
    // the courier can authenticate through the managed set.
    expect(info.missingFields).toEqual(['apiKey', 'secretKey'])
  })

  it('does not let a managed set mask missing Steadfast keys when the flag is false', () => {
    const info = resolveCourierConnectionState({
      courier: 'steadfast',
      enabled: true,
      values: { apiKey: '', secretKey: '' },
      hasManagedCredentialSet: false,
    })

    expect(info.state).toBe('enabled-credentials-missing')
  })

  it('returns Connected for an enabled courier without a known required-field map (forward compatible)', () => {
    const info = resolveCourierConnectionState({
      courier: 'future-courier',
      enabled: true,
      values: {},
    })

    expect(info.state).toBe('connected')
  })
})

describe('missingCourierCredentials', () => {
  it('ignores fields that are not required for the courier', () => {
    expect(
      missingCourierCredentials('redx', { apiKey: 'test-key', shopId: '' }),
    ).toEqual([])
  })

  it('returns every required field when values are absent', () => {
    expect(missingCourierCredentials('pathao', null)).toEqual([
      'clientId',
      'clientSecret',
      'username',
      'password',
    ])
  })
})
