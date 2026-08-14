/* eslint-disable @typescript-eslint/no-unused-vars */
import { expectTypeOf } from 'vitest'
import { Hono } from '..'
import { upgradeWebSocket } from '../adapter/deno/websocket'
import type { TypedURL } from './types'
import { hc } from '.'

describe('WebSockets', () => {
  const app = new Hono()
    .get(
      '/ws',
      upgradeWebSocket(() => ({}))
    )
    .get('/', (c) => c.json({}))
  const client = hc<typeof app>('/')

  it('WebSocket route', () => {
    expectTypeOf(client.ws).toMatchTypeOf<{
      $ws: () => WebSocket
    }>()
  })
  it('Not WebSocket Route', () => {
    expectTypeOf<
      typeof client.index extends { $ws: () => WebSocket } ? false : true
    >().toEqualTypeOf(true)
  })
})

describe('without the leading slash', () => {
  const app = new Hono()
    .get('foo', (c) => c.json({}))
    .get('foo/bar', (c) => c.json({}))
    .get('foo/:id/baz', (c) => c.json({}))
  const client = hc<typeof app, 'http://localhost'>('http://localhost')
  it('`foo` should have `$get`', () => {
    expectTypeOf(client.foo).toHaveProperty('$get')
    expectTypeOf(client.foo.$url()).toEqualTypeOf<TypedURL<'http:', 'localhost', '', '/foo', ''>>()
    expectTypeOf(client.foo.$path()).toEqualTypeOf<'/foo'>()
  })
  it('`foo.bar` should not have `$get`', () => {
    expectTypeOf(client.foo.bar).toHaveProperty('$get')
    expectTypeOf(client.foo.bar.$url()).toEqualTypeOf<
      TypedURL<'http:', 'localhost', '', '/foo/bar', ''>
    >()
    expectTypeOf(client.foo.bar.$path()).toEqualTypeOf<'/foo/bar'>()
  })
  it('`foo[":id"].baz` should have `$get`', () => {
    expectTypeOf(client.foo[':id'].baz).toHaveProperty('$get')
    expectTypeOf(client.foo[':id'].baz.$url()).toEqualTypeOf<
      TypedURL<'http:', 'localhost', '', '/foo/:id/baz', ''>
    >()
    expectTypeOf(
      client.foo[':id'].baz.$url({
        param: { id: '123' },
      })
    ).toEqualTypeOf<TypedURL<'http:', 'localhost', '', '/foo/123/baz', ''>>()
    expectTypeOf(
      client.foo[':id'].baz.$url({
        param: { id: '123' },
        query: { q: 'hono' },
      })
    ).toEqualTypeOf<TypedURL<'http:', 'localhost', '', '/foo/123/baz', `?${string}`>>()

    expectTypeOf(client.foo[':id'].baz.$path()).toEqualTypeOf<'/foo/:id/baz'>()
    expectTypeOf(
      client.foo[':id'].baz.$path({
        param: { id: '123' },
      })
    ).toEqualTypeOf<'/foo/123/baz'>()
    expectTypeOf(
      client.foo[':id'].baz.$path({
        param: { id: '123' },
        query: { q: 'hono' },
      })
    ).toEqualTypeOf<`/foo/123/baz?${string}`>()
  })
})

describe('with the leading slash', () => {
  const app = new Hono()
    .get('/foo', (c) => c.json({}))
    .get('/foo/bar', (c) => c.json({}))
    .get('/foo/:id/baz', (c) => c.json({}))
  const client = hc<typeof app>('')
  it('`foo` should have `$get`', () => {
    expectTypeOf(client.foo).toHaveProperty('$get')
  })
  it('`foo.bar` should not have `$get`', () => {
    expectTypeOf(client.foo.bar).toHaveProperty('$get')
  })
  it('`foo[":id"].baz` should have `$get`', () => {
    expectTypeOf(client.foo[':id'].baz).toHaveProperty('$get')
  })
})

