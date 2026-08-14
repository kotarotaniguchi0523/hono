# RPC type-check benchmark

Generate a route chain and measure the TypeScript project with a clean build:

```sh
BENCHMARK_ROUTE_COUNT=200 \
BENCHMARK_ROUTE_METHODS=get,post,put,delete,options,patch,query,all,on \
bun perf-measures/type-check/scripts/generate-app.ts
bun tsc -b perf-measures/type-check/tsconfig.build.json --force --pretty false --diagnostics
```

`BENCHMARK_ROUTE_COUNT` is the total number of routes. When several methods are
specified, the generator rotates through them so the comparison does not
silently multiply the route count.

The benchmark measures both the application type and the RPC client type. The
second diagnostics block is the client project; its `Instantiations` value is
the number to compare.

`BENCHMARK_NESTED_LEVELS` wraps the generated routes in that many nested
`route()` sub-applications. It defaults to `0`, preserving the flat benchmark.
Use it to measure route composition separately from the ordinary fluent route
chain.

With the benchmark at `ab853f76` (the variance-only baseline) versus the
current implementation, the client-project counts are:

| Routes | Baseline | Current |  Change |
| -----: | -------: | ------: | ------: |
|     50 |  175,050 | 156,647 | -10.51% |
|    100 |  237,225 | 213,322 | -10.07% |
|    200 |  399,075 | 364,172 |  -8.75% |
|    400 |  872,775 | 815,872 |  -6.52% |

At 200 routes while rotating through `get,post,put,delete,options,patch,query,all,on`,
the current count is 360,517. The route registration API is therefore tested
through the same schema and client path rather than only through `get`.

With 200 routes and five nested `route()` levels, lazy schema composition was
compared with the implementation before this change:

| Nested levels | Before | After | Change |
| ------------: | -----: | -----: | -----: |
|             0 | 364,172 | 383,103 | +5.20% |
|             1 | 1,059,373 | 411,309 | -61.17% |
|             2 | 1,900,657 | 434,386 | -77.15% |
|             5 | 5,737,627 | 503,833 | -91.22% |

At five nested levels, the same comparison was 50 routes: `556,552 → 193,108`,
100 routes: `1,636,077 → 284,183`, and 400 routes: `21,037,133 → 1,093,133`.

## Rejected approaches

| Approach                                   |      Result at 200 routes | Reason for rejection                                                                                            |
| ------------------------------------------ | ------------------------: | --------------------------------------------------------------------------------------------------------------- |
| RouteState tuple and final materialization |  1,875,202 instantiations | Copies the growing route tuple and then expands it through a union/intersection pass.                           |
| Recursive mapped path-parameter records    |    401,685 instantiations | More expensive than the existing small `UnionToIntersection` for Hono's common paths.                           |
| Named `ToSchema` endpoint wrapper          |    402,498 instantiations | Added another generic boundary without reducing the work performed by each route overload.                      |
| Eager materialized schema boundary         | Type-safe but not adopted | It hides computation behind a new API and changes the cost model rather than improving the existing fluent API. |

The accepted changes keep Hono's fluent `S & route-layer` schema. They add
variance annotations where the existing public relationships are invariant or
covariant, build the client path object as a shared path tree so each path
prefix is represented once, and keep `route()` composition as a linked lazy
schema marker until `ExtractSchema` or `hc` needs the public route shape.
