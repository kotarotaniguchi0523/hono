import type { Hono } from '../hono'
import type { HonoBase } from '../hono-base'
import type { LazySchemaPathEntry, LazySchemaPathMarker } from '../internal/schema'
import type { METHODS, METHOD_NAME_ALL_LOWERCASE } from '../router'
import type {
  Endpoint,
  ExtractSchema,
  KnownResponseFormat,
  MergePath,
  MergeSchemaPath,
  ResponseFormat,
  Schema,
} from '../types'
import type { StatusCode, SuccessStatusCode } from '../utils/http-status'
import type { HasRequiredKeys } from '../utils/types'

/**
 * Type representing the '$all' method name
 */
type MethodNameAll = `$${typeof METHOD_NAME_ALL_LOWERCASE}`

/**
 * Type representing all standard HTTP methods prefixed with '$'
 * e.g., '$get' | '$post' | '$put' | '$delete' | '$options' | '$patch' | '$query'
 */
type StandardMethods = `$${(typeof METHODS)[number]}`

/**
 * Expands '$all' into all standard HTTP methods.
 * If the schema contains '$all', it creates a type where all standard HTTP methods
 * point to the same endpoint definition as '$all', while removing '$all' itself.
 */
type ExpandAllMethod<S> = MethodNameAll extends keyof S
  ? { [M in StandardMethods]: S[MethodNameAll] } & Omit<S, MethodNameAll>
  : S

type HonoRequest = (typeof Hono.prototype)['request']

export type BuildSearchParamsFn = (query: Record<string, string | string[]>) => URLSearchParams

export type ClientRequestOptions<T = unknown> = {
  fetch?: typeof fetch | HonoRequest
  webSocket?: (...args: ConstructorParameters<typeof WebSocket>) => WebSocket
  /**
   * Standard `RequestInit`, caution that this take highest priority
   * and could be used to overwrite things that Hono sets for you, like `body | method | headers`.
   *
   * If you want to add some headers, use in `headers` instead of `init`
   */
  init?: RequestInit
  /**
   * Custom function to serialize query parameters into URLSearchParams.
   * By default, arrays are serialized as multiple parameters with the same key (e.g., `key=a&key=b`).
   * You can provide a custom function to change this behavior, for example to use bracket notation (e.g., `key[]=a&key[]=b`).
   *
   * @example
   * ```ts
   * const client = hc('http://localhost', {
   *   buildSearchParams: (query) => {
   *     return new URLSearchParams(qs.stringify(query))
   *   }
   * })
   * ```
   */
  buildSearchParams?: BuildSearchParamsFn
} & (keyof T extends never
  ? {
      headers?:
        | Record<string, string>
        | (() => Record<string, string> | Promise<Record<string, string>>)
    }
  : {
      headers: T | (() => T | Promise<T>)
    })

export type ClientRequest<Prefix extends string, Path extends string, S extends Schema> = {
  [M in keyof ExpandAllMethod<S>]: ExpandAllMethod<S>[M] extends Endpoint & { input: infer R }
    ? R extends object
      ? HasRequiredKeys<R> extends true
        ? (
            args: R,
            options?: ClientRequestOptions
          ) => Promise<ClientResponseOfEndpoint<ExpandAllMethod<S>[M]>>
        : (
            args?: R,
            options?: ClientRequestOptions
          ) => Promise<ClientResponseOfEndpoint<ExpandAllMethod<S>[M]>>
      : never
    : never
} & {
  $url: <
    const Arg extends
      | (S[keyof S] extends { input: infer R }
          ? R extends { param: infer P }
            ? R extends { query: infer Q }
              ? { param: P; query: Q }
              : { param: P }
            : R extends { query: infer Q }
              ? { query: Q }
              : {}
          : {})
      | undefined = undefined,
  >(
    arg?: Arg
  ) => HonoURL<Prefix, Path, Arg>
  $path: <
    const Arg extends
      | (S[keyof S] extends { input: infer R }
          ? R extends { param: infer P }
            ? R extends { query: infer Q }
              ? { param: P; query: Q }
              : { param: P }
            : R extends { query: infer Q }
              ? { query: Q }
              : {}
          : {})
      | undefined = undefined,
  >(
    arg?: Arg
  ) => BuildPath<Path, Arg>
} & (S['$get'] extends { outputFormat: 'ws' }
    ? S['$get'] extends { input: infer I }
      ? {
          $ws: (args?: I) => WebSocket
        }
      : {}
    : {})

