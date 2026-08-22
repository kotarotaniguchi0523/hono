import type { RemoveBlankRecord, Simplify } from '../utils/types'

type LazySchemaReference<S> = Pick<S, keyof S>

export interface LazySchemaPathEntry<SubSchema, SubPath extends string> {
  schema: LazySchemaReference<SubSchema>
  path: SubPath
}

export type LazySchemaPathMarker<Entry> = {
  readonly [Symbol.iterator]: Entry
}

type EndpointShape = {
  input: unknown
  output: unknown
  outputFormat: string
  status: number
}

type ExtractParams<Path extends string> = string extends Path
  ? Record<string, string>
  : Path extends `${infer _Start}:${infer Param}/${infer Rest}`
    ? { [K in Param | keyof ExtractParams<`/${Rest}`>]: string }
    : Path extends `${infer _Start}:${infer Param}`
      ? { [K in Param]: string }
      : never

export type MergeEndpointParamsWithPath<
  T extends EndpointShape,
  SubPath extends string,
> = T extends unknown
  ? {
      input: T['input'] extends { param: infer _ }
        ? ExtractParams<SubPath> extends never
          ? T['input']
          : Simplify<
              T['input'] & {
                param: {
                  [K in keyof ExtractParams<SubPath> as K extends `${infer Prefix}{${infer _}}`
                    ? Prefix
                    : K]: string
                }
              }
            >
        : RemoveBlankRecord<ExtractParams<SubPath>> extends never
          ? T['input']
          : T['input'] & {
              param: {
                [K in keyof ExtractParams<SubPath> as K extends `${infer Prefix}{${infer _}}`
                  ? Prefix
                  : K]: string
              }
            }
      output: T['output']
      outputFormat: T['outputFormat']
      status: T['status']
    }
  : never
