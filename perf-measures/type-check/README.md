# RPC type-check benchmark

Generate a route chain and measure the TypeScript project with a clean build:

```sh
BENCHMARK_ROUTE_COUNT=200 \
BENCHMARK_ROUTE_METHODS=get,post,put,delete,options,patch,query,all,on \
BENCHMARK_NESTED_LEVELS=0 \
bun perf-measures/type-check/scripts/generate-app.ts
bun tsc -b perf-measures/type-check/tsconfig.build.json --force --pretty false --diagnostics
bun tsc -p perf-measures/type-check/tsconfig.contracts.json --pretty false
```

`BENCHMARK_ROUTE_COUNT` is the total number of routes in the performance
application. Two routes are reserved for the typed GET/POST fixture; the
remaining routes rotate through the methods specified by
`BENCHMARK_ROUTE_METHODS`.

The generated fixture measures:

- shared path prefixes and multiple HTTP methods;
- actual `hc` `$get()`/`$post()` calls;
- query, JSON, and path-parameter request types;
- `InferRequestType` and `InferResponseType`;
- response `.json()` output types;
- `/foo` and `foo` as a separate collision contract.

The second diagnostics block is the RPC client project; its `Instantiations`
value is the primary performance metric. The collision contract is intentionally
checked in a separate project so it does not distort the performance workload.

`BENCHMARK_NESTED_LEVELS` wraps the generated routes in that many nested
`route()` sub-applications. It defaults to `0`.

## Current measurements

These measurements use the expanded fixture above with TypeScript 6.0.3. They
are not directly comparable with the historical table from the smaller
pre-expansion fixture.

| Routes | Client instantiations |
| -----: | --------------------: |
|     50 |               172,679 |
|    100 |               240,719 |
|    200 |               413,965 |
|    400 |               910,791 |

At 200 routes, the current client count is `413,965` while rotating through
all nine supported registration methods.

With 200 routes and nested `route()` levels:

| Nested levels | Client instantiations |
| ------------: | --------------------: |
|             0 |               413,965 |
|             1 |               526,969 |
|             2 |               549,408 |
|             5 |               616,731 |
|            20 |               939,514 |
|            30 |             1,135,534 |
|            50 |             1,527,574 |

The 30-, 50-, 75-, and 100-level fixtures also pass type checking. For
ordinary paths Hono keeps the shared client path tree. When a literal path
exceeds the depth threshold, the client uses a flat path-chain fallback; this
prevents deep `route()` composition from making `hc` hit `TS2589`.

## Rejected approaches

| Approach                           | Result                    | Reason                                                                                                                   |
| ---------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Removing `Simplify<T> & {}`        | Faster locally            | Breaks the editor-facing flattening behavior, so the original helper is retained.                                        |
| Endpoint-local `Simplify` deferral | Type-safe but slower      | Conditional and marker wrappers either increased instantiations or changed exact editor/type-equality shapes.            |
| Eager schema materialization       | Type-safe but not adopted | It hides computation behind a new API and changes the fluent API cost model.                                             |
| Flat client chain for every path   | `423,006` at 200 routes   | It helps deep paths but is slower than the shared tree for ordinary routes, so it is used only past the depth threshold. |

The accepted design keeps Hono's fluent `S & route-layer` schema. `HandlerInterface`
uses `in M` because `M` becomes an RPC method-key set; widening a GET-only
handler to a GET/POST handler would advertise a route the runtime value does not
implement.

`route()` now stores composition metadata under a symbol key, so a real route
named `__hono_lazy_schema_path__` remains valid. Nested child markers are
prefix-flattened before storage, and schema materialization uses a tail-oriented
worklist. The editor-facing `Simplify<T>` intentionally retains its `& {}`
intersection.
