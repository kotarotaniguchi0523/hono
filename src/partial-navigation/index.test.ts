import { JSDOM } from 'jsdom'
import { PARTIAL_NAVIGATION_ACCEPT, PARTIAL_NAVIGATION_HEADER } from './constants'
import {
  createMultipartBoundary,
  encodeMultipartEnd,
  encodeMultipartPart,
  parseMultipartResponse,
} from './multipart'
import { createNavigationRequest, createPartialNavigation, shouldIntercept } from './navigation'
import { createMultipartPartialNavigationSink } from './sink'

const combine = (...chunks: Uint8Array[]): Uint8Array => {
  const result = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

const byteSplitResponse = (bytes: Uint8Array, contentType: string): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of bytes) {
          controller.enqueue(new Uint8Array([byte]))
        }
        controller.close()
      },
    }),
    { headers: { 'Content-Type': contentType } }
  )

const multipartResponse = (boundary: string, ...parts: Uint8Array[]): Response =>
  new Response(new TextDecoder().decode(combine(...parts)), {
    headers: { 'Content-Type': `multipart/mixed; boundary="${boundary}"` },
  })

describe('partial navigation multipart transport', () => {
  it('parses parts when every byte and a UTF-8 character are split across chunks', async () => {
    const boundary = 'split-boundary'
    const body = `<main>こんにちは\r\n--${boundary}X\r\n--not-${boundary}</main>`
    const bytes = combine(
      encodeMultipartPart(boundary, 'initial', body),
      encodeMultipartPart(boundary, 'patch', '<template data-hono-target="H:0">完了</template>'),
      encodeMultipartEnd(boundary)
    )
    const response = byteSplitResponse(bytes, `multipart/mixed; boundary=${boundary}`)

    const parts = []
    for await (const part of parseMultipartResponse(response)) {
      parts.push(part)
    }

    expect(parts).toHaveLength(2)
    expect(parts[0].kind).toBe('initial')
    expect(parts[0].body).toBe(body)
    expect(parts[1].kind).toBe('patch')
    expect(parts[1].body).toContain('完了')
  })

  it('rejects truncated MIME framing', async () => {
    const response = new Response(
      '--broken\r\nContent-Type: text/html\r\nHono-Partial-Kind: initial\r\n\r\n<body>',
      { headers: { 'Content-Type': 'multipart/mixed; boundary=broken' } }
    )

    await expect(async () => {
      for await (const _part of parseMultipartResponse(response)) {
        // Drain the parser.
      }
    }).rejects.toThrow('Truncated multipart response')
  })

  it('rejects malformed part headers and preserves empty part bodies', async () => {
    const malformed = new Response('--bad\r\nnot-a-header\r\n\r\n', {
      headers: { 'Content-Type': 'multipart/mixed; boundary=bad' },
    })
    await expect(async () => {
      for await (const _part of parseMultipartResponse(malformed)) {
        // Drain the parser.
      }
    }).rejects.toThrow('Malformed multipart header')

    const boundary = 'empty-boundary'
    const empty = byteSplitResponse(
      combine(encodeMultipartPart(boundary, 'initial', ''), encodeMultipartEnd(boundary)),
      `multipart/mixed; boundary=${boundary}`
    )
    const parts = []
    for await (const part of parseMultipartResponse(empty)) {
      parts.push(part)
    }
    expect(parts).toHaveLength(1)
    expect(parts[0].body).toBe('')
  })
})

