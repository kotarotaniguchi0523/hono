import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import * as path from 'node:path'

type MetricName = 'Instantiations' | 'Types' | 'Symbols'

type Metric = {
  key: string
  name: string
  value: number
  unit?: string
}

type CompilerConfigSpec = {
  config: string
  rootDirectory: string
  usesIncremental: boolean
}

type BenchmarkCase = CompilerConfigSpec & {
  key: string
  name: string
  declarationFiles?: readonly string[]
}

type CompilerRun = {
  stdout: string
  stderr: string
  wallTimeMs: number
}

type RawSample = {
  case: string
  phase: 'warmup' | 'measured'
  sample: number
  deterministic: Record<MetricName, number>
  wallTimeMs: number
  declarationBytes?: number
  stdout: string
  stderr: string
}

type SummaryStats = {
  min: number
  median: number
  mean: number
  max: number
  distinctValues: number
}

type CaseSummary = {
  key: string
  name: string
  sampleCount: number
  deterministic: Record<MetricName, SummaryStats>
  declarationBytes?: SummaryStats
  wallTimeMs: SummaryStats
}

const benchmarkDirectory = path.join(import.meta.dirname, '..')
const repositoryDirectory = path.resolve(benchmarkDirectory, '../..')
const benchmarkDistDirectory = path.join(benchmarkDirectory, 'dist')
const defaultCompiler = path.join(benchmarkDirectory, '../../node_modules/.bin/tsc')
const compilerCommand = process.env['BENCHMARK_TS_COMMAND']?.trim() || defaultCompiler
const [compiler, ...compilerPrefixArguments] = compilerCommand.split(/\s+/)
const warmupCount = 1
const measuredSampleCount = 10

if (!compiler) {
  throw new Error('BENCHMARK_TS_COMMAND must contain a compiler command')
}

const cases = [
  {
    key: 'domain-authoring',
    name: 'Domain authoring (5 domains, 20 routes each; 100 routes authored)',
    config: 'tsconfig.domain-authoring.json',
    rootDirectory: repositoryDirectory,
    usesIncremental: true,
    declarationFiles: [
      'perf-measures/rpc-type-check/generated/domains/shared.d.ts',
      'perf-measures/rpc-type-check/generated/domains/users.d.ts',
      'perf-measures/rpc-type-check/generated/domains/posts.d.ts',
      'perf-measures/rpc-type-check/generated/domains/comments.d.ts',
      'perf-measures/rpc-type-check/generated/domains/teams.d.ts',
      'perf-measures/rpc-type-check/generated/domains/projects.d.ts',
      'perf-measures/rpc-type-check/generated/domains/index.d.ts',
    ],
  },
  {
    key: 'parent-composition',
    name: 'Parent route composition and schema projection (5 modules; 100 routes available)',
    config: 'tsconfig.parent-composition.json',
    rootDirectory: repositoryDirectory,
    usesIncremental: true,
    declarationFiles: ['perf-measures/rpc-type-check/generated/parent.d.ts'],
  },
  {
    key: 'rpc-contracts',
    name: 'RPC consumer contracts (split and aggregate clients; request/response assertions)',
    config: 'tsconfig.contracts.json',
    rootDirectory: repositoryDirectory,
    usesIncremental: true,
  },
] as const satisfies readonly BenchmarkCase[]

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

const runCompiler = (arguments_: string[], label: string): CompilerRun => {
  process.stderr.write(`${label}\n`)
  const start = process.hrtime.bigint()
  const result = spawnSync(compiler, [...compilerPrefixArguments, ...arguments_], {
    cwd: benchmarkDirectory,
    encoding: 'utf8',
    env: process.env,
  })
  const wallTimeMs = Number(process.hrtime.bigint() - start) / 1_000_000
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''

  if (result.error) {
    throw new Error(`Unable to run ${compilerCommand}`, { cause: result.error })
  }
  if (result.status !== 0) {
    if (stdout) {
      process.stderr.write(stdout)
    }
    if (stderr) {
      process.stderr.write(stderr)
    }
    throw new Error(`${compilerCommand} exited with status ${result.status ?? 'unknown'}`)
  }

  if (stderr) {
    process.stderr.write(stderr)
  }
  return { stdout, stderr, wallTimeMs }
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

const metricNames: readonly MetricName[] = ['Instantiations', 'Types', 'Symbols']

const kebabCase = (value: string): string =>
  value
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

const parseDiagnostics = (
  output: string,
  benchmarkCase: BenchmarkCase
): Record<MetricName, number> => {
  const diagnostics = new Map<string, number>()
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:]+):\s*([0-9]+(?:\.[0-9]+)?)\s*(?:[A-Za-z]+)?\s*$/)
    if (match) {
      diagnostics.set(match[1].trim(), Number(match[2]))
    }
  }

  return Object.fromEntries(
    metricNames.map((metricName) => {
      const value = diagnostics.get(metricName)
      if (value === undefined) {
        throw new Error(
          `Compiler diagnostics did not contain "${metricName}" for ${benchmarkCase.name}`
        )
      }
      return [metricName, value]
    })
  ) as Record<MetricName, number>
}

