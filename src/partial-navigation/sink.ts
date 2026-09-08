/** @module */

import { parseMultipartResponse } from './multipart'
import type { PartialNavigationPart } from './multipart'
import { createPartialDOMPatcher } from './patch'

export interface HTMLFragmentParser {
  parse(html: string): DocumentFragment
}

export interface PartialNavigationSink {
  apply(response: Response, signal: AbortSignal): Promise<void>
}

export type PartialNavigationSinkOptions = {
  parser?: HTMLFragmentParser
  afterUpdate?: (root: Node) => void
}

const defaultParser = (document: Document): HTMLFragmentParser => ({
  parse(html) {
    const template = document.createElement('template')
    template.innerHTML = html
    return template.content
  },
})

const ensureNotAborted = (signal: AbortSignal): void => {
  if (signal.aborted) {
    throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
  }
}

const isPartKind = (
  part: PartialNavigationPart
): part is PartialNavigationPart & {
  kind: 'initial' | 'patch'
} => part.kind === 'initial' || part.kind === 'patch'

export const createMultipartPartialNavigationSink = (
  document: Document,
  options: PartialNavigationSinkOptions = {}
): PartialNavigationSink => {
  const parser = options.parser ?? defaultParser(document)
  const patcher = createPartialDOMPatcher(document)

  return {
    async apply(response, signal) {
      let initialApplied = false
      for await (const part of parseMultipartResponse(response, signal)) {
        ensureNotAborted(signal)
        if (!isPartKind(part)) {
          throw new TypeError('Unknown Hono partial-navigation multipart part')
        }
        if (part.kind === 'initial') {
          if (initialApplied) {
            throw new TypeError('Duplicate Hono partial-navigation initial part')
          }
          const root = patcher.replaceRoot(parser.parse(part.body), signal)
          initialApplied = true
          options.afterUpdate?.(root)
        } else {
          if (!initialApplied) {
            throw new TypeError('Hono partial-navigation patch arrived before initial part')
          }
          const root = patcher.applySuspense(parser.parse(part.body), signal)
          if (root) {
            options.afterUpdate?.(root)
          }
        }
      }
      if (!initialApplied) {
        throw new TypeError('Hono partial-navigation response has no initial part')
      }
    },
  }
}
