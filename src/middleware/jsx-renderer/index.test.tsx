/** @jsxImportSource ../../jsx */
import { expectTypeOf } from 'vitest'
import { html } from '../../helper/html'
import { testClient } from '../../helper/testing'
import { Hono } from '../../hono'
import { ErrorBoundary } from '../../jsx'
import type { FC } from '../../jsx'
import { Suspense } from '../../jsx/streaming'
import { jsxRenderer, useRequestContext } from '.'

const RequestUrl: FC = () => {
  const c = useRequestContext()
  return html`${c.req.url}`
}

describe('JSX renderer', () => {
  it('basic', async () => {
    const app = new Hono()
    app.use(
      '*',
      jsxRenderer(({ children, title }) => (
        <html>
          <head>{title}</head>
          <body>{children}</body>
        </html>
      ))
    )
    app.get('/', (c) =>
      c.render(
        <h1>
          <RequestUrl />
        </h1>,
        { title: 'Title' }
      )
    )

    const app2 = new Hono()
    app2.use(
      '*',
      jsxRenderer(({ children }) => <div class='nested'>{children}</div>)
    )
    app2.get('/', (c) => c.render(<h1>http://localhost/nested</h1>, { title: 'Title' }))
    app.route('/nested', app2)

    let res = await app.request('http://localhost/')
    expect(res).not.toBeNull()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(
      '<!DOCTYPE html><html><head>Title</head><body><h1>http://localhost/</h1></body></html>'
    )

    res = await app.request('http://localhost/nested')
    expect(res).not.toBeNull()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(
      '<!DOCTYPE html><div class="nested"><h1>http://localhost/nested</h1></div>'
    )
  })

  it('accepts an array result', async () => {
    const app = new Hono()
    app.use(jsxRenderer(({ children }) => [<header>Header</header>, <main>{children}</main>]))
    app.get('/', (c) => c.render(<h1>Hello</h1>, { title: 'Hello' }))

    const res = await app.request('/')
    expect(await res.text()).toBe(
      '<!DOCTYPE html><header>Header</header><main><h1>Hello</h1></main>'
    )
  })

  it('does not accept a null result', () => {
    // @ts-expect-error A JSX renderer component must produce renderable content.
    jsxRenderer(() => null)
  })

  it('Should get the context object as a 2nd arg', async () => {
    const app = new Hono()
    app.use(
      jsxRenderer(
        ({ children }, c) => {
          return (
            <div>
              {children} at {c.req.path}
            </div>
          )
        },
        { docType: false }
      )
    )
    app.get('/hi', (c) => {
      return c.render('hi', { title: 'hi' })
    })

    const res = await app.request('/hi')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<div>hi at /hi</div>')
  })

  it('nested layout with Layout', async () => {
    const app = new Hono()
    app.use(
      '*',
      jsxRenderer(({ children, title, Layout }) => (
        <Layout>
          <html>
            <head>{title}</head>
            <body>{children}</body>
          </html>
        </Layout>
      ))
    )

    const app2 = new Hono()
    app2.use(
      '*',
      jsxRenderer(({ children, Layout, title }) => (
        <Layout title={title}>
          <div class='nested'>{children}</div>
        </Layout>
      ))
    )
    app2.get('/', (c) => c.render(<h1>http://localhost/nested</h1>, { title: 'Nested' }))

    const app3 = new Hono()
    app3.use(
      '*',
      jsxRenderer(({ children, Layout, title }) => (
        <Layout title={title}>
          <div class='nested2'>{children}</div>
        </Layout>
      ))
    )
    app3.get('/', (c) => c.render(<h1>http://localhost/nested</h1>, { title: 'Nested2' }))
    app2.route('/nested2', app3)

    app.route('/nested', app2)

    let res = await app.request('http://localhost/nested')
    expect(res).not.toBeNull()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(
      '<!DOCTYPE html><html><head>Nested</head><body><div class="nested"><h1>http://localhost/nested</h1></div></body></html>'
    )

    res = await app.request('http://localhost/nested/nested2')
    expect(res).not.toBeNull()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(
      '<!DOCTYPE html><html><head>Nested2</head><body><div class="nested"><div class="nested2"><h1>http://localhost/nested</h1></div></div></body></html>'
    )
  })

  it('Should return a default doctype', async () => {
    const app = new Hono()
    app.use(
      '*',
      jsxRenderer(
        ({ children }) => {
          return (
            <html>
              <body>{children}</body>
            </html>
          )
        },
        { docType: true }
      )
    )
    app.get('/', (c) => c.render(<h1>Hello</h1>, { title: 'Title' }))
    const res = await app.request('/')
    expect(res).not.toBeNull()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<!DOCTYPE html><html><body><h1>Hello</h1></body></html>')
  })

  it('Should return a non includes doctype', async () => {
    const app = new Hono()
    app.use(
      '*',
      jsxRenderer(
        ({ children }) => {
          return (
            <html>
              <body>{children}</body>
            </html>
          )
        },
        { docType: false }
      )
    )
    app.get('/', (c) => c.render(<h1>Hello</h1>, { title: 'Title' }))
    const res = await app.request('/')
    expect(res).not.toBeNull()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<html><body><h1>Hello</h1></body></html>')
  })

  it('Should return a custom doctype', async () => {
    const app = new Hono()
    app.use(
      '*',
      jsxRenderer(
        ({ children }) => {
          return (
            <html>
              <body>{children}</body>
            </html>
          )
        },
        {
          docType:
            '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">',
        }
      )
    )
    app.get('/', (c) => c.render(<h1>Hello</h1>, { title: 'Title' }))
    const res = await app.request('/')
    expect(res).not.toBeNull()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html><body><h1>Hello</h1></body></html>'
    )
  })

  it('Should return as streaming content with default headers', async () => {
    const app = new Hono()
    app.use(
      '*',
      jsxRenderer(
        ({ children }) => {
          return (
            <html>
              <body>{children}</body>
            </html>
          )
        },
        {
          docType: true,
          stream: true,
        }
      )
    )
    const AsyncComponent = async () => {
      const c = useRequestContext()
      return <p>Hello {c.req.query('name')}!</p>
    }
    app.get('/', (c) =>
      c.render(
        <Suspense fallback={<p>Loading...</p>}>
          <AsyncComponent />
        </Suspense>,
        { title: 'Title' }
      )
    )
    const res = await app.request('/?name=Hono')
    expect(res).not.toBeNull()
    expect(res.status).toBe(200)
    expect(res.headers.get('Transfer-Encoding')).toEqual('chunked')
    expect(res.headers.get('Content-Type')).toEqual('text/html; charset=UTF-8')
    expect(res.headers.get('Content-Encoding')).toEqual('Identity')

    if (!res.body) {
      throw new Error('Body is null')
    }

    const chunk: string[] = []
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) {
        break
      }
      chunk.push(decoder.decode(value))
    }
    expect(chunk).toEqual([
      '<!DOCTYPE html><html><body><template id="H:0"></template><p>Loading...</p><!--/$--></body></html>',
      `<template data-hono-target="H:0"><p>Hello Hono!</p></template><script>
((d,c,n) => {
c=d.currentScript.previousSibling
d=d.getElementById('H:0')
if(!d)return
do{n=d.nextSibling;n.remove()}while(n.nodeType!=8||n.nodeValue!='/$')
d.replaceWith(c.content)
})(document)
</script>`,
    ])
  })

  // this test relies upon 'Should return as streaming content with default headers'
  // this should be refactored to prevent tests depending on each other
  it('Should return as streaming content with custom headers', async () => {
    const app = new Hono()
    app.use(
      '*',
      jsxRenderer(
        ({ children }) => {
          return (
            <html>
              <body>{children}</body>
            </html>
          )
        },
        {
          docType: true,
          stream: {
            'Transfer-Encoding': 'chunked',
            'Content-Type': 'text/html',
          },
        }
      )
    )
    const AsyncComponent = async () => {
      const c = useRequestContext()
      return <p>Hello {c.req.query('name')} again!</p>
    }
    app.get('/', (c) =>
      c.render(
        <Suspense fallback={<p>Loading...</p>}>
          <AsyncComponent />
        </Suspense>,
        { title: 'Title' }
      )
    )
    const res = await app.request('/?name=Hono')
    expect(res).not.toBeNull()
    expect(res.status).toBe(200)
    expect(res.headers.get('Transfer-Encoding')).toEqual('chunked')
    expect(res.headers.get('Content-Type')).toEqual('text/html')

    if (!res.body) {
      throw new Error('Body is null')
    }

    const chunk: string[] = []
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) {
        break
      }
      chunk.push(decoder.decode(value))
    }
    expect(chunk).toEqual([
      '<!DOCTYPE html><html><body><template id="H:1"></template><p>Loading...</p><!--/$--></body></html>',
      `<template data-hono-target="H:1"><p>Hello Hono again!</p></template><script>
((d,c,n) => {
c=d.currentScript.previousSibling
d=d.getElementById('H:1')
if(!d)return
do{n=d.nextSibling;n.remove()}while(n.nodeType!=8||n.nodeValue!='/$')
d.replaceWith(c.content)
})(document)
</script>`,
    ])
  })

  it('Should return as streaming content with headers added in a handler', async () => {
    const app = new Hono()
    app.use(jsxRenderer(async ({ children }) => <div>{children}</div>, { stream: true }))
    app.get('/', (c) => {
      c.header('X-Message-Set', 'Hello')
      c.header('X-Message-Append', 'Hello', { append: true })
      return c.render('Hi', { title: 'Hi' })
    })
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('Transfer-Encoding')).toBe('chunked')
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=UTF-8')
    expect(res.headers.get('X-Message-Set')).toBe('Hello')
    expect(res.headers.get('X-Message-Append')).toBe('Hello')
    expect(await res.text()).toBe('<!DOCTYPE html><div>Hi</div>')
  })

  it('should render a partial-navigation response without re-rendering the layout', async () => {
    const app = new Hono()
    app.use(
      '*',
      jsxRenderer(
        ({ children }) => (
          <html>
            <body>
              <header>Shell</header>
              <main>{children}</main>
              <footer>Footer</footer>
            </body>
          </html>
        ),
        { partialNavigation: true }
      )
    )
    const routes = app
      .get('/', (c) => c.render(<p>Home</p>, { title: 'Home' }))
      .get('/about', (c) => {
        c.status(201)
        c.header('X-Route', 'about')
        return c.render(
          <>
            <p>About</p>
            <RequestUrl />
          </>,
          { title: 'About' }
        )
      })

    const fullResponse = await routes.request('/')
    expect(await fullResponse.text()).toBe(
      '<!DOCTYPE html><html><body><header>Shell</header><main><!--hono-partial:start--><p>Home</p><!--hono-partial:end--></main><footer>Footer</footer></body></html>'
    )

    const partialResponse = await testClient(routes, undefined, undefined, {
      headers: {
        Accept: 'multipart/mixed; type="text/html"',
        'X-Hono-Partial-Navigation': '1',
      },
    }).about.$get()
    const partialText = await partialResponse.text()
    expect(partialResponse.status).toBe(201)
    expect(partialResponse.headers.get('X-Route')).toBe('about')
    expect(partialResponse.headers.get('Content-Type')).toMatch(/^multipart\/mixed;/)
    expect(partialText).toContain('Hono-Partial-Kind: initial')
    expect(partialText).toContain('<p>About</p>')
    expect(partialText).toContain('http://localhost/about')
    expect(partialText).not.toContain('<header>Shell</header>')
    expect(partialText).not.toContain('<html>')
    expect(partialText).not.toContain('hono-partial:start')
  })

  it('should use partial streaming output for Suspense even when stream is disabled', async () => {
    const app = new Hono()
    app.use(
      '*',
      jsxRenderer(
        ({ children }) => (
          <html>
            <body>{children}</body>
          </html>
        ),
        {
          partialNavigation: true,
          stream: false,
        }
      )
    )
    const AsyncContent = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return <strong>Ready</strong>
    }
    const routes = app.get('/async', (c) =>
      c.render(
        <Suspense fallback={<span>Loading</span>}>
          <AsyncContent />
        </Suspense>,
        { title: 'Async' }
      )
    )
    const response = await testClient(routes, undefined, undefined, {
      headers: {
        Accept: 'multipart/mixed; type="text/html"',
        'X-Hono-Partial-Navigation': '1',
      },
    }).async.$get()

    const chunks: string[] = []
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Expected a response body')
    }
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      chunks.push(decoder.decode(value))
    }

    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toContain('Hono-Partial-Kind: initial')
    expect(chunks[0]).toContain('Loading')
    expect(chunks[1]).toContain('Hono-Partial-Kind: patch')
    expect(chunks[1]).toContain('<template data-hono-target="H:')
    expect(chunks[1]).toContain('<strong>Ready</strong>')
    expect(chunks[1]).not.toContain('<script')
  })

  it('should suppress ErrorBoundary replacement scripts in partial mode', async () => {
    const app = new Hono()
    app.use(
      '*',
      jsxRenderer(({ children }) => <main>{children}</main>, { partialNavigation: true })
    )
    const FailingContent = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      throw new Error('failed')
    }
    const routes = app.get('/error', (c) =>
      c.render(
        <ErrorBoundary fallback={<p>Failed</p>}>
          <FailingContent />
        </ErrorBoundary>,
        { title: 'Error' }
      )
    )
    const response = await testClient(routes, undefined, undefined, {
      headers: {
        Accept: 'multipart/mixed; type="text/html"',
        'X-Hono-Partial-Navigation': '1',
      },
    }).error.$get()
    const text = await response.text()

    expect(text).toContain('Failed')
    expect(text).not.toContain('<script')
  })

  it('Env', async () => {
    type JSXRendererEnv = {
      Variables: {
        foo: string
      }
      Bindings: {
        bar: string
      }
    }

    const VariableFoo: FC = () => {
      const c = useRequestContext<JSXRendererEnv>()
      expectTypeOf(c.get('foo')).toEqualTypeOf<string>()
      return html`${c.get('foo')}`
    }

    const BindingsBar: FC = () => {
      const c = useRequestContext<JSXRendererEnv>()
      expectTypeOf(c.env.bar).toEqualTypeOf<string>()
      return html`${c.env.bar}`
    }

    const app = new Hono<JSXRendererEnv>()
    app.use('*', jsxRenderer())
    app.get('/', (c) => {
      c.set('foo', 'fooValue')
      return c.render(
        <>
          <h1>
            <VariableFoo />
          </h1>
          <p>
            <BindingsBar />
          </p>
        </>,
        { title: 'Title' }
      )
    })
    const res = await app.request('http://localhost/', undefined, { bar: 'barValue' })
    expect(res).not.toBeNull()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<!DOCTYPE html><h1>fooValue</h1><p>barValue</p>')
  })

  it('Should return a resolved content', async () => {
    const app = new Hono()
    app.use(jsxRenderer(async ({ children }) => <div>{children}</div>))
    app.get('/', (c) => c.render('Hi', { title: 'Hi' }))
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<!DOCTYPE html><div>Hi</div>')
  })

  it('Should accept function-based options', async () => {
    type Env = { Bindings: { HONO_STREAMING?: boolean } }
    const app = new Hono<Env>()

    const Component = async () => {
      return <div>Component</div>
    }

    app.use(
      '*',
      jsxRenderer<Env>(
        ({ children }) => {
          return (
            <html>
              <body>{children}</body>
            </html>
          )
        },
        (c) => {
          expectTypeOf(c.env?.HONO_STREAMING).toEqualTypeOf<boolean | undefined>()
          return { docType: true, stream: c.env?.HONO_STREAMING ?? true }
        }
      )
    )

    app.get('/', async (c) => {
      return c.render(
        <div>
          <Suspense fallback={'loading...'}>
            <Component />
          </Suspense>
        </div>,
        { title: 'Suspense test' }
      )
    })

    const resStream = await app.request('/')
    expect(resStream.status).toBe(200)
    expect(resStream.headers.get('Transfer-Encoding')).toBe('chunked')
    const textStream = await resStream.text()
    expect(textStream).toContain('<template')
    expect(textStream).toContain('<script')
    expect(textStream).toContain('loading...')

    const resNotStream = await app.request('/', undefined, { HONO_STREAMING: false })
    expect(resNotStream.status).toBe(200)
    expect(resNotStream.headers.get('Transfer-Encoding')).toBeNull()
    const textNotStream = await resNotStream.text()
    expect(textNotStream).not.toContain('<template')
    expect(textNotStream).not.toContain('<script')
    expect(textNotStream).not.toContain('loading...')
    expect(textNotStream).toBe(
      '<!DOCTYPE html><html><body><div><div>Component</div></div></body></html>'
    )
  })

  describe('keep context status', async () => {
    it('Should keep context status', async () => {
      const app = new Hono()
      app.use(
        '*',
        jsxRenderer(({ children }) => {
          return (
            <html>
              <body>{children}</body>
            </html>
          )
        })
      )
      app.get('/', (c) => {
        c.status(201)
        return c.render(<h1>Hello</h1>, { title: 'Title' })
      })
      const res = await app.request('/')
      expect(res).not.toBeNull()
      expect(res.status).toBe(201)
      expect(await res.text()).toBe('<!DOCTYPE html><html><body><h1>Hello</h1></body></html>')
    })

    it('Should keep context status with stream option', async () => {
      const app = new Hono()
      app.use(
        '*',
        jsxRenderer(
          ({ children }) => {
            return (
              <html>
                <body>{children}</body>
              </html>
            )
          },
          { stream: true }
        )
      )
      app.get('/', (c) => {
        c.status(201)
        return c.render(<h1>Hello</h1>, { title: 'Title' })
      })
      const res = await app.request('/')
      expect(res).not.toBeNull()
      expect(res.status).toBe(201)
      expect(await res.text()).toBe('<!DOCTYPE html><html><body><h1>Hello</h1></body></html>')
    })
  })
})
