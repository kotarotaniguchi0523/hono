/** Metadata retained by a composed schema until the public schema is read. */
export type LazySchemaPathEntry<SubSchema extends object, SubPath extends string> = {
  schema: SubSchema
  path: SubPath
}

/** A type-only marker for a schema that still has paths to materialize. */
export type LazySchemaPathMarker<Entry extends LazySchemaPathEntry<object, string>> = {
  readonly [Symbol.iterator]: Entry
}

/** Keep composed route metadata on the schema without eagerly remapping OrigSchema. */
export type AddLazySchemaPath<
  OrigSchema extends object,
  SubSchema extends object,
  SubPath extends string,
> = OrigSchema | LazySchemaPathMarker<LazySchemaPathEntry<SubSchema, SubPath>>