type ClientResponseOfEndpoint<T extends Endpoint = Endpoint> = T extends {
  output: infer O
  outputFormat: infer F
  status: infer S
}
  ? ClientResponse<O, S extends number ? S : never, F extends ResponseFormat ? F : never>
  : never

export interface ClientResponse<
  T,
  U extends number = StatusCode,
  F extends ResponseFormat = ResponseFormat,
> {
  readonly body: ReadableStream | null
  readonly bodyUsed: boolean
  ok: U extends SuccessStatusCode
    ? true
    : U extends Exclude<StatusCode, SuccessStatusCode>
      ? false
      : boolean
  redirected: boolean
  status: U
  statusText: string
  type: 'basic' | 'cors' | 'default' | 'error' | 'opaque' | 'opaqueredirect'
  headers: Headers
  url: string
  redirect(url: string, status: number): Response
  clone(): Response
  bytes(): Promise<Uint8Array<ArrayBuffer>>
  json(): F extends 'text' ? Promise<never> : F extends 'json' ? Promise<T> : Promise<unknown>
  text(): F extends 'text' ? (T extends string ? Promise<T> : Promise<never>) : Promise<string>
  blob(): Promise<Blob>
  formData(): Promise<FormData>
  arrayBuffer(): Promise<ArrayBuffer>
}

type BuildSearch<Arg, Key extends 'query'> = Arg extends { [K in Key]: infer Query }
  ? IsEmptyObject<Query> extends true
    ? ''
    : `?${string}`
  : ''

type BuildPathname<P extends string, Arg> = Arg extends { param: infer Param }
  ? `${ApplyParam<TrimStartSlash<P>, Param>}`
  : `/${TrimStartSlash<P>}`

type BuildPath<P extends string, Arg> = `${BuildPathname<P, Arg>}${BuildSearch<Arg, 'query'>}`

type BuildTypedURL<
  Protocol extends string,
  Host extends string,
  Port extends string,
  P extends string,
  Arg,
> = TypedURL<`${Protocol}:`, Host, Port, BuildPathname<P, Arg>, BuildSearch<Arg, 'query'>>

type HonoURL<Prefix extends string, Path extends string, Arg> =
  IsLiteral<Prefix> extends true
    ? TrimEndSlash<Prefix> extends `${infer Protocol}://${infer Rest}`
      ? Rest extends `${infer Hostname}/${infer P}`
        ? ParseHostName<Hostname> extends [infer Host extends string, infer Port extends string]
          ? BuildTypedURL<Protocol, Host, Port, P, Arg>
          : never
        : ParseHostName<Rest> extends [infer Host extends string, infer Port extends string]
          ? BuildTypedURL<Protocol, Host, Port, Path, Arg>
          : never
      : URL
    : URL
type ParseHostName<T extends string> = T extends `${infer Host}:${infer Port}`
  ? [Host, Port]
  : [T, '']
type TrimStartSlash<T extends string> = T extends `/${infer R}` ? TrimStartSlash<R> : T
type TrimEndSlash<T extends string> = T extends `${infer R}/` ? TrimEndSlash<R> : T
type IsLiteral<T extends string> = [T] extends [never] ? false : string extends T ? false : true
type ApplyParam<
  Path extends string,
  P,
  Result extends string = '',
