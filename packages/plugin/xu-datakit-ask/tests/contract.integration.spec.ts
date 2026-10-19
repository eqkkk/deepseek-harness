/**
 * Contract coverage for the four ask tools. The suite boots the real plugin
 * and registry, and substitutes only `fetch`.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readdirSync as readdirSyncSync, readFileSync as readFileSyncSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import {
  CredentialProvider,
  type CredentialInfo,
  type CredentialKey,
  type CredentialRecord,
  type CredentialRecordEntry,
  type CredentialRecordInfo,
  type CredentialRef,
  type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult, type ToolResult } from '@deepseek-ai/dsh-tools'
import { resolveAskConfig, resolveBaseUrl } from '../src/config.ts'
import { predicatesOf } from '../src/ledger.ts'
import { applyDefaults, parseArgs } from '../src/schema.ts'
import * as invariant from '../src/invariant.ts'
import * as plugin from '../src/index.ts'

const TOKEN = 'sekret-token-value'
const ORIGINAL_BASE = process.env.XU_DATAKIT_BASE_URL
const ORIGINAL_TOKEN = process.env.XU_DATAKIT_TOKEN
const originalFetch = globalThis.fetch

interface SeenCall {
  method: string
  url: string
  headers: Headers
  body?: unknown
  redirect?: RequestRedirect
}

type Fault = 'none' | 'redirect' | 'network' | 'string' | 'hang'
let fault: Fault = 'none'
let credentialMode: 'missing' | 'blank' | 'set' = 'set'
const calls: SeenCall[] = []
let respond: (call: SeenCall) => { status?: number; text: string } = () => ({ text: envelope([]) })
const contexts: Context[] = []
const tempRoots: string[] = []

class FakeCredentials extends CredentialProvider {
  resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    if (credentialMode === 'missing' || ref !== 'XU_DATAKIT_TOKEN') return Promise.resolve(undefined)
    if (credentialMode === 'blank') return Promise.resolve({ value: '', source: 'file' })
    return Promise.resolve({ value: TOKEN, source: 'file' })
  }

  describe(): Promise<CredentialInfo> {
    return Promise.resolve({ configured: credentialMode === 'set', writable: true })
  }

  set(): Promise<void> {
    return Promise.resolve()
  }

  unset(): Promise<void> {
    return Promise.resolve()
  }

  readRecord(): Promise<CredentialRecord | undefined> {
    return Promise.resolve(undefined)
  }

  describeRecord(): Promise<CredentialRecordInfo> {
    return Promise.resolve({ configured: false, writable: true })
  }

  listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([])
  }

  modifyRecord(
    _key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    return mutate(undefined)
  }

  deleteRecord(): Promise<void> {
    return Promise.resolve()
  }
}

function envelope(data: unknown, message?: string): string {
  return JSON.stringify({
    success: true,
    ...message === undefined ? {} : { message },
    data,
  })
}

function restoreEnv(): void {
  if (ORIGINAL_BASE === undefined) delete process.env.XU_DATAKIT_BASE_URL
  else process.env.XU_DATAKIT_BASE_URL = ORIGINAL_BASE
  if (ORIGINAL_TOKEN === undefined) delete process.env.XU_DATAKIT_TOKEN
  else process.env.XU_DATAKIT_TOKEN = ORIGINAL_TOKEN
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function installFetch(): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (fault === 'redirect') throw new Error('unexpected redirect')
    if (fault === 'network') throw new Error('ECONNREFUSED')
    if (fault === 'string') throw 'boom'
    const headers = new Headers(init?.headers)
    const raw = init?.body
    const body = typeof raw === 'string' ? JSON.parse(raw) as unknown : undefined
    const call: SeenCall = {
      method: init?.method ?? 'GET',
      url: requestUrl(input),
      headers,
      ...body === undefined ? {} : { body },
      redirect: init?.redirect,
    }
    calls.push(call)
    if (fault === 'hang') {
      await new Promise<void>((_resolve, reject) => {
        const signal = init?.signal
        const fail = (): void => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        }
        if (signal?.aborted === true) fail()
        else signal?.addEventListener('abort', fail, { once: true })
      })
    }
    const result = respond(call)
    return new Response(result.text, { status: result.status ?? 200 })
  })
}

async function mount(config: plugin.Config = {}, options?: { credentials?: boolean }): Promise<Context> {
  fault = 'none'
  calls.length = 0
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (options?.credentials === true) await ctx.plugin(FakeCredentials)
  await ctx.plugin(plugin, config)
  return ctx
}

let callNumber = 0
function call(
  ctx: Context,
  name: string,
  args: unknown,
  extras?: { signal?: AbortSignal; agentId?: string },
): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    signal: extras?.signal ?? new AbortController().signal,
    callId: CallId(`ask-${++callNumber}`),
    name,
    arguments: args,
    ...extras?.agentId === undefined ? {} : { agent: { id: extras.agentId } as never },
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

function succeeded(result: ToolExecutionResult): unknown {
  expect(result.isError, text(result)).toBe(false)
  return result.isError ? undefined : result.value
}

afterEach(async () => {
  globalThis.fetch = originalFetch
  fault = 'none'
  credentialMode = 'set'
  respond = () => ({ text: envelope([]) })
  restoreEnv()
  while (contexts.length > 0) await contexts.pop()?.fiber.dispose()
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  }
})

describe('xu-datakit ask contract', () => {
  it('registers four tools whose parameters match the ask spec and has no default export', async () => {
    installFetch()
    const ctx = await mount({ baseUrl: 'http://datakit.test', sampleDomain: 'net' })
    expect(Object.hasOwn(plugin, 'default')).toBe(false)
    const schemas = ctx.tools.schemas().map(schema => schema.name).sort()
    expect(schemas).toEqual(['cite', 'discover_bt', 'drilldown', 'semantic_query'])
    const discover = ctx.tools.get('discover_bt')
    const semantic = ctx.tools.get('semantic_query')
    const drill = ctx.tools.get('drilldown')
    const cite = ctx.tools.get('cite')
    expect(discover?.description).toContain('Sample domain id: net')
    expect(discover?.description).toContain('Read-only metadata; no secrets.')
    expect(semantic?.description).toContain('Never emit or execute physical SQL.')
    expect(drill?.description).toContain('One-shot detail drilldown')
    expect(cite?.description).toContain('audit citation')
    expect(discover?.parameters).toMatchObject({
      additionalProperties: false,
      required: ['domain'],
      properties: {
        domain: { type: 'string' },
        keyword: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
    })
    expect(semantic?.parameters).toMatchObject({
      required: ['businessTableId', 'metrics'],
      properties: {
        metrics: { minItems: 1 },
        limit: { minimum: 1, maximum: 500, default: 50 },
        filters: { items: { properties: { op: { enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'like', 'between'] } } } },
      },
    })
    expect(drill?.parameters).toMatchObject({
      required: ['businessTableId', 'filters'],
      properties: {
        limit: { minimum: 1, maximum: 200, default: 50 },
        offset: { minimum: 0, default: 0 },
      },
    })
    expect(cite?.parameters).toMatchObject({
      required: ['businessTableIds'],
      properties: { businessTableIds: { minItems: 1 } },
    })
    const pending = { content: [{ type: 'text' as const, text: 'shown' }], isError: false }
    expect(discover?.presentCall?.({})).toEqual({ card: 'generic', title: 'discover_bt', kind: 'search' })
    expect(semantic?.presentCall?.({})).toEqual({ card: 'generic', title: 'semantic_query', kind: 'fetch' })
    expect(drill?.presentCall?.({})).toEqual({ card: 'generic', title: 'drilldown', kind: 'fetch' })
    expect(cite?.presentCall?.({})).toEqual({ card: 'generic', title: 'cite', kind: 'other' })
    expect(discover?.presentResult?.({}, pending as ToolResult)?.card).toBe('generic')
    expect(semantic?.presentResult?.({}, pending as ToolResult)?.title).toBe('semantic_query')
    expect(drill?.presentResult?.({}, pending as ToolResult)?.title).toBe('drilldown')
    expect(cite?.presentResult?.({}, pending as ToolResult)?.title).toBe('cite')
    expect(discover?.timeoutMs).toBe(30_000)
  })

  it('discovers the sample domain through the list and detail routes', async () => {
    installFetch()
    process.env.XU_DATAKIT_TOKEN = TOKEN
    const ctx = await mount({ baseUrl: 'http://datakit.test/xu', role: 'ops', debugPlan: true, timeoutMs: 5_000 })
    respond = (call) => {
      if (call.url.includes('/business-tables?')) {
        return { text: envelope([
          1,
          { id: '', name: 'blank' },
          { id: 4, name: 'number' },
          { id: 'skip-me', name: 'other' },
          { id: 'zz-table', name: 'alpha' },
          { id: 'flow-1', name: 'Net Flow' },
          { id: 'plain', name: '' },
          { id: 'later', name: 'later' },
        ]) }
      }
      if (call.url.endsWith('/zz-table')) {
        return { text: envelope({ table: { name: 'From Detail', dimensions: ['', 'region', 1, { name: 'pop' }, { id: 'asn' }, { code: 'loss' }, { name: '' }, { foo: 1 }, null], metrics: 'nope', fields: [{ name: 'src' }] } }) }
      }
      if (call.url.endsWith('/flow-1')) {
        return { text: envelope({ table: 'x', name: 'Outer' }) }
      }
      return { text: envelope({ name: '' }) }
    }
    const listed = succeeded(await call(ctx, 'discover_bt', { domain: 'net work', keyword: 'zz', limit: 5 })) as {
      tables: { id: string; name: string; dimensions: string[]; metrics: string[]; fields: string[] }[]
    }
    expect(listed.tables).toEqual([{
      id: 'zz-table',
      name: 'From Detail',
      dimensions: ['region', 'pop', 'asn', 'loss'],
      metrics: [],
      fields: ['src'],
    }])
    expect(calls[0]?.url).toBe('http://datakit.test/xu/api/v1/business-tables?domain=net%20work')
    expect(calls[0]?.redirect).toBe('error')
    expect(calls[0]?.headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(calls[0]?.headers.get('x-datakit-role')).toBe('ops')
    expect(calls[0]?.headers.get('x-datakit-debug')).toBe('plan')
    expect(calls[0]?.headers.get('content-type')).toBeNull()
    calls.length = 0
    const blankKeyword = succeeded(await call(ctx, 'discover_bt', { domain: 'net', keyword: '   ', limit: 1 })) as { tables: { id: string }[] }
    expect(blankKeyword.tables.map(table => table.id)).toEqual(['skip-me'])
    expect(calls.filter(entry => !entry.url.includes('?'))).toHaveLength(1)
    respond = (call) => {
      if (call.url.includes('?')) return { text: envelope({ tables: [{ id: 'flow-1', name: 'Net Flow' }, 2] }) }
      return { text: envelope({ name: 'Outer', dimensions: [], metrics: [], fields: [] }) }
    }
    const byName = succeeded(await call(ctx, 'discover_bt', { domain: 'net', keyword: 'FLOW' })) as { tables: { id: string; name: string }[] }
    expect(byName.tables.map(table => table.id)).toEqual(['flow-1'])
    expect(byName.tables[0]?.name).toBe('Outer')
    calls.length = 0
    respond = (call) => {
      if (call.url.includes('?')) return { text: envelope({ items: [{ id: 'plain', name: '' }] }) }
      return { text: envelope({}) }
    }
    const fallback = succeeded(await call(ctx, 'discover_bt', { domain: 'net', keyword: 'plain' })) as { tables: { name: string; dimensions: string[] }[] }
    expect(fallback.tables[0]?.name).toBe('plain')
    expect(fallback.tables[0]?.dimensions).toEqual([])
    const missed = succeeded(await call(ctx, 'discover_bt', { domain: 'net', keyword: 'absent' })) as { tables: unknown[] }
    expect(missed.tables).toEqual([])
    expect(text(await call(ctx, 'discover_bt', { domain: 'select' }))).toContain('Rephrase the question')
    expect(text(await call(ctx, 'discover_bt', { domain: 'net', keyword: 'insert' }))).toContain('Rephrase the question')
    calls.length = 0
    expect(text(await call(ctx, 'discover_bt', { domain: 'net', extra: true }))).toContain('not allowed')
    expect(text(await call(ctx, 'discover_bt', {}))).toContain('required')
    expect(text(await call(ctx, 'discover_bt', { domain: 1 }))).toContain('must be a string')
    expect(text(await call(ctx, 'discover_bt', { domain: 'net', limit: 0 }))).toContain('must be >= 1')
    expect(text(await call(ctx, 'discover_bt', { domain: 'net', limit: 101 }))).toContain('must be <= 100')
    expect(text(await call(ctx, 'discover_bt', { domain: 'net', limit: 1.5 }))).toContain('must be an integer')
    expect(calls).toHaveLength(0)
  })

  it('reads wrapped list payloads and rejects an unusable catalog', async () => {
    installFetch()
    process.env.XU_DATAKIT_TOKEN = TOKEN
    const ctx = await mount({ baseUrl: 'http://datakit.test/' })
    respond = () => ({ text: envelope(null) })
    expect(text(await call(ctx, 'discover_bt', { domain: 'net' }))).toContain('no business-table list')
    respond = () => ({ text: envelope(1) })
    expect(text(await call(ctx, 'discover_bt', { domain: 'net' }))).toContain('no business-table list')
    respond = () => ({ text: envelope({ foo: 1 }) })
    expect(text(await call(ctx, 'discover_bt', { domain: 'net' }))).toContain('no business-table list')
    respond = call => call.url.includes('?')
      ? { text: envelope([{ id: 't1', name: 'T' }]) }
      : { text: envelope(1) }
    expect(text(await call(ctx, 'discover_bt', { domain: 'net' }))).toContain('no business-table detail')
    const rows = Array.from({ length: 21 }, (_, index) => ({ id: `t${index}`, name: `T${index}` }))
    respond = call => call.url.includes('?')
      ? { text: envelope(rows) }
      : { text: envelope({ name: 'Kept' }) }
    calls.length = 0
    const capped = succeeded(await call(ctx, 'discover_bt', { domain: 'net' })) as { tables: unknown[] }
    expect(capped.tables).toHaveLength(20)
    expect(calls.filter(call => !call.url.includes('?'))).toHaveLength(20)
    expect(calls[0]?.headers.get('x-datakit-debug')).toBeNull()
    expect(calls[0]?.headers.get('x-datakit-role')).toBe('query')
  })

  it('runs one aggregate, one drilldown, and a citation without sending a physical query', async () => {
    installFetch()
    process.env.XU_DATAKIT_TOKEN = TOKEN
    const ctx = await mount({ baseUrl: 'http://datakit.test' })
    const agentA = 'agent-a'
    respond = () => ({ text: envelope({
      queryId: 'q1',
      columns: [{ name: 'city' }],
      rows: [
        { city: 'select * from t', sql: 'select 1', n: 1, ok: true, missing: null },
        { city: 'bj' },
        { city: 'sh' },
      ],
    }) })
    const aggregateResult = await call(ctx, 'semantic_query', {
      businessTableId: 'bt-a',
      metrics: ['bytes'],
      dimensions: ['city'],
      filters: [{ field: 'loss', op: 'gt', value: 0 }],
      orderBy: [{ field: 'bytes' }],
      limit: 2,
    }, { agentId: agentA })
    expect(text(aggregateResult)).toContain('Query id: q1')
    const aggregate = succeeded(aggregateResult) as { queryId: string; rows: Record<string, unknown>[]; filters: unknown[] }
    expect(aggregate.queryId).toBe('q1')
    expect(aggregate.rows).toEqual([
      { city: '[omitted]', n: 1, ok: true, missing: null },
      { city: 'bj' },
    ])
    expect(aggregate.filters).toEqual([{ field: 'loss', op: 'gt', value: 0 }])
    const posted = calls[0]
    expect(posted?.method).toBe('POST')
    expect(posted?.url).toBe('http://datakit.test/api/v1/business-tables/bt-a/query')
    expect(posted?.headers.get('content-type')).toBe('application/json')
    expect(posted?.body).toEqual({
      metrics: ['bytes'],
      dimensions: ['city'],
      filters: [{ field: 'loss', op: 'gt', value: 0 }],
      orderBy: [{ field: 'bytes', dir: 'desc' }],
      limit: 2,
    })
    expect(JSON.stringify(posted)).not.toContain(TOKEN)
    calls.length = 0
    respond = () => ({ text: envelope({ rows: [{ city: 'bj' }], columns: [], fields: ['city'] }) })
    const drilled = succeeded(await call(ctx, 'drilldown', {
      businessTableId: 'bt-a',
      parentQueryId: 'q1',
      filters: [{ field: 'city', op: 'eq', value: 'bj', extra: true }],
      columns: ['city'],
    }, { agentId: agentA })) as { rows: unknown[]; columns: string[] }
    expect(drilled.columns).toEqual(['city'])
    expect(drilled.rows).toEqual([{ city: 'bj' }])
    expect(calls[0]?.url).toBe('http://datakit.test/api/v1/records/query')
    expect(calls[0]?.body).toMatchObject({ businessTableId: 'bt-a', parentQueryId: 'q1', limit: 50, offset: 0 })
    expect(text(await call(ctx, 'drilldown', {
      businessTableId: 'bt-a',
      filters: [{ field: 'city', op: 'eq', value: 'bj' }],
    }, { agentId: agentA }))).toContain('already returned')
    expect(calls).toHaveLength(1)
    const cited = succeeded(await call(ctx, 'cite', {
      businessTableIds: ['bt-a', 'bt-extra'],
      predicates: [{ field: 'city', op: 'eq' }, { field: 'loss', op: 'gt', value: 0 }],
      queryIds: ['q1', 'q-extra'],
      note: 'kept',
    }, { agentId: agentA })) as { businessTableIds: string[]; queryIds: string[]; columns: string[]; note: string }
    expect(cited.businessTableIds).toEqual(['bt-a', 'bt-extra'])
    expect(cited.queryIds).toEqual(['q1', 'q-extra'])
    expect(cited.columns).toEqual(['city'])
    expect(cited.note).toBe('kept')
    expect(text({ content: [{ type: 'text', text: '' }] })).toBe('')
    const rendered = text(await call(ctx, 'cite', {
      businessTableIds: ['bt-a'],
      predicates: [{ field: 'city', op: 'eq' }],
      queryIds: ['q1'],
      note: 'kept',
    }, { agentId: agentA }))
    expect(rendered).toContain('city eq')
    expect(rendered).toContain('loss gt 0')
    expect(rendered).toContain('Note: kept')
    const emptyNote = text(await call(ctx, 'cite', {
      businessTableIds: ['only-model'],
      note: '',
    }))
    expect(emptyNote).toContain('(none)')
    expect(emptyNote).not.toContain('Note:')
    const omittedNote = succeeded(await call(ctx, 'cite', {
      businessTableIds: ['only-model'],
    })) as { note?: string }
    expect(omittedNote.note).toBeUndefined()
    expect(text(await call(ctx, 'cite', {
      businessTableIds: ['only-model'],
    }))).not.toContain('Note:')
  })

  it('keeps a second agent free to drill and resets the one-shot latch after a new aggregate', async () => {
    installFetch()
    process.env.XU_DATAKIT_TOKEN = TOKEN
    const ctx = await mount({ baseUrl: 'http://datakit.test' })
    respond = () => ({ text: envelope({ id: 'q1', rows: [{ a: 1 }] }) })
    await call(ctx, 'semantic_query', { businessTableId: 'bt-a', metrics: ['bytes'] }, { agentId: 'a' })
    expect(text(await call(ctx, 'drilldown', {
      businessTableId: 'bt-a',
      parentQueryId: 'other',
      filters: [{ field: 'a', op: 'eq', value: 1 }],
    }, { agentId: 'a' }))).toContain('does not match')
    respond = () => ({ text: envelope({ rows: [1, 2] }) })
    const other = succeeded(await call(ctx, 'drilldown', {
      businessTableId: 'bt-b',
      parentQueryId: 'other',
      filters: [{ field: 'a', op: 'eq', value: 1 }],
    }, { agentId: 'b' })) as { columns: string[] }
    expect(other.columns).toEqual([])
    respond = () => ({ text: envelope({ queryId: '', id: 'q-from-id', records: [{ b: 2 }] }) })
    const again = succeeded(await call(ctx, 'semantic_query', {
      businessTableId: 'bt-a',
      metrics: ['bytes'],
      orderBy: [{ field: 'bytes', dir: 'asc' }],
      filters: [{ field: 'span', op: 'between', value: [1, 2] }],
    }, { agentId: 'a' })) as { queryId?: string }
    expect(again.queryId).toBe('q-from-id')
    calls.length = 0
    respond = () => ({ text: envelope({ queryId: 'q1', items: [{ c: 3 }], columns: [], fields: [] }) })
    await call(ctx, 'drilldown', {
      businessTableId: 'bt-b',
      parentQueryId: 'q-from-id',
      filters: [{ field: 'a', op: 'eq', value: null }],
      offset: 5,
      limit: 1,
    }, { agentId: 'a' })
    expect(calls[0]?.body).toMatchObject({ businessTableId: 'bt-b', offset: 5, limit: 1, parentQueryId: 'q-from-id' })
    respond = () => ({ text: envelope([{ z: 1 }]) })
    const bare = succeeded(await call(ctx, 'semantic_query', { businessTableId: 'bt-a', metrics: ['bytes'] }, { agentId: 'a' })) as { queryId?: string; columns: string[] }
    expect(bare.queryId).toBeUndefined()
    expect(bare.columns).toEqual(['z'])
    calls.length = 0
    respond = () => ({ text: envelope({ rows: [{ z: 1 }] }) })
    await call(ctx, 'drilldown', {
      businessTableId: 'bt-a',
      parentQueryId: 'unlinked',
      filters: [{ field: 'a', op: 'eq', value: 1 }],
    }, { agentId: 'a' })
    expect(calls[0]?.body).toMatchObject({ parentQueryId: 'unlinked' })
    expect(text(await call(ctx, 'semantic_query', { businessTableId: 'select', metrics: ['bytes'] }))).toContain('Rephrase the question')
    expect(text(await call(ctx, 'semantic_query', { businessTableId: 'bt-a', metrics: ['select'] }))).toContain('Rephrase the question')
    expect(text(await call(ctx, 'semantic_query', { businessTableId: 'bt-a' }))).toContain('required')
    expect(text(await call(ctx, 'semantic_query', { businessTableId: 'bt-a', metrics: [] }))).toContain('at least 1')
    expect(text(await call(ctx, 'semantic_query', { businessTableId: 'bt-a', metrics: 'bytes' }))).toContain('must be an array')
    expect(text(await call(ctx, 'semantic_query', { businessTableId: 'bt-a', metrics: ['bytes'], filters: [{ field: 'a', op: 'nope', value: 1 }] }))).toContain('must be one of')
    expect(text(await call(ctx, 'semantic_query', { businessTableId: 'bt-a', metrics: ['bytes'], limit: 501 }))).toContain('must be <= 500')
    expect(text(await call(ctx, 'drilldown', { businessTableId: 'bt-a' }))).toContain('required')
    expect(text(await call(ctx, 'cite', {}))).toContain('required')
    expect(text(await call(ctx, 'cite', { businessTableIds: [] }))).toContain('at least 1')
    expect(text(await call(ctx, 'cite', { businessTableIds: [1] }))).toContain('must be a string')
  })

  it('normalizes alternate row envelopes and refuses an empty result', async () => {
    installFetch()
    process.env.XU_DATAKIT_TOKEN = TOKEN
    const ctx = await mount({ baseUrl: 'http://datakit.test' })
    respond = () => ({ text: envelope({ records: [{ a: 1 }], fields: [{ name: 'a' }] }) })
    const fromFields = succeeded(await call(ctx, 'semantic_query', { businessTableId: 'bt-a', metrics: ['bytes'] })) as { columns: string[] }
    expect(fromFields.columns).toEqual(['a'])
    respond = () => ({ text: envelope({ rows: [{ a: 1 }], columns: [], fields: ['f'] }) })
    const fromNamedFields = succeeded(await call(ctx, 'semantic_query', { businessTableId: 'bt-a', metrics: ['bytes'] })) as { columns: string[] }
    expect(fromNamedFields.columns).toEqual(['f'])
    respond = () => ({ text: envelope({ items: [{ a: 1 }] }) })
    const fromItems = succeeded(await call(ctx, 'drilldown', {
      businessTableId: 'bt-a',
      filters: [{ field: 'a', op: 'in', value: ['a'] }],
    })) as { columns: string[] }
    expect(fromItems.columns).toEqual(['a'])
    respond = () => ({ text: envelope({ id: '', rows: [] }) })
    const noId = succeeded(await call(ctx, 'semantic_query', { businessTableId: 'bt-a', metrics: ['bytes'] })) as { queryId?: string }
    expect(noId.queryId).toBeUndefined()
    expect(text(await call(ctx, 'semantic_query', { businessTableId: 'bt-a', metrics: ['bytes'] }))).not.toContain('Query id:')
    respond = () => ({ text: envelope(4) })
    expect(text(await call(ctx, 'semantic_query', { businessTableId: 'bt-a', metrics: ['bytes'] }))).toContain('no query result')
    respond = () => ({ text: envelope({ columns: 'city' }) })
    expect(text(await call(ctx, 'semantic_query', { businessTableId: 'bt-a', metrics: ['bytes'] }))).toContain('no rows')
    respond = () => ({ text: envelope([1, 2]) })
    const bareRows = succeeded(await call(ctx, 'semantic_query', { businessTableId: 'bt-a', metrics: ['bytes'], dimensions: ['city'] })) as { columns: string[] }
    expect(bareRows.columns).toEqual([])
  })

  it('maps transport failures to rewrite suggestions and never echoes the credential', async () => {
    installFetch()
    process.env.XU_DATAKIT_TOKEN = TOKEN
    const ctx = await mount({ baseUrl: 'http://datakit.test', maxResponseBytes: 32 })
    respond = () => ({ text: `${envelope([])}padding-padding-padding` })
    expect(text(await call(ctx, 'discover_bt', { domain: 'net' }))).toContain('exceeded the configured size')
    const wide = await mount({ baseUrl: 'http://datakit.test' })
    respond = () => ({ status: 200, text: 'not-json' })
    expect(text(await call(wide, 'discover_bt', { domain: 'net' }))).toContain('unreadable response')
    respond = () => ({ status: 500, text: 'not-json' })
    expect(text(await call(wide, 'discover_bt', { domain: 'net' }))).toContain('rejected the request')
    respond = () => ({ status: 401, text: JSON.stringify({ success: false, message: `denied ${TOKEN}` }) })
    const denied = text(await call(wide, 'discover_bt', { domain: 'net' }))
    expect(denied).toContain('[redacted]')
    expect(denied).not.toContain(TOKEN)
    respond = () => ({ status: 400, text: JSON.stringify({ success: false, message: 'select * from secret' }) })
    expect(text(await call(wide, 'discover_bt', { domain: 'net' }))).not.toContain('select')
    respond = () => ({ status: 400, text: JSON.stringify({ success: false, message: 'x'.repeat(241) }) })
    expect(text(await call(wide, 'discover_bt', { domain: 'net' }))).toContain('could not answer.')
    respond = () => ({ status: 400, text: JSON.stringify({ success: false, message: '   ' }) })
    expect(text(await call(wide, 'discover_bt', { domain: 'net' }))).toContain('could not answer.')
    respond = () => ({ status: 400, text: JSON.stringify({ success: false, message: 5 }) })
    expect(text(await call(wide, 'discover_bt', { domain: 'net' }))).toContain('could not answer.')
    respond = () => ({ status: 200, text: JSON.stringify({ success: true }) })
    expect(text(await call(wide, 'discover_bt', { domain: 'net' }))).toContain('no data')
    respond = () => ({ status: 500, text: JSON.stringify({ success: true, data: [] }) })
    expect(text(await call(wide, 'discover_bt', { domain: 'net' }))).toContain('could not answer.')
    respond = () => ({ status: 200, text: JSON.stringify(['no']) })
    expect(text(await call(wide, 'discover_bt', { domain: 'net' }))).toContain('could not answer.')
    respond = () => ({ status: 400, text: JSON.stringify({ success: false, message: 'unknown table' }) })
    expect(text(await call(wide, 'discover_bt', { domain: 'net' }))).toContain('unknown table')
    fault = 'redirect'
    expect(text(await call(wide, 'discover_bt', { domain: 'net' }))).toContain('redirected')
    fault = 'network'
    expect(text(await call(wide, 'discover_bt', { domain: 'net' }))).toContain('could not be reached')
    fault = 'string'
    expect(text(await call(wide, 'discover_bt', { domain: 'net' }))).toContain('could not be reached')
    fault = 'none'
    const missingBase = await mount({})
    expect(text(await call(missingBase, 'discover_bt', { domain: 'net' }))).toContain('XU_DATAKIT_BASE_URL is not set')
    const badBase = await mount({ baseUrl: 'not a url' })
    expect(text(await call(badBase, 'discover_bt', { domain: 'net' }))).toContain('not a valid URL')
    delete process.env.XU_DATAKIT_TOKEN
    const missingToken = await mount({ baseUrl: 'http://datakit.test' })
    expect(text(await call(missingToken, 'discover_bt', { domain: 'net' }))).toContain('XU_DATAKIT_TOKEN is not set')
    process.env.XU_DATAKIT_TOKEN = '   '
    expect(text(await call(missingToken, 'discover_bt', { domain: 'net' }))).toContain('XU_DATAKIT_TOKEN is not set')
    process.env.XU_DATAKIT_BASE_URL = 'http://from-env.test'
    process.env.XU_DATAKIT_TOKEN = TOKEN
    const fromEnv = await mount({ baseUrl: '   ' })
    respond = () => ({ text: envelope([]) })
    await call(fromEnv, 'discover_bt', { domain: 'net' })
    expect(calls.at(-1)?.url).toContain('http://from-env.test/api/v1/business-tables')
    const prefixed = await mount({ baseUrl: 'http://datakit.test/xu' })
    await call(prefixed, 'discover_bt', { domain: 'net' })
    expect(calls.at(-1)?.url).toBe('http://datakit.test/xu/api/v1/business-tables?domain=net')
  })

  it('treats a mounted credential service as the only token source', async () => {
    installFetch()
    process.env.XU_DATAKIT_BASE_URL = 'http://datakit.test'
    process.env.XU_DATAKIT_TOKEN = TOKEN
    credentialMode = 'missing'
    const missing = await mount({}, { credentials: true })
    expect(text(await call(missing, 'discover_bt', { domain: 'net' }))).toContain('XU_DATAKIT_TOKEN is not set')
    expect(calls).toHaveLength(0)
    credentialMode = 'blank'
    const blank = await mount({ baseUrl: 'http://datakit.test' }, { credentials: true })
    expect(text(await call(blank, 'discover_bt', { domain: 'net' }))).toContain('XU_DATAKIT_TOKEN is not set')
    credentialMode = 'set'
    delete process.env.XU_DATAKIT_TOKEN
    const set = await mount({ baseUrl: 'http://datakit.test' }, { credentials: true })
    respond = () => ({ text: envelope([]) })
    await call(set, 'discover_bt', { domain: 'net' })
    expect(calls.at(-1)?.headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(JSON.stringify(succeeded(await call(set, 'discover_bt', { domain: 'net' })))).not.toContain(TOKEN)
  })

  it('aborts an in-flight platform call with the caller signal', async () => {
    installFetch()
    process.env.XU_DATAKIT_TOKEN = TOKEN
    const ctx = await mount({ baseUrl: 'http://datakit.test' })
    fault = 'hang'
    const controller = new AbortController()
    const pending = call(ctx, 'discover_bt', { domain: 'net' }, { signal: controller.signal })
    await viWaitForCall()
    controller.abort()
    const result = await pending
    expect(result.isError).toBe(true)
    expect(text(result)).not.toContain(TOKEN)
  })

  it('drops its tools when the contributing fiber is disposed', async () => {
    installFetch()
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(plugin, { baseUrl: 'http://datakit.test' })
    expect(ctx.tools.get('cite')).toBeDefined()
    await fiber.dispose()
    expect(ctx.tools.get('cite')).toBeUndefined()
    expect(ctx.tools.get('discover_bt')).toBeUndefined()
  })

  it('loads through a cordis.yml and fails closed on bad config', async () => {
    installFetch()
    process.env.XU_DATAKIT_TOKEN = TOKEN
    respond = () => ({ text: envelope([]) })
    const ctx = await boot(['    baseUrl: http://datakit.test', '    sampleDomain: net', '    debugPlan: false'])
    expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual(['cite', 'discover_bt', 'drilldown', 'semantic_query'])
    const result = await call(ctx, 'discover_bt', { domain: 'net' })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('domain net')
    await expect(boot(['    role: nope'])).rejects.toThrow()
    await expect(boot(['    tokenRef: bad-name'])).rejects.toThrow(/credential reference name/)
    await expect(boot(['    timeoutMs: 0'])).rejects.toThrow(/timeoutMs/)
    await expect(boot(['    sampleDomain: "   "'])).rejects.toThrow(/sampleDomain/)
    await expect(boot(['    maxResponseBytes: 1.5'])).rejects.toThrow(/maxResponseBytes/)
  })

  it('registers the invariant companion', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(invariant)
    expect(invariant.name).toBe('xu-datakit-ask-invariant')
    expect(invariant.inject).toEqual(['invariants'])
  })

  it('rejects self-contained config and argument nodes the four tools do not use', () => {
    expect(resolveAskConfig({}).tokenRef).toBe('XU_DATAKIT_TOKEN')
    expect(resolveAskConfig({}).role).toBe('query')
    expect(resolveAskConfig({}).sampleDomain).toBe('net')
    expect(resolveAskConfig({}).debugPlan).toBe(false)
    expect(resolveAskConfig({ baseUrl: '  ' }).baseUrl).toBeUndefined()
    expect(resolveAskConfig({ baseUrl: ' http://datakit.test ' }).baseUrl).toBe('http://datakit.test')
    expect(resolveAskConfig({ role: 'admin', debugPlan: true, tokenRef: 'QUERY_TOKEN', sampleDomain: ' net ' }).role).toBe('admin')
    expect(() => resolveAskConfig({ role: 'editor' })).toThrow(/role/)
    expect(() => resolveAskConfig({ tokenRef: '   ' })).toThrow(/tokenRef must name/)
    expect(() => resolveAskConfig({ tokenRef: 'bad-name' })).toThrow(/credential reference name/)
    expect(() => resolveAskConfig({ sampleDomain: '   ' })).toThrow(/sampleDomain/)
    expect(() => resolveAskConfig({ timeoutMs: 1.5 })).toThrow(/timeoutMs/)
    expect(() => resolveAskConfig({ timeoutMs: 0 })).toThrow(/timeoutMs/)
    expect(() => resolveAskConfig({ maxResponseBytes: 0 })).toThrow(/maxResponseBytes/)
    expect(resolveBaseUrl(' http://a ', 'http://b')).toBe('http://a')
    expect(resolveBaseUrl('   ', ' http://b ')).toBe('http://b')
    expect(resolveBaseUrl(undefined, undefined)).toBeUndefined()
    expect(resolveBaseUrl('', '')).toBeUndefined()
    expect(resolveBaseUrl(undefined, '   ')).toBeUndefined()
    expect(parseArgs({ type: 'object', properties: { n: { type: 'integer' } } }, { n: 3 }, 't')).toEqual({ n: 3 })
    expect(parseArgs({ type: 'object' }, { extra: 1 }, 't')).toEqual({ extra: 1 })
    expect(() => parseArgs({ type: 'object', additionalProperties: false, properties: {}, required: [] }, [], 't')).toThrow(/must be an object/)
    expect(parseArgs({ type: 'array' }, [1, 'x'], 't')).toEqual([1, 'x'])
    expect(applyDefaults({ type: 'array' }, [1])).toEqual([1])
    expect(applyDefaults({ type: 'array', items: { type: 'string' } }, 'nope')).toBe('nope')
    expect(applyDefaults({ type: 'object', properties: { a: { type: 'string', default: 'z' } } }, [])).toEqual([])
    expect(applyDefaults({ type: 'object', properties: { a: { type: 'string' } } }, {})).toEqual({})
    expect(() => parseArgs({ type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] }, { n: 1.5 }, 't')).toThrow(/integer/)
    expect(() => parseArgs({ type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] }, { n: '1' }, 't')).toThrow(/integer/)
    expect(() => parseArgs({ type: 'object', properties: { tag: { type: 'string' } }, required: ['tag'] }, { tag: 1 }, 't')).toThrow(/string/)
    const hole: Record<string, unknown> = { field: 'a', op: 'eq' }
    hole.value = undefined
    expect(predicatesOf([hole])).toEqual([{ field: 'a', op: 'eq' }])
    expect(predicatesOf(undefined)).toEqual([])
    expect(predicatesOf([{ field: 'a', op: 'eq', value: 1 }])).toEqual([{ field: 'a', op: 'eq', value: 1 }])
    const omitted = { field: 'a', op: 'eq' } as Record<string, unknown>
    omitted.value = undefined
    expect(() => parseArgs({
      type: 'object',
      properties: { filters: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, op: { type: 'string' }, value: {} }, required: ['field', 'op'] } } },
      required: ['filters'],
    }, { filters: [omitted] }, 'cite')).not.toThrow()
  })

  it('does not carry a physical query client in source', () => {
    const root = join(import.meta.dirname, '../src')
    const files = sourceFiles(root)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = readFileSyncSync(file, 'utf8')
      expect(source.toLowerCase()).not.toContain('jdbc')
      expect(source.toLowerCase()).not.toContain('run_sql')
    }
  })
})

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSyncSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(path))
    else if (entry.name.endsWith('.ts')) out.push(path)
  }
  return out
}

async function viWaitForCall(): Promise<void> {
  const started = Date.now()
  while (calls.length === 0) {
    if (Date.now() - started > 2_000) throw new Error('fetch was not called')
    await new Promise((resolve) => { setTimeout(resolve, 5) })
  }
}

async function boot(configLines: readonly string[]): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ask-'))
  tempRoots.push(root)
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-plugin-xu-datakit-ask'",
    ...configLines.length > 0 ? ['  config:', ...configLines] : [],
    '',
  ].join('\n'))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = `${pathToFileURL(root).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-plugin-xu-datakit-ask', plugin],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}
