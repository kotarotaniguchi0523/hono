/** @module */

import { PARTIAL_NAVIGATION_END_MARKER, PARTIAL_NAVIGATION_START_MARKER } from './constants'

const SHOW_COMMENT = 128

const ensureNotAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
  }
}

const findComments = (document: Document, value: string): Comment[] => {
  const comments: Comment[] = []
  const walker = document.createTreeWalker(document, SHOW_COMMENT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if ((node as Comment).data === value) {
      comments.push(node as Comment)
    }
  }
  return comments
}

const findRouteRange = (document: Document): { start: Comment; end: Comment } => {
  const starts = findComments(document, PARTIAL_NAVIGATION_START_MARKER)
  const ends = findComments(document, PARTIAL_NAVIGATION_END_MARKER)
  if (starts.length !== 1 || ends.length !== 1) {
    throw new Error('Hono partial-navigation route markers are missing or duplicated')
  }
  return { start: starts[0], end: ends[0] }
}

export const hasPartialNavigationRange = (document: Document): boolean => {
  return (
    findComments(document, PARTIAL_NAVIGATION_START_MARKER).length === 1 &&
    findComments(document, PARTIAL_NAVIGATION_END_MARKER).length === 1
  )
}

const getPreserveKey = (element: Element): string => {
  const key = element.getAttribute('data-hono-preserve')
  if (!key) {
    throw new Error('data-hono-preserve requires a non-empty key')
  }
  return key
}

const preserveExistingNodes = (document: Document, range: Range, fragment: DocumentFragment) => {
  const existing = new Map<string, Element>()
  for (const element of Array.from(document.querySelectorAll('[data-hono-preserve]'))) {
    if (!range.intersectsNode(element)) {
      continue
    }
    const key = getPreserveKey(element)
    if (existing.has(key)) {
      throw new Error(`Duplicate data-hono-preserve key: ${key}`)
    }
    existing.set(key, element)
  }

  const incoming = new Map<string, Element>()
  for (const element of Array.from(fragment.querySelectorAll('[data-hono-preserve]'))) {
    const key = getPreserveKey(element)
    if (incoming.has(key)) {
      throw new Error(`Duplicate data-hono-preserve key: ${key}`)
    }
    incoming.set(key, element)

    const current = existing.get(key)
    if (current && current.tagName.toLowerCase() === element.tagName.toLowerCase()) {
      element.replaceWith(current)
    }
  }
}

const isComment = (node: Node | null, value: string): node is Comment =>
  !!node && node.nodeType === 8 && (node as Comment).data === value

export interface PartialDOMPatcher {
  replaceRoot(fragment: DocumentFragment, signal?: AbortSignal): Node
  applySuspense(fragment: DocumentFragment, signal?: AbortSignal): Node | undefined
}

export const createPartialDOMPatcher = (document: Document): PartialDOMPatcher => ({
  replaceRoot(fragment, signal) {
    ensureNotAborted(signal)
    const { start, end } = findRouteRange(document)
    const range = document.createRange()
    range.setStartAfter(start)
    range.setEndBefore(end)
    preserveExistingNodes(document, range, fragment)
    ensureNotAborted(signal)

    const parent = end.parentNode
    if (!parent) {
      throw new Error('Hono partial-navigation end marker is detached')
    }
    range.deleteContents()
    parent.insertBefore(fragment, end)
    return parent
  },

  applySuspense(fragment, signal) {
    ensureNotAborted(signal)
    const templates = Array.from(
      fragment.querySelectorAll<HTMLTemplateElement>('template[data-hono-target]')
    )
    let updatedRoot: Node | undefined

    for (const template of templates) {
      ensureNotAborted(signal)
      const target = template.getAttribute('data-hono-target')
      if (!target) {
        continue
      }
      const placeholder = document.getElementById(target)
      if (!placeholder) {
        // This is expected when a navigation was superseded or a boundary was
        // already resolved by another response.
        continue
      }

      const endMarker = target.startsWith('E:') ? target : '/$'
      let sibling = placeholder.nextSibling
      let closing: Comment | undefined
      while (sibling) {
        const next = sibling.nextSibling
        if (isComment(sibling, endMarker)) {
          closing = sibling
          break
        }
        sibling.remove()
        sibling = next
      }
      if (!closing) {
        continue
      }

      const parent = closing.parentNode
      closing.remove()
      placeholder.replaceWith(template.content)
      updatedRoot ||= parent ?? undefined
    }

    return updatedRoot
  },
})