const fixtureFiles = [
  'generated/domains/shared.ts',
  ...['users', 'posts', 'comments', 'teams', 'projects'].map(
    (domain) => `generated/domains/${domain}.ts`
  ),
  'generated/domains/index.ts',
  'generated/parent.ts',
]

const harnessFiles = [
  '.gitignore',
  'contracts/contracts.ts',
  'scripts/generate-fixture.ts',
  'scripts/run-benchmarks.ts',
  'tsconfig.contracts.json',
  'tsconfig.domain-authoring.json',
  'tsconfig.parent-composition.json',
  '../../bun.lock',
  '../../package.json',
  '../../tsconfig.base.json',
  '../../tsconfig.build.json',
  '../../src/types.ts',
  '../../src/hono-base.ts',
  '../../src/client/types.ts',
  '../../src/internal/schema.ts',
]

const fingerprintFiles = (files: readonly string[]): string => {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file)
    hash.update('\0')
    const filePath = path.join(benchmarkDirectory, file)
    hash.update(existsSync(filePath) ? readFileSync(filePath) : '<missing>')
    hash.update('\0')
  }
  return hash.digest('hex')
}

const declarationBytes = (directory: string, files: readonly string[]): number =>
  files.reduce((total, file) => total + statSync(path.join(directory, file)).size, 0)

const writeCompilerConfig = (
  runDirectory: string,
  name: string,
  spec: CompilerConfigSpec,
  honoConfigPath: string,
  outputDirectory: string
): string => {
  const configDirectory = path.join(runDirectory, 'configs')
  mkdirSync(configDirectory, { recursive: true })
  const compilerOptions: {
    rootDir: string
    outDir: string
    tsBuildInfoFile?: string
  } = {
    rootDir: spec.rootDirectory,
    outDir: outputDirectory,
  }
  if (spec.usesIncremental) {
    compilerOptions.tsBuildInfoFile = path.join(outputDirectory, 'tsconfig.tsbuildinfo')
  }

  const configPath = path.join(configDirectory, `${name}.json`)
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        extends: path.resolve(benchmarkDirectory, spec.config),
        compilerOptions,
        references: [{ path: honoConfigPath }],
      },
      null
    )}\n`
  )
  return configPath
}

const writeHonoCompilerConfig = (runDirectory: string): string => {
  const configPath = path.join(runDirectory, 'hono-tsconfig.json')
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        extends: path.join(repositoryDirectory, 'tsconfig.build.json'),
        compilerOptions: {
          rootDir: path.join(repositoryDirectory, 'src'),
          outDir: path.join(runDirectory, 'hono'),
          tsBuildInfoFile: path.join(runDirectory, 'hono.tsbuildinfo'),
          noUnusedLocals: false,
        },
      },
      null
    )}\n`
  )
  return configPath
}

const summarize = (values: readonly number[]): SummaryStats => {
  if (values.length === 0) {
    throw new Error('Cannot summarize an empty sample set')
  }
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
  return {
    min: sorted[0],
    median,
    mean: values.reduce((total, value) => total + value, 0) / values.length,
    max: sorted[sorted.length - 1],
    distinctValues: new Set(values).size,
  }
}

const gitValue = (arguments_: string[]): string | undefined => {
  const result = spawnSync('git', arguments_, {
    cwd: repositoryDirectory,
    encoding: 'utf8',
  })
  if (result.status !== 0 || result.error) {
    return undefined
  }
  return (result.stdout ?? '').trim() || undefined
}

const selectedCase = parseSelectedCase()
const selectedCases: readonly BenchmarkCase[] = selectedCase ? [selectedCase] : cases
const rawSamples: RawSample[] = []
const caseSummaries: CaseSummary[] = []
const metrics: Metric[] = []

mkdirSync(benchmarkDistDirectory, { recursive: true })
const runDirectory = mkdtempSync(path.join(benchmarkDistDirectory, 'run-'))