> = Path extends `${infer Head}/${infer Rest}`
  ? Head extends `:${infer Param}`
    ? P extends Record<Param, infer Value extends string>
      ? IsLiteral<Value> extends true
        ? ApplyParam<Rest, P, `${Result}/${Value & string}`>
        : ApplyParam<Rest, P, `${Result}/${Head}`>
      : ApplyParam<Rest, P, `${Result}/${Head}`>
    : ApplyParam<Rest, P, `${Result}/${Head}`>
  : Path extends `:${infer Param}`
    ? P extends Record<Param, infer Value extends string>
      ? IsLiteral<Value> extends true
        ? `${Result}/${Value & string}`
        : `${Result}/${Path}`
      : `${Result}/${Path}`
    : `${Result}/${Path}`
type IsEmptyObject<T> = keyof T extends never ? true : false

export interface TypedURL<
  Protocol extends string,
  Hostname extends string,
  Port extends string,
  Pathname extends string,
  Search extends string,
> extends URL {
  protocol: Protocol
  hostname: Hostname
  port: Port
  host: Port extends '' ? Hostname : `${Hostname}:${Port}`
  origin: `${Protocol}//${Hostname}${Port extends '' ? '' : `:${Port}`}`
  pathname: Pathname
  search: Search
  href: `${Protocol}//${Hostname}${Port extends '' ? '' : `:${Port}`}${Pathname}${Search}`
}

export interface Response extends ClientResponse<unknown> {}

export type Fetch<T> = (
  args?: InferRequestType<T>,
  opt?: ClientRequestOptions
) => Promise<ClientResponseOfEndpoint<InferEndpointType<T>>>

type InferEndpointType<T> = T extends (
  args: infer R,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: any | undefined
) => Promise<infer U>
  ? U extends ClientResponse<infer O, infer S, infer F>
    ? { input: NonNullable<R>; output: O; outputFormat: F; status: S } extends Endpoint
      ? { input: NonNullable<R>; output: O; outputFormat: F; status: S }
      : never
    : never
  : never

export type InferResponseType<T, U extends StatusCode = StatusCode> = InferResponseTypeFromEndpoint<
  InferEndpointType<T>,
  U
>

type InferResponseTypeFromEndpoint<T extends Endpoint, U extends StatusCode> = T extends {
  output: infer O
  status: infer S
}
  ? S extends U
    ? O
    : never
  : never

export type InferRequestType<T> = T extends (
  args: infer R,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: any | undefined
) => Promise<ClientResponse<unknown>>
  ? NonNullable<R>
  : never

export type InferRequestOptionsType<T> = T extends (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any,
  options: infer R
) => Promise<ClientResponse<unknown>>
  ? NonNullable<R>
  : never

/**
 * Filter a ClientResponse type so it only includes responses of specific status codes.
 */
export type FilterClientResponseByStatusCode<
  T extends ClientResponse<any, any, any>,
  U extends number = StatusCode,
> =
  T extends ClientResponse<infer RT, infer RC, infer RF>
    ? RC extends U
      ? ClientResponse<RT, RC, RF>
      : never
    : never

type PathToChain<
  Prefix extends string,
  Path extends string,
  E extends Schema,
  Original extends string = Path,
> = Path extends `/${infer P}`
  ? PathToChain<Prefix, P, E, Path>
  : Path extends `${infer P}/${infer R}`
    ? { [K in P]: PathToChain<Prefix, R, E, Original> }
    : {
        [K in Path extends '' ? 'index' : Path]: ClientRequest<
          Prefix,
          Original,
          E extends Record<string, unknown> ? E[Original] : never
        >
      }

type HonoSchema = Schema | LazySchemaPathMarker<LazySchemaPathEntry<object, string>>

type LazySchemaPathEntries<S> = S extends { readonly [Symbol.iterator]: infer Entry }
  ? Entry extends LazySchemaPathEntry<object, string>
    ? Entry
    : never
  : never

type ClientFromMountedSchema<S extends Schema, Prefix extends string, MountPath extends string> =
  MergeSchemaPath<S, MountPath> extends infer MountedSchema extends Schema
    ? MountedSchema extends Record<infer K, Schema>
      ? K extends string
        ? PathToChain<Prefix, K, MountedSchema>
        : never
      : never
    : never

