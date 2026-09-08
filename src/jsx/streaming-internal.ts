/** @internal */

import { HtmlEscapedCallbackPhase, resolveCallback } from '../utils/html'
import type { HtmlEscapedString } from '../utils/html'
import { JSXNode } from './base'
import { createContext } from './context'
import type { Context as JSXContext } from './context'

/** @internal */
export const StreamingRenderModeContext: JSXContext<'document' | 'partial'> = createContext<
  'document' | 'partial'
>('document')

/** @internal */
export const renderToChunks = async function* (
  content: HtmlEscapedString | JSXNode | Promise<HtmlEscapedString>,
  onError: (e: unknown) => string | void = console.trace,
  signal?: AbortSignal
): AsyncGenerator<HtmlEscapedString> {
  try {
    if (content instanceof JSXNode) {
      // aJSXNode.toString() returns a string or Promise<string> and string is already escaped
      content = content.toString() as HtmlEscapedString | Promise<HtmlEscapedString>
    }
    const context = typeof content === 'object' ? content : {}
    const resolved = await resolveCallback(
      content,
      HtmlEscapedCallbackPhase.BeforeStream,
      true,
      context
    )
    if (signal?.aborted) {
      return
    }
    yield resolved as HtmlEscapedString

    const callbacks: Promise<HtmlEscapedString>[] = []
    const then = (promise: Promise<string>) => {
      callbacks.push(
        promise
          .catch((err) => {
            console.log(err)
            onError(err)
            return ''
          })
          .then(async (res) => {
            res = await resolveCallback(res, HtmlEscapedCallbackPhase.BeforeStream, true, context)
            ;(res as HtmlEscapedString).callbacks
              ?.map((c) => c({ phase: HtmlEscapedCallbackPhase.Stream, context }))
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .filter<Promise<string>>(Boolean as any)
              .forEach(then)
            return res as HtmlEscapedString
          })
      )
    }
    ;(resolved as HtmlEscapedString).callbacks
      ?.map((c) => c({ phase: HtmlEscapedCallbackPhase.Stream, context }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter<Promise<string>>(Boolean as any)
      .forEach(then)

    while (callbacks.length) {
      const completed = await Promise.race(
        callbacks.map((callback, index) => callback.then((chunk) => ({ chunk, index })))
      )
      callbacks.splice(completed.index, 1)
      if (signal?.aborted) {
        return
      }
      yield completed.chunk
    }
  } catch (e) {
    // maybe the connection was closed
    onError(e)
  }
}