describe('partial navigation DOM sink', () => {
  it('replaces only the marker range and preserves explicitly keyed nodes', async () => {
    const dom = new JSDOM(
      '<body><header>Shell</header><!--hono-partial:start--><input data-hono-preserve="editor" value="local"><p>Old</p><!--hono-partial:end--><footer>Footer</footer></body>'
    )
    const existingInput = dom.window.document.querySelector('input')
    const boundary = 'dom-boundary'
    const response = multipartResponse(
      boundary,
      encodeMultipartPart(
        boundary,
        'initial',
        '<input data-hono-preserve="editor" value="server"><p>New</p>'
      ),
      encodeMultipartEnd(boundary)
    )
    const updates: Node[] = []

    await createMultipartPartialNavigationSink(dom.window.document, {
      afterUpdate: (root) => updates.push(root),
    }).apply(response, new AbortController().signal)

    expect(dom.window.document.body.innerHTML).toBe(
      '<header>Shell</header><!--hono-partial:start--><input data-hono-preserve="editor" value="local"><p>New</p><!--hono-partial:end--><footer>Footer</footer>'
    )
    expect(dom.window.document.querySelector('input')).toBe(existingInput)
    expect(updates).toHaveLength(1)
  })

  it('applies Suspense patches without executing scripts', async () => {
    const dom = new JSDOM(
      '<body><main><!--hono-partial:start--><template id="H:0"></template><span>Loading</span><!--/$--><!--hono-partial:end--></main><script>window.executed = true</script></body>',
      { runScripts: 'dangerously' }
    )
    const boundary = 'suspense-boundary'
    const response = multipartResponse(
      boundary,
      encodeMultipartPart(
        boundary,
        'initial',
        '<template id="H:1"></template><span>Loading 2</span><!--/$-->'
      ),
      encodeMultipartPart(
        boundary,
        'patch',
        '<template data-hono-target="H:1"><strong>Done</strong><script>window.patchExecuted = true</script></template>'
      ),
      encodeMultipartEnd(boundary)
    )

    await createMultipartPartialNavigationSink(dom.window.document).apply(
      response,
      new AbortController().signal
    )

    expect(dom.window.document.body.innerHTML).toContain('<strong>Done</strong>')
    expect((dom.window as unknown as { patchExecuted?: boolean }).patchExecuted).toBeUndefined()
    expect((dom.window as unknown as { executed?: boolean }).executed).toBe(true)
  })

  it('resolves Suspense targets independently when patches arrive out of order', async () => {
    const dom = new JSDOM(
      '<body><!--hono-partial:start--><template id="H:0"></template><i>Loading 0</i><!--/$--><template id="H:1"></template><i>Loading 1</i><!--/$--><!--hono-partial:end--></body>'
    )
    const boundary = 'out-of-order-boundary'
    const response = multipartResponse(
      boundary,
      encodeMultipartPart(
        boundary,
        'initial',
        '<template id="H:0"></template><i>Loading 0</i><!--/$--><template id="H:1"></template><i>Loading 1</i><!--/$-->'
      ),
      encodeMultipartPart(
        boundary,
        'patch',
        '<template data-hono-target="H:1"><b>One</b></template>'
      ),
      encodeMultipartPart(
        boundary,
        'patch',
        '<template data-hono-target="H:0"><b>Zero</b></template>'
      ),
      encodeMultipartEnd(boundary)
    )

    await createMultipartPartialNavigationSink(dom.window.document).apply(
      response,
      new AbortController().signal
    )

    expect(dom.window.document.body.innerHTML).toContain('<b>Zero</b>')
    expect(dom.window.document.body.innerHTML).toContain('<b>One</b>')
    expect(dom.window.document.body.innerHTML).not.toContain('Loading 0')
    expect(dom.window.document.body.innerHTML).not.toContain('Loading 1')
  })

  it('does not mutate the document after cancellation', async () => {
    const dom = new JSDOM('<body><!--hono-partial:start--><p>Old</p><!--hono-partial:end--></body>')
    const boundary = 'abort-boundary'
    const response = multipartResponse(
      boundary,
      encodeMultipartPart(boundary, 'initial', '<p>New</p>'),
      encodeMultipartEnd(boundary)
    )
    const controller = new AbortController()
    controller.abort()

    await expect(
      createMultipartPartialNavigationSink(dom.window.document).apply(response, controller.signal)
    ).rejects.toThrow()
    expect(dom.window.document.body.innerHTML).toContain('<p>Old</p>')
  })

  it('rejects a response when route markers are missing', async () => {
    const dom = new JSDOM('<body><p>Old</p></body>')
    const boundary = 'missing-markers-boundary'
    const response = multipartResponse(
      boundary,
      encodeMultipartPart(boundary, 'initial', '<p>New</p>'),
      encodeMultipartEnd(boundary)
    )

    await expect(
      createMultipartPartialNavigationSink(dom.window.document).apply(
        response,
        new AbortController().signal
      )
    ).rejects.toThrow('route markers are missing or duplicated')
    expect(dom.window.document.body.innerHTML).toBe('<p>Old</p>')
  })
})

