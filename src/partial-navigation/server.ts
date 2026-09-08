/** @module */

import type { JSXNode } from '../jsx'
import { renderToChunks } from '../jsx/streaming-internal'
import type { HtmlEscapedString } from '../utils/html'
import { createMultipartBoundary, encodeMultipartEnd, encodeMultipartPart } from './multipart'

export const renderToPartialNavigationStream = (
  content: HtmlEscapedString | JSXNode | Promise<HtmlEscapedString>,
  onError: (error: unknown) => string | void = console.trace,
  signal?: AbortSignal,
  boundary = createMultipartBoundary()
): ReadableStream<Uint8Array> => {
  const abortController = new AbortController()
  const onAbort = () => abortController.abort(signal?.reason)
  if (signal?.aborted) {
    abortController.abort(signal.reason)
  } else {
    signal?.addEventListener('abort', onAbort, { once: true })
  }
  let cancelled = false

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let first = true
        for await (const chunk of renderToChunks(content, onError, abortController.signal)) {
          if (cancelled || abortController.signal.aborted) {
            return
          }
          controller.enqueue(encodeMultipartPart(boundary, first ? 'initial' : 'patch', chunk))
          first = false
        }
        if (!cancelled && !abortController.signal.aborted) {
          controller.enqueue(encodeMultipartEnd(boundary))
        }
      } catch (error) {
        onError(error)
      } finally {
        signal?.removeEventListener('abort', onAbort)
      }

      if (!cancelled && !abortController.signal.aborted) {
        controller.close()
      }
    },
    cancel(reason) {
      cancelled = true
      abortController.abort(reason)
      signal?.removeEventListener('abort', onAbort)
    },
  })
}