type ClientFromDirectSchema<
  S extends Schema,
  Prefix extends string,
  MountPath extends string,
> = MountPath extends ''
  ? S extends Record<infer K, Schema>
    ? K extends string
      ? PathToChain<Prefix, K, S>
      : never
    : never
  : ClientFromMountedSchema<S, Prefix, MountPath>

type ClientFromLazySchemaEntries<Entries, Prefix extends string, MountPath extends string> =
  Entries extends LazySchemaPathEntry<
    infer SubSchema extends HonoSchema,
    infer SubPath extends string
  >
    ? SubSchema extends LazySchemaPathMarker<LazySchemaPathEntry<object, string>>
      ? ClientFromSchema<SubSchema, Prefix, MergePath<MountPath, SubPath>>
      : SubSchema extends Schema
        ? ClientFromMountedSchema<SubSchema, Prefix, MergePath<MountPath, SubPath>>
        : never
    : never

type ClientFromSchema<S extends HonoSchema, Prefix extends string, MountPath extends string = ''> =
  S extends LazySchemaPathMarker<LazySchemaPathEntry<object, string>>
    ? ClientFromLazySchemaEntries<LazySchemaPathEntries<S>, Prefix, MountPath>
    : S extends Schema
      ? ClientFromDirectSchema<S, Prefix, MountPath>
      : never

export type Client<T, Prefix extends string> =
  T extends HonoBase<any, infer S, any>
    ? S extends HonoSchema
      ? ClientFromSchema<S, Prefix>
      : never
    : never

export type Callback = (opts: CallbackOptions) => unknown

interface CallbackOptions {
  path: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any[]
}

export type ObjectType<T = unknown> = {
  [key: string]: T
}

type GlobalResponseDefinition = {
  [S in StatusCode]?: {
    [F in KnownResponseFormat]?: unknown
  }
}

type ToEndpoints<Def extends GlobalResponseDefinition, R> = {
  [S in keyof Def & StatusCode]: {
    [F in keyof Def[S] & KnownResponseFormat]: Omit<R, 'output' | 'status' | 'outputFormat'> & {
      output: Def[S][F]
      status: S
      outputFormat: F
    }
  }[keyof Def[S] & KnownResponseFormat]
}[keyof Def & StatusCode]

type ModRoute<R, Def extends GlobalResponseDefinition> = R extends Endpoint
  ? R | ToEndpoints<Def, R>
  : R

type ModSchema<D, Def extends GlobalResponseDefinition> = {
  [K in keyof D]: {
    [M in keyof D[K]]: ModRoute<D[K][M], Def>
  }
}

export type ApplyGlobalResponse<App, Def extends GlobalResponseDefinition> =
  App extends HonoBase<infer E, infer S, infer B>
    ? S extends HonoSchema
      ? ModSchema<ExtractSchema<App>, Def> extends infer S extends Schema
        ? Hono<E, S, B>
        : never
      : never
    : never

type PickRoute<R, U extends StatusCode> = R extends Endpoint
  ? R extends { status: U }
    ? R
    : never
  : R

type PickSchema<D, U extends StatusCode> = {
  [K in keyof D]: {
    [M in keyof D[K]]: PickRoute<D[K][M], U>
  }
}

/**
 * Keep only specific status code responses from all routes of an app.
 * Useful when error responses are handled centrally (e.g., via custom fetch)
 * and you want the client to only expose success response types.
 *
 * @example
 * ```ts
 * type AppSuccessOnly = PickResponseByStatusCode<typeof app, 200>
 * const client = hc<AppSuccessOnly>('http://localhost')
 * ```
 */
export type PickResponseByStatusCode<App, U extends StatusCode> =
  App extends HonoBase<infer E, infer S, infer B>
    ? S extends HonoSchema
      ? PickSchema<ExtractSchema<App>, U> extends infer S extends Schema
        ? Hono<E, S, B>
        : never
      : never
    : never
