import { writeFile } from 'node:fs'
import * as path from 'node:path'

const count = Number(process.env.BENCHMARK_ROUTE_COUNT ?? '200')
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

if (!Number.isSafeInteger(count) || count < 1) {
  throw new Error('BENCHMARK_ROUTE_COUNT must be a positive integer')
}

if (
  routeMethods.length === 0 ||
  routeMethods.some((method) => !supportedRouteMethods.has(method))
) {
  throw new Error(
    `BENCHMARK_ROUTE_METHODS must contain only: ${[...supportedRouteMethods].join(', ')}`
  )
}

const generateRoutes = (count: number) => {
  let routes = `import { Hono } from '../../../src'
export const app = new Hono()`
  for (let i = 1; i <= count; i++) {
    const method = routeMethods[(i - 1) % routeMethods.length]
    routes +=
      method === 'on'
        ? `
  .on('GET', '/route${i}/:id', (c) => {
    return c.json({
      ok: true
    })
  })`
        : `
  .${method}('/route${i}/:id', (c) => {
    return c.json({
      ok: true
    })
  })`
  }
  return routes
}

const routes = generateRoutes(count)

writeFile(path.join(import.meta.dirname, '../generated/app.ts'), routes, (err) => {
  if (err) {
    throw err
  }
  console.log(`${count} routes have been written to app.ts`)
})