describe('partial navigation request adapter', () => {
  const makeEvent = (init: Partial<NavigateEvent>): NavigateEvent =>
    ({
      canIntercept: true,
      destination: destinationFor('https://example.com/about'),
      downloadRequest: null,
      formData: null,
      hashChange: false,
      signal: new AbortController().signal,
      sourceElement: null,
      ...init,
    }) as NavigateEvent

  const destinationFor = (url: string): NavigationDestination => ({ url }) as NavigationDestination

  it('uses the destination URL for GET navigation', async () => {
    const request = createNavigationRequest(
      makeEvent({ destination: destinationFor('https://example.com/search?q=%E3%81%82') })
    )
    expect(request.method).toBe('GET')
    expect(request.url).toBe('https://example.com/search?q=%E3%81%82')
    expect(request.headers.get(PARTIAL_NAVIGATION_HEADER)).toBe('1')
    expect(request.headers.get('Accept')).toBe(PARTIAL_NAVIGATION_ACCEPT)
    expect(await request.text()).toBe('')
  })

  it('serializes urlencoded, multipart, and text/plain POST forms', async () => {
    const dom = new JSDOM('<form method="post"><input name="name" value="Hono"></form>')
    const form = dom.window.document.querySelector('form')!
    const formData = new FormData()
    formData.append('name', 'Hono')

    const urlencoded = createNavigationRequest(makeEvent({ sourceElement: form, formData }))
    expect(urlencoded.headers.get('Content-Type')).toBe(
      'application/x-www-form-urlencoded;charset=UTF-8'
    )
    expect(await urlencoded.text()).toBe('name=Hono')

    form.setAttribute('enctype', 'multipart/form-data')
    const multipart = createNavigationRequest(makeEvent({ sourceElement: form, formData }))
    expect(multipart.headers.get('Content-Type')).toMatch(/^multipart\/form-data; boundary=/)
    expect(await multipart.formData()).toEqual(formData)

    form.setAttribute('enctype', 'text/plain')
    const text = createNavigationRequest(makeEvent({ sourceElement: form, formData }))
    expect(text.headers.get('Content-Type')).toBe('text/plain')
    expect(await text.text()).toBe('name=Hono\r\n')
  })

  it('only intercepts same-origin non-hash navigations', () => {
    const sameOrigin = makeEvent({ destination: destinationFor('https://example.com/about') })
    const hash = makeEvent({
      destination: destinationFor('https://example.com/about#section'),
      hashChange: true,
    })
    const external = makeEvent({ destination: destinationFor('https://other.example/about') })
    expect(shouldIntercept(sameOrigin, new URL('https://example.com/'))).toBe(true)
    expect(shouldIntercept(hash, new URL('https://example.com/'))).toBe(false)
    expect(shouldIntercept(external, new URL('https://example.com/'))).toBe(false)
  })

  it('connects a navigation event to the multipart sink', async () => {
    const dom = new JSDOM(
      '<body><!--hono-partial:start--><p>Old</p><!--hono-partial:end--></body>',
      { url: 'https://example.com/' }
    )
    const listeners = new Set<(event: NavigateEvent) => void>()
    const navigation = {
      addEventListener(_type: string, listener: (event: NavigateEvent) => void) {
        listeners.add(listener)
      },
      removeEventListener(_type: string, listener: (event: NavigateEvent) => void) {
        listeners.delete(listener)
      },
    } as unknown as Navigation
    const boundary = createMultipartBoundary()
    const fetch = vi.fn(async () =>
      multipartResponse(
        boundary,
        encodeMultipartPart(boundary, 'initial', '<p>New</p>'),
        encodeMultipartEnd(boundary)
      )
    )
    let interceptOptions: NavigationInterceptOptions | undefined
    const event = makeEvent({
      destination: destinationFor('https://example.com/new'),
      intercept(options) {
        interceptOptions = options
      },
    })

    const dispose = createPartialNavigation({
      document: dom.window.document,
      navigation,
      fetch,
    })
    for (const listener of listeners) {
      listener(event)
    }
    expect(interceptOptions).toBeDefined()
    await interceptOptions!.precommitHandler!({
      addHandler: () => undefined,
      redirect: () => undefined,
    })
    await interceptOptions!.handler!()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(dom.window.document.body.innerHTML).toContain('<p>New</p>')
    dispose()
    expect(listeners).toHaveLength(0)
  })

  it('redirects before touching the current route range', async () => {
    const dom = new JSDOM(
      '<body><!--hono-partial:start--><p>Old</p><!--hono-partial:end--></body>',
      { url: 'https://example.com/' }
    )
    const listeners = new Set<(event: NavigateEvent) => void>()
    const navigation = {
      addEventListener(_type: string, listener: (event: NavigateEvent) => void) {
        listeners.add(listener)
      },
      removeEventListener(_type: string, listener: (event: NavigateEvent) => void) {
        listeners.delete(listener)
      },
    } as unknown as Navigation
    const redirectedResponse = new Response(null, { status: 302 })
    Object.defineProperty(redirectedResponse, 'redirected', { value: true })
    Object.defineProperty(redirectedResponse, 'url', {
      value: 'https://example.com/login',
    })
    const fetch = vi.fn(async () => redirectedResponse)
    const redirect = vi.fn()
    let interceptOptions: NavigationInterceptOptions | undefined
    const event = makeEvent({
      destination: destinationFor('https://example.com/account'),
      intercept(options) {
        interceptOptions = options
      },
    })
    const dispose = createPartialNavigation({ document: dom.window.document, navigation, fetch })
    for (const listener of listeners) {
      listener(event)
    }

    await interceptOptions!.precommitHandler!({ addHandler: () => undefined, redirect })
    await interceptOptions!.handler!()

    expect(redirect).toHaveBeenCalledWith('https://example.com/login', { history: 'replace' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(dom.window.document.body.innerHTML).toContain('<p>Old</p>')
    dispose()
  })

  it('reports a malformed response without reloading or mutating the range', async () => {
    const dom = new JSDOM(
      '<body><!--hono-partial:start--><p>Old</p><!--hono-partial:end--></body>',
      { url: 'https://example.com/' }
    )
    const listeners = new Set<(event: NavigateEvent) => void>()
    const navigation = {
      addEventListener(_type: string, listener: (event: NavigateEvent) => void) {
        listeners.add(listener)
      },
      removeEventListener(_type: string, listener: (event: NavigateEvent) => void) {
        listeners.delete(listener)
      },
    } as unknown as Navigation
    const boundary = 'malformed-boundary'
    const fetch = vi.fn(
      async () =>
        new Response(`--${boundary}--\r\n`, {
          headers: { 'Content-Type': `multipart/mixed; boundary=${boundary}` },
        })
    )
    const onError = vi.fn()
    let interceptOptions: NavigationInterceptOptions | undefined
    const event = makeEvent({
      destination: destinationFor('https://example.com/broken'),
      intercept(options) {
        interceptOptions = options
      },
    })
    const dispose = createPartialNavigation({
      document: dom.window.document,
      navigation,
      fetch,
      onError,
    })
    for (const listener of listeners) {
      listener(event)
    }

    await interceptOptions!.precommitHandler!({
      addHandler: () => undefined,
      redirect: () => undefined,
    })
    await expect(interceptOptions!.handler!()).rejects.toThrow(
      'partial-navigation response has no initial part'
    )
    expect(onError).toHaveBeenCalledTimes(1)
    expect(dom.window.document.body.innerHTML).toContain('<p>Old</p>')
    dispose()
  })
})
