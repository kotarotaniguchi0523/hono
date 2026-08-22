import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, rmSync, statSync } from 'node:fs'
import * as path from 'node:path'

type Metric = {
  key: string
  name: string
  value: number
  unit?: string
}

type PrerequisiteKey = 'domain-authoring' | 'parent-composition'

type BenchmarkCase = {
  key: string
  name: string
  config: string
  prerequisites: readonly PrerequisiteKey[]
}

const benchmarkDirectory = path.join(import.meta.dirname, '..')
const benchmarkDistDirectory = path.join(benchmarkDirectory, 'dist')
const defaultCompiler = path.join(benchmarkDirectory, '../../node_modules/.bin/tsc')
const compilerCommand = process.env['BENCHMARK_TS_COMMAND']?.trim() || defaultCompiler
const [compiler, ...compilerPrefixArguments] = compilerCommand.split(/\s+/)

if (!compiler) {
  throw new Error('BENCHMARK_TS_COMMAND must contain a compiler command')
}

const cases = [
  {
    key: 'domain-authoring',
    name: 'Domain authoring (5 domains, 20 routes each; 100 routes authored)',
    config: 'tsconfig.domain-authoring.json',
    prerequisites: [],
  },
  {
    key: 'parent-composition',
    name: 'Parent route composition (5 emitted domains mounted; 100 routes available)',
    config: 'tsconfig.parent-composition.json',
    prerequisites: ['domain-authoring'],
  },
] as const satisfies readonly BenchmarkCase[]

const prerequisiteConfigs: Record<PrerequisiteKey, string> = {
  'domain-authoring': 'tsconfig.domain-authoring.json',
  'parent-composition': 'tsconfig.parent-composition.json',
}

const parseSelectedCase = (): (typeof cases)[number] | undefined => {
  const arguments_ = process.argv.slice(2)
  if (arguments_.length === 0) {
    return undefined
  }
  if (arguments_.length !== 2 || arguments_[0] !== '--case') {
    throw new Error(
      `Usage: bun scripts/run-benchmarks.ts [--case ${cases.map(({ key }) => key).join('|')}]`
    )
  }
  const selectedCase = cases.find(({ key }) => key === arguments_[1])
  if (!selectedCase) {
    throw new Error(
      `Unknown benchmark case "${arguments_[1]}". Expected one of: ${cases
        .map(({ key }) => key)
        .join(', ')}`
    )
  }
  return selectedCase
}

const run = (arguments_: string[], label: string): string => {
  process.stderr.write(`${label}\n`)
  const result = spawnSync(compiler, [...compilerPrefixArguments, ...arguments_], {
    cwd: benchmarkDirectory,
    encoding: 'utf8',
    env: process.env,
  })

  if (result.error) {
    throw new Error(`Unable to run ${compilerCommand}`, { cause: result.error })
  }
  if (result.status !== 0) {
    if (result.stdout) {
      process.stderr.write(result.stdout)
    }
    if (result.stderr) {
      process.stderr.write(result.stderr)
    }
    throw new Error(`${compilerCommand} exited with status ${result.status ?? 'unknown'}`)
  }

  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
  return result.stdout
}

const runGenerator = (): void => {
  process.stderr.write('Generating deterministic fixture (outside measurements)\n')
  const result = spawnSync(process.execPath, ['scripts/generate-fixture.ts'], {
    cwd: benchmarkDirectory,
    encoding: 'utf8',
    env: process.env,
  })
  if (result.error) {
    throw new Error('Unable to run fixture generator', { cause: result.error })
  }
  if (result.status !== 0) {
    if (result.stdout) {
      process.stderr.write(result.stdout)
    }
    if (result.stderr) {
      process.stderr.write(result.stderr)
    }
    throw new Error(`Fixture generator exited with status ${result.status ?? 'unknown'}`)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
}

const metricNames = ['Instantiations', 'Types', 'Symbols'] as const

const declarationFiles: Record<string, readonly string[] | undefined> = {
  'domain-authoring': [
    'dist/domains/shared.d.ts',
    'dist/domains/users.d.ts',
    'dist/domains/posts.d.ts',
    'dist/domains/comments.d.ts',
    'dist/domains/teams.d.ts',
    'dist/domains/projects.d.ts',
    'dist/domains/index.d.ts',
  ],
  'parent-composition': ['dist/parent.d.ts'],
}

const kebabCase = (value: string): string =>
  value
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

const parseDiagnostics = (output: string, benchmarkCase: BenchmarkCase): Metric[] => {
  const diagnostics = new Map<string, number>()
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:]+):\s*([0-9]+(?:\.[0-9]+)?)\s*(?:[A-Za-z]+)?\s*$/)
    if (match) {
      diagnostics.set(match[1].trim(), Number(match[2]))
    }
  }

  return metricNames.map((metricName) => {
    const value = diagnostics.get(metricName)
    if (value === undefined) {
      throw new Error(
        `Compiler diagnostics did not contain "${metricName}" for ${benchmarkCase.name}`
      )
    }
    return {
      key: `${benchmarkCase.key}-${kebabCase(metricName)}`,
      name: `${benchmarkCase.name}: ${metricName}`,
      value,
    }
  })
}

