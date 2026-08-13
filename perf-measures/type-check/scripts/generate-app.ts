import { writeFile } from 'node:fs'
import * as path from 'node:path'

const count = Number(process.env.BENCHMARK_ROUTE_COUNT ?? '200')

if (!Number.isSafeInteger(count) || count < 1) {
  throw new Error('BENCHMARK_ROUTE_COUNT must be a positive integer')
}

const generateRoutes = (count: number) => {
  let routes = `import { Hono } from '../../../src'
export const app = new Hono()`
  for (let i = 1; i <= count; i++) {
    routes += `
  .get('/route${i}/:id', (c) => {
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