describe('equivalent path spellings', () => {
  const app = new Hono()
    .get('/foo', (c) => c.json({ method: 'get' as const }))
    .post('foo', (c) => c.json({ method: 'post' as const }))
  const client = hc<typeof app>('')

  it('keeps methods from both `/foo` and `foo`', () => {
    expectTypeOf(client.foo).toHaveProperty('$get')
    expectTypeOf(client.foo).toHaveProperty('$post')
  })
})

describe('index and marker-like paths', () => {
  const nested = new Hono()
    .get('/__hono_lazy_schema_path__', (c) => c.json({ marker: true as const }))
    .get('/valueOf', (c) => c.json({ value: true as const }))
    .get('/toString', (c) => c.json({ string: true as const }))
  const app = new Hono()
    .get('/', (c) => c.json({ root: true as const }))
    .get('/index', (c) => c.json({ index: true as const }))
    .get('/__hono_lazy_schema_path__', (c) => c.json({ marker: true as const }))
    .route('/api', nested)
  const client = hc<typeof app>('')

  it('keeps the root and literal index path in the index node', () => {
    expectTypeOf(client.index).toHaveProperty('$get')
  })

  it('keeps marker-like paths in direct and nested routes', () => {
    expectTypeOf(client['__hono_lazy_schema_path__']).toHaveProperty('$get')
    expectTypeOf(client.api['__hono_lazy_schema_path__']).toHaveProperty('$get')
    expectTypeOf(client.api.valueOf).toHaveProperty('$get')
    expectTypeOf(client.api.toString).toHaveProperty('$get')
  })
})

describe('app.all()', () => {
  const app = new Hono()
    .all('/all-route', (c) => c.json({ msg: 'all methods' }))
    .get('/get-route', (c) => c.json({ msg: 'get only' }))
  const client = hc<typeof app>('http://localhost', { fetch: app.request })

  it('should NOT expose $all on the client', () => {
    expectTypeOf<
      (typeof client)['all-route'] extends { $all: unknown } ? true : false
    >().toEqualTypeOf<false>()
  })

  it('should still expose valid HTTP methods like $get', () => {
    expectTypeOf(client['get-route']).toHaveProperty('$get')
  })

  it('should expose all standard HTTP methods for routes defined with app.all()', () => {
    // $all routes should have all standard HTTP methods typed
    expectTypeOf(client['all-route']).toHaveProperty('$get')
    expectTypeOf(client['all-route']).toHaveProperty('$post')
    expectTypeOf(client['all-route']).toHaveProperty('$put')
    expectTypeOf(client['all-route']).toHaveProperty('$delete')
    expectTypeOf(client['all-route']).toHaveProperty('$options')
    expectTypeOf(client['all-route']).toHaveProperty('$patch')
    expectTypeOf(client['all-route']).toHaveProperty('$query')
  })

  it('should have correct return type for expanded methods', async () => {
    // The response type should match the original handler's return type
    const res = await client['all-route'].$get()
    expectTypeOf(res.json()).resolves.toEqualTypeOf<{ msg: string }>()
  })
})

describe('with base URL pathname', () => {
  const app = new Hono()
    .get('foo', (c) => c.json({}))
    .get('foo/bar', (c) => c.json({}))
    .get('foo/:id/baz', (c) => c.json({}))
  const client = hc<typeof app, 'http://localhost/api'>('http://localhost/api')
  it('$path', () => {
    expectTypeOf(client.foo.$path()).toEqualTypeOf<'/foo'>()
    expectTypeOf(client.foo.bar.$path()).toEqualTypeOf<'/foo/bar'>()
    expectTypeOf(
      client.foo[':id'].baz.$path({
        param: { id: '123' },
        query: { q: 'hono' },
      })
    ).toEqualTypeOf<`/foo/123/baz?${string}`>()
  })
})