try {
  const compilerVersion = runCompiler(
    ['--version'],
    'Reading compiler version (outside measurements)'
  )
    .stdout.replace(/^Version\s+/m, '')
    .trim()
  runGenerator()
  const fixtureSha256 = fingerprintFiles(fixtureFiles)
  const harnessSha256 = fingerprintFiles(harnessFiles)
  process.stderr.write(`Fixture SHA-256: ${fixtureSha256}\n`)
  process.stderr.write(`Harness SHA-256: ${harnessSha256}\n`)
  const honoConfigPath = writeHonoCompilerConfig(runDirectory)
  runCompiler(
    ['--build', honoConfigPath, '--force', '--pretty', 'false'],
    'Building Hono declarations in isolated output (outside measurements)'
  )

  for (const benchmarkCase of selectedCases) {
    const runCase = (phase: RawSample['phase'], sample: number): void => {
      const outputDirectory = path.join(
        runDirectory,
        'samples',
        benchmarkCase.key,
        `${phase}-${sample}`
      )
      mkdirSync(outputDirectory, { recursive: true })
      const configPath = writeCompilerConfig(
        runDirectory,
        `${benchmarkCase.key}-${phase}-${sample}`,
        benchmarkCase,
        honoConfigPath,
        outputDirectory
      )
      const compilerRun = runCompiler(
        ['-p', configPath, '--diagnostics', '--pretty', 'false'],
        phase === 'warmup'
          ? `Warming up ${benchmarkCase.name}`
          : `Measuring ${benchmarkCase.name} (sample ${sample}/${measuredSampleCount})`
      )
      const rawSample: RawSample = {
        case: benchmarkCase.key,
        phase,
        sample,
        deterministic: parseDiagnostics(
          `${compilerRun.stdout}\n${compilerRun.stderr}`,
          benchmarkCase
        ),
        wallTimeMs: compilerRun.wallTimeMs,
        stdout: compilerRun.stdout,
        stderr: compilerRun.stderr,
      }
      if (benchmarkCase.declarationFiles) {
        rawSample.declarationBytes = declarationBytes(
          outputDirectory,
          benchmarkCase.declarationFiles
        )
      }
      rawSamples.push(rawSample)
    }

    for (let sample = 1; sample <= warmupCount; sample++) {
      runCase('warmup', sample)
    }
    for (let sample = 1; sample <= measuredSampleCount; sample++) {
      runCase('measured', sample)
    }

    const measuredSamples = rawSamples.filter(
      ({ case: caseKey, phase }) => caseKey === benchmarkCase.key && phase === 'measured'
    )
    const deterministic = Object.fromEntries(
      metricNames.map((metricName) => [
        metricName,
        summarize(measuredSamples.map(({ deterministic: sample }) => sample[metricName])),
      ])
    ) as Record<MetricName, SummaryStats>
    const declarationByteStats = benchmarkCase.declarationFiles
      ? summarize(measuredSamples.map(({ declarationBytes: bytes }) => bytes as number))
      : undefined
    const summary: CaseSummary = {
      key: benchmarkCase.key,
      name: benchmarkCase.name,
      sampleCount: measuredSamples.length,
      deterministic,
      wallTimeMs: summarize(measuredSamples.map(({ wallTimeMs }) => wallTimeMs)),
    }
    if (declarationByteStats) {
      summary.declarationBytes = declarationByteStats
    }
    caseSummaries.push(summary)

    for (const metricName of metricNames) {
      metrics.push({
        key: `${benchmarkCase.key}-${kebabCase(metricName)}`,
        name: `${benchmarkCase.name}: ${metricName}`,
        value: deterministic[metricName].median,
      })
    }
    if (declarationByteStats) {
      metrics.push({
        key: `${benchmarkCase.key}-declaration-bytes`,
        name: `${benchmarkCase.name}: Declaration bytes`,
        value: declarationByteStats.median,
        unit: 'B',
      })
    }
  }

  const compilerLabel = path.basename(compiler)
  const packageJson = JSON.parse(
    readFileSync(path.join(repositoryDirectory, 'package.json'), 'utf8')
  ) as { packageManager?: string }
  const benchmark = {
    key: `rpc-type-check-${kebabCase(compilerLabel)}`,
    name: `RPC Type Check (${compilerLabel} ${compilerVersion})`,
    metadata: {
      toolchain: {
        runner: 'Bun',
        bunVersion: process.versions.bun ?? 'unknown',
        nodeCompatibilityVersion: process.version,
        compilerCommand,
        compilerVersion,
        packageManager: packageJson.packageManager ?? 'unknown',
      },
      repository: {
        commit: gitValue(['rev-parse', 'HEAD']) ?? 'unknown',
        branch: gitValue(['branch', '--show-current']) ?? 'detached',
        commitDate: gitValue(['show', '-s', '--format=%cI', 'HEAD']) ?? 'unknown',
        workingTreeDirty: Boolean(gitValue(['status', '--porcelain'])),
      },
      fixtureSha256,
      harnessSha256,
      warmupCount,
      measuredSampleCount,
      cases: selectedCases.map(({ key }) => key),
    },
    samples: rawSamples,
    summary: {
      cases: caseSummaries,
    },
    metrics,
  }

  process.stdout.write(`${JSON.stringify(benchmark, null, 2)}\n`)
} finally {
  rmSync(runDirectory, { recursive: true, force: true })
}
