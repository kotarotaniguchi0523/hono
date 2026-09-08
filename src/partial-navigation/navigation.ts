/** @module */

import {
  PARTIAL_NAVIGATION_ACCEPT,
  PARTIAL_NAVIGATION_HEADER,
  PARTIAL_NAVIGATION_HEADER_VALUE,
} from './constants'
import { hasPartialNavigationRange } from './patch'
import { createMultipartPartialNavigationSink } from './sink'
import type { HTMLFragmentParser } from './sink'

export type PartialNavigationOptions = {
  onError?: (error: unknown) => void
  afterUpdate?: (root: Node) => void
  /** @internal */
  document?: Document
  /** @internal */
  navigation?: Navigation
  /** @internal */
  fetch?: typeof fetch
  /** @internal */
  parser?: HTMLFragmentParser
}

const getForm = (source: Element | null): HTMLFormElement | undefined => {
  if (!source) {
    return
  }
  if (typeof HTMLFormElement !== 'undefined' && source instanceof HTMLFormElement) {
    return source
  }
  const form = (source as HTMLButtonElement | HTMLInputElement).form
  if (form) {
    return form
  }
  return source.closest('form') ?? undefined
}

const getSubmitterAttribute = (source: Element | null, name: string): string | undefined => {
  const value = source?.getAttribute(name)
  return value || undefined
}

const formValueToString = (value: FormDataEntryValue): string =>
  typeof value === 'string' ? value : value.name

const serializeTextPlain = (formData: FormData): string => {
  let text = ''
  for (const [name, value] of formData.entries()) {
    text += `${name}=${formValueToString(value)}\r\n`
  }
  return text
}

const serializeUrlEncoded = (formData: FormData): URLSearchParams => {
  const params = new URLSearchParams()
  for (const [name, value] of formData.entries()) {
    params.append(name, formValueToString(value))
  }
  return params
}

export const createNavigationRequest = (event: NavigateEvent): Request => {
  const source = event.sourceElement
  const form = getForm(source)
  const method = (
    getSubmitterAttribute(source, 'formmethod') ??
    form?.getAttribute('method') ??
    form?.method ??
    'get'
  ).toUpperCase()
  const headers = new Headers({
    Accept: PARTIAL_NAVIGATION_ACCEPT,
    [PARTIAL_NAVIGATION_HEADER]: PARTIAL_NAVIGATION_HEADER_VALUE,
  })

  if (event.formData === null || method === 'GET') {
    return new Request(event.destination.url, {
      method: 'GET',
      headers,
      signal: event.signal,
    })
  }

  if (method !== 'POST') {
    throw new TypeError(`Unsupported form method for partial navigation: ${method}`)
  }

  const enctype = (
    getSubmitterAttribute(source, 'formenctype') ??
    form?.getAttribute('enctype') ??
    form?.enctype ??
    'application/x-www-form-urlencoded'
  ).toLowerCase()
  let body: BodyInit
  if (enctype === 'multipart/form-data') {
    body = event.formData
  } else if (enctype === 'text/plain') {
    body = serializeTextPlain(event.formData)
    headers.set('Content-Type', 'text/plain')
  } else {
    body = serializeUrlEncoded(event.formData)
    headers.set('Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8')
  }

  return new Request(event.destination.url, {
    method,
    headers,
    body,
    signal: event.signal,
  })
}

export const shouldIntercept = (
  event: NavigateEvent,
  currentLocation: Location | URL = globalThis.location
): boolean => {
  if (!event.canIntercept || event.hashChange || event.downloadRequest != null) {
    return false
  }
  const destination = new URL(event.destination.url, currentLocation.href)
  return destination.origin === currentLocation.origin
}

const getNavigation = (): Navigation | undefined => {
  const global = globalThis as typeof globalThis & { navigation?: Navigation }
  return global.navigation ?? global.window?.navigation
}

const getDocument = (): Document | undefined => {
  const global = globalThis as typeof globalThis & { document?: Document }
  return global.document ?? global.window?.document
}

const navigateTo = (location: Location, url: string): void => {
  location.href = url
}

const isMultipartResponse = (response: Response): boolean =>
  response.headers.get('Content-Type')?.toLowerCase().startsWith('multipart/mixed') === true

export const createPartialNavigation = (options: PartialNavigationOptions = {}): (() => void) => {
  const document = options.document ?? getDocument()
  const navigation = options.navigation ?? getNavigation()
  if (!document || !navigation || !hasPartialNavigationRange(document)) {
    return () => undefined
  }

  const location = document.defaultView?.location ?? globalThis.location
  const fetcher = options.fetch ?? globalThis.fetch
  if (!location || !fetcher) {
    return () => undefined
  }

  const onNavigate = (event: NavigateEvent) => {
    if (!shouldIntercept(event, location)) {
      return
    }

    let response: Response | undefined
    let redirected = false
    event.intercept({
      precommitHandler: async (controller) => {
        try {
          response = await fetcher(createNavigationRequest(event))
          if (response.redirected) {
            const redirectedUrl = new URL(response.url, location.href)
            redirected = true
            if (redirectedUrl.origin !== location.origin) {
              navigateTo(location, redirectedUrl.href)
            } else {
              controller.redirect(redirectedUrl.href, { history: 'replace' })
            }
          }
        } catch (error) {
          options.onError?.(error)
          throw error
        }
      },
      handler: async () => {
        try {
          if (redirected) {
            return
          }
          response ||= await fetcher(createNavigationRequest(event))
          if (!isMultipartResponse(response)) {
            navigateTo(location, response.url || event.destination.url)
            return
          }
          await createMultipartPartialNavigationSink(document, {
            parser: options.parser,
            afterUpdate: options.afterUpdate,
          }).apply(response, event.signal)
        } catch (error) {
          options.onError?.(error)
          throw error
        }
      },
    })
  }

  navigation.addEventListener('navigate', onNavigate)
  return () => navigation.removeEventListener('navigate', onNavigate)
}
