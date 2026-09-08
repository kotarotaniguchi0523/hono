/** @module */

import { PARTIAL_NAVIGATION_KIND_HEADER, PARTIAL_NAVIGATION_MIME } from './constants'

export type PartialNavigationPartKind = 'initial' | 'patch'

export type PartialNavigationPart = {
  kind: PartialNavigationPartKind
  headers: Headers
  body: string
}

const textEncoder = new TextEncoder()

let boundaryCounter = 0

export const createMultipartBoundary = (): string => {
  const random = new Uint32Array(2)
  const crypto = globalThis.crypto
  if (crypto?.getRandomValues) {
    crypto.getRandomValues(random)
  } else {
    random[0] = Math.floor(Math.random() * 0xffffffff)
    random[1] = Math.floor(Math.random() * 0xffffffff)
  }
  boundaryCounter++
  return `hono-partial-${Date.now().toString(36)}-${random[0].toString(36)}-${random[1].toString(36)}-${boundaryCounter.toString(36)}`
}

export const multipartContentType = (boundary: string): string =>
  `${PARTIAL_NAVIGATION_MIME}; boundary=${boundary}`

export const encodeMultipartPart = (
  boundary: string,
  kind: PartialNavigationPartKind,
  body: string
): Uint8Array =>
  textEncoder.encode(
    `--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\n${PARTIAL_NAVIGATION_KIND_HEADER}: ${kind}\r\n\r\n${body}\r\n`
  )

export const encodeMultipartEnd = (boundary: string): Uint8Array =>
  textEncoder.encode(`--${boundary}--\r\n`)

const getBoundaryFromContentType = (contentType: string | null): string | undefined => {
  if (!contentType || !contentType.toLowerCase().startsWith(PARTIAL_NAVIGATION_MIME)) {
    return
  }

  const match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)
  return match?.[1] ?? match?.[2]
}

const parsePartHeaders = (headerText: string): Headers => {
  const headers = new Headers()
  for (const line of headerText.split('\r\n')) {
    const separator = line.indexOf(':')
    if (separator <= 0) {
      throw new TypeError('Malformed multipart header')
    }
    headers.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }
  return headers
}

/**
 * Parse only the MIME framing. The HTML body is kept as text and is never
 * tokenized by this module.
 */
export const parseMultipartResponse = async function* (
  response: Response,
  signal?: AbortSignal
): AsyncGenerator<PartialNavigationPart> {
  const boundary = getBoundaryFromContentType(response.headers.get('Content-Type'))
  if (!boundary) {
    throw new TypeError('Response is not a Hono partial-navigation multipart response')
  }
  if (!response.body) {
    throw new TypeError('Partial-navigation response has no body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const delimiter = `\r\n--${boundary}`
  const opening = `--${boundary}`
  let buffer = ''
  let current: { headers: Headers; body: string } | undefined
  let sawClosingBoundary = false

  const ensureNotAborted = () => {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
    }
  }

  try {
    for (;;) {
      ensureNotAborted()
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })

      for (;;) {
        ensureNotAborted()

        if (!current) {
          const start = buffer.indexOf(opening)
          if (start < 0) {
            buffer = buffer.slice(Math.max(0, buffer.length - opening.length + 1))
            break
          }

          // Keep the opening delimiter until its closing marker is available.
          if (buffer.length < start + opening.length + 2) {
            buffer = buffer.slice(start)
            break
          }

          buffer = buffer.slice(start + opening.length)
          if (buffer.startsWith('--')) {
            sawClosingBoundary = true
            return
          }
          if (!buffer.startsWith('\r\n')) {
            throw new TypeError('Malformed multipart boundary')
          }
          buffer = buffer.slice(2)

          const headerEnd = buffer.indexOf('\r\n\r\n')
          if (headerEnd < 0) {
            // Re-add the delimiter so a header split across network chunks is
            // handled without special state.
            buffer = `${opening}\r\n${buffer}`
            break
          }
          current = {
            headers: parsePartHeaders(buffer.slice(0, headerEnd)),
            body: '',
          }
          buffer = buffer.slice(headerEnd + 4)
          continue
        }

        let end = buffer.indexOf(delimiter)
        let waitingForBoundarySuffix = false
        while (end >= 0) {
          const suffixStart = end + delimiter.length
          if (buffer.length < suffixStart + 2) {
            // Keep a candidate until its two-byte suffix is available. A
            // boundary is valid only when it is followed by CRLF or `--`.
            current.body += buffer.slice(0, end)
            buffer = buffer.slice(end)
            waitingForBoundarySuffix = true
            break
          }

          const suffix = buffer.slice(suffixStart, suffixStart + 2)
          if (suffix !== '\r\n' && suffix !== '--') {
            // This is boundary-looking text inside the HTML body, not a MIME
            // delimiter. Consume the candidate and continue searching.
            current.body += buffer.slice(0, suffixStart)
            buffer = buffer.slice(suffixStart)
            end = buffer.indexOf(delimiter)
            continue
          }

          // The delimiter starts with CRLF. That CRLF belongs to the MIME
          // framing, not to the HTML part body.
          current.body += buffer.slice(0, end)
          buffer = buffer.slice(end + 2)

          const part = current
          current = undefined
          yield {
            kind: part.headers.get(PARTIAL_NAVIGATION_KIND_HEADER) as PartialNavigationPartKind,
            headers: part.headers,
            body: part.body,
          }
          break
        }

        if (waitingForBoundarySuffix) {
          break
        }
        if (current && end < 0) {
          // Retain enough bytes for a delimiter split across chunks.
          const keep = delimiter.length - 1
          if (buffer.length > keep) {
            current.body += buffer.slice(0, buffer.length - keep)
            buffer = buffer.slice(buffer.length - keep)
          }
          break
        }
      }

      if (done) {
        break
      }
    }

    buffer += decoder.decode()
    if (current || !sawClosingBoundary) {
      throw new TypeError('Truncated multipart response')
    }
  } finally {
    if (signal?.aborted) {
      await reader.cancel(signal.reason).catch(() => undefined)
    }
  }
}