const fixtureFiles = [
  'generated/domains/shared.ts',
  ...['users', 'posts', 'comments', 'teams', 'projects'].map(
    (domain) => `generated/domains/${domain}.ts`
  ),
  'generated/domains/index.ts',
  'generated/parent.ts',
  'generated/deep-routes.ts',
]

const harnessFiles = [
  'scripts/run-benchmarks.ts',
  'tsconfig.domain-authoring.json',
  'tsconfig.parent-composition.json',
  '../../bun.lock',
  '../../package.json',
  '../../tsconfig.base.json',
  '../../tsconfig.build.json',
]

const fingerprintFiles = (files: readonly string[]): string => {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file)
    hash.update('\0')
    hash.update(readFileSync(path.join(benchmarkDirectory, file)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

const declarationBytes = (files: readonly string[]): number =>
  files.reduce((total, file) => total + statSync(path.join(benchmarkDirectory, file)).size, 0)

const selectedCase = parseSelectedCase()
const selectedCases: readonly BenchmarkCase[] = selectedCase ? [selectedCase] : cases

rmSync(benchmarkDistDirectory, { recursive: true, force: true })
const compilerVersion = run(['--version'], 'Reading compiler version (outside measurements)')
  .replace(/^Version\s+/, '')
  .trim()
runGenerator()
const fixtureSha256 = fingerprintFiles(fixtureFiles)
const harnessSha256 = fingerprintFiles(harnessFiles)
process.stderr.write(`Fixture SHA-256: ${fixtureSha256}\n`)
process.stderr.write(`Harness SHA-256: ${harnessSha256}\n`)
run(['--build', '../../tsconfig.build.json'], 'Building Hono declarations (outside measurements)')

const completedPrerequisites = new Set<PrerequisiteKey>()
const metrics: Metric[] = []

for (const benchmarkCase of selectedCases) {
  for (const prerequisite of benchmarkCase.prerequisites) {
    if (!completedPrerequisites.has(prerequisite)) {
      run(
        ['-p', prerequisiteConfigs[prerequisite], '--pretty', 'false'],
        `Building ${prerequisite} prerequisite (outside measurements)`
      )
      completedPrerequisites.add(prerequisite)
    }
  }

  const output = run(
    ['-p', benchmarkCase.config, '--diagnostics', '--pretty', 'false'],
    `Measuring ${benchmarkCase.name}`
  )
  metrics.push(...parseDiagnostics(output, benchmarkCase))
  const emittedDeclarations = declarationFiles[benchmarkCase.key]
  if (emittedDeclarations) {
    metrics.push({
      key: `${benchmarkCase.key}-declaration-bytes`,
      name: `${benchmarkCase.name}: Declaration bytes`,
      value: declarationBytes(emittedDeclarations),
      unit: 'B',
    })
  }
  if (benchmarkCase.key === 'domain-authoring' || benchmarkCase.key === 'parent-composition') {
    completedPrerequisites.add(benchmarkCase.key)
  }
}

const compilerLabel = path.basename(compiler)
const benchmark = {
  key: `rpc-type-check-${kebabCase(compilerLabel)}`,
  name: `RPC Type Check (${compilerLabel} ${compilerVersion})`,
  metadata: {
    fixtureSha256,
    harnessSha256,
    cases: selectedCases.map(({ key }) => key),
  },
  metrics,
}

process.stdout.write(`${JSON.stringify(benchmark, null, 2)}\n`)
