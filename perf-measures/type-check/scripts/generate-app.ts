import { writeFileSync } from 'node:fs'
import * as path from 'node:path'

const count = Number(process.env.BENCHMARK_ROUTE_COUNT ?? '200')
const nestedLevels = Number(process.env.BENCHMARK_NESTED_LEVELS ?? '0')
const routeMethods = (process.env.BENCHMARK_ROUTE_METHODS ?? 'get')
  .split(',')
  .map((method) => method.trim())
  .filter(Boolean)
const supportedRouteMethods = new Set([
  'get',
  'post',
  'put',
  'delete',
  'options',
  'patch',
  'query',
  'all',
  'on',
])

// These fixtures are part of the route count so route-count comparisons remain
// comparable across benchmark runs.
const fixedRouteCount = 2

if (!Number.isSafeInteger(count) || count < fixedRouteCount) {
  throw new Error(`BENCHMARK_ROUTE_COUNT must be an integer >= ${fixedRouteCount}`)
}

if (!Number.isSafeInteger(nestedLevels) || nestedLevels < 0) {
  throw new Error('BENCHMARK_NESTED_LEVELS must be a non-negative integer')
}

if (
  routeMethods.length === 0 ||
  routeMethods.some((method) => !supportedRouteMethods.has(method))
) {
  throw new Error(
    `BENCHMARK_ROUTE_METHODS must contain only: ${[...supportedRouteMethods].join(', ')}`
  )
}

const bulkRouteCount = count - fixedRouteCount

const clientPrefix = () => {
  const segments = ['api']

  for (let level = nestedLevels; level > 0; level--) {
    segments.push(`level${level}`)
  }

  if (nestedLevels > 0) {
    segments.push('api')
  }

  return segments
}

const clientProperty = (segments: string[]) => {
  let expression = 'client'
  for (const segment of segments) {
    expression += /^[A-Za-z_$][\w$]*$/.test(segment)
      ? `.${segment}`
      : `[${JSON.stringify(segment)}]`
  }
  return expression
}

const generateCollisionApp = () => `import { Hono } from '../../../src'

// Both spellings are accepted by Hono and must remain observable to RPC.
export const collisionApp = new Hono()
  .get('/foo', (c) => c.json({ path: 'slash' as const }, 200))
  .post('foo', (c) => c.json({ path: 'bare' as const }, 201))
`

const generateApp = () => {
  const root = nestedLevels > 0 ? 'level0' : 'app'
  let routes = `import { Hono } from '../../../src'
import { validator } from '../../../src/validator'

const queryValidator = validator('query', (value) => ({
  q: typeof value.q === 'string' ? value.q : '',
  page: typeof value.page === 'string' ? value.page : '',
}))

const jsonValidator = validator('json', (value: unknown) => {
  const input = value as { title?: unknown; count?: unknown }
  return {
    title: typeof input.title === 'string' ? input.title : '',
    count: typeof input.count === 'number' ? input.count : 0,
  }
})

${nestedLevels > 0 ? `const ${root}` : 'export const app'} = new Hono()
  // Shared prefix, multiple methods, typed query input, params, and output.
  .get('/api/v1/users/:id', queryValidator, (c) => {
    const query = c.req.valid('query')
    return c.json(
      {
        kind: 'user' as const,
        id: c.req.param('id'),
        q: query.q,
        page: query.page,
      },
      200
    )
  })
  .post('/api/v1/users/:id', jsonValidator, (c) => {
    const body = c.req.valid('json')
    return c.json(
      {
        accepted: true as const,
        id: c.req.param('id'),
        title: body.title,
        count: body.count,
      },
      201
    )
  })
`

  for (let i = 1; i <= bulkRouteCount; i++) {
    const method = routeMethods[(i - 1) % routeMethods.length]
    const route = `/shared/api/v1/route${i}/:id`
    routes +=
      method === 'on'
        ? `
  .on('GET', '${route}', (c) => {
    return c.json({
      ok: true,
      route: ${i},
    })
  })`
        : `
  .${method}('${route}', (c) => {
    return c.json({
      ok: true,
      route: ${i},
    })
  })`
  }

  for (let level = 1; level <= nestedLevels; level++) {
    routes += `
const level${level} = new Hono().route('/level${level}', level${level - 1})`
  }

  if (nestedLevels > 0) {
    routes += `
export const app = new Hono().route('/api', level${nestedLevels})`
  }

  return routes + '\n'
}

const generateClientCases = () => {
  const users = clientProperty([...clientPrefix(), 'v1', 'users', ':id'])
  return `import { hc, type InferRequestType, type InferResponseType } from '../../../src/client'
import type { app } from './app'

type Equivalent<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false
type Expect<T extends true> = T

const client = hc<typeof app>('/')
const users = ${users}

// Exercise real RPC calls; the benchmark must type-check both request methods.
const getCall = users.$get({
  param: { id: 'user-1' },
  query: { q: 'hono', page: '1' },
})
const postCall = users.$post({
  param: { id: 'user-1' },
  json: { title: 'Hono', count: 1 },
})

type GetRequest = InferRequestType<typeof users.$get>
type GetRequestCheck = Expect<
  Equivalent<
    GetRequest,
    {
      param: { id: string }
      query: { q: string | string[]; page: string | string[] }
    }
  >
>
type PostRequest = InferRequestType<typeof users.$post>
type PostRequestCheck = Expect<
  Equivalent<
    PostRequest,
    {
      param: { id: string }
      json: { title: string; count: number }
    }
  >
>

type GetResponse = InferResponseType<typeof users.$get, 200>
type GetResponseCheck = Expect<
  Equivalent<GetResponse, { kind: 'user'; id: string; q: string; page: string }>
>
type PostResponse = InferResponseType<typeof users.$post, 201>
type PostResponseCheck = Expect<
  Equivalent<PostResponse, { accepted: true; id: string; title: string; count: number }>
>

const checkResponseTypes = async () => {
  const getData = await (await getCall).json()
  type GetDataCheck = Expect<Equivalent<typeof getData, GetResponse>>

  const postData = await (await postCall).json()
  type PostDataCheck = Expect<Equivalent<typeof postData, PostResponse>>
}

void checkResponseTypes
`
}

const generateCollisionContract = () => {
  const collision = clientProperty(['foo'])
  return `import { hc } from '../../../src/client'
import type { collisionApp } from './collision-app'

type Equivalent<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false
type Expect<T extends true> = T

const client = hc<typeof collisionApp>('/')
const collision = ${collision}

// This is a conformance check, kept separate from the performance project so
// a known source-level collision is reported instead of being hidden.
type CollisionMethods = Extract<keyof typeof collision, '$get' | '$post'>
type CollisionMethodsCheck = Expect<Equivalent<CollisionMethods, '$get' | '$post'>>

void collision.$get()
void collision.$post()
`
}

writeFileSync(path.join(import.meta.dirname, '../generated/app.ts'), generateApp())
writeFileSync(
  path.join(import.meta.dirname, '../generated/collision-app.ts'),
  generateCollisionApp()
)
writeFileSync(path.join(import.meta.dirname, '../generated/client-cases.ts'), generateClientCases())
writeFileSync(
  path.join(import.meta.dirname, '../generated/collision-contract.ts'),
  generateCollisionContract()
)

console.log(`${count} routes have been written to app.ts`)
console.log(
  `fixtures: shared prefix + GET/POST RPC calls + /foo/foo collision; nested levels: ${nestedLevels}`
)
