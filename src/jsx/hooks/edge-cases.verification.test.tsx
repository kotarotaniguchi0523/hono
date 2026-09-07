/** @jsxImportSource ../ */
import { JSDOM } from 'jsdom'
import { render } from '../dom'
import { createRef, useImperativeHandle, useMemo, useState } from '.'

describe('hooks edge-case verification', () => {
  let dom: JSDOM
  let root: HTMLElement

  beforeAll(() => {
    global.requestAnimationFrame = (cb) => setTimeout(cb)
  })

  beforeEach(() => {
    dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
      runScripts: 'dangerously',
    })
    global.document = dom.window.document
    global.HTMLElement = dom.window.HTMLElement
    global.SVGElement = dom.window.SVGElement
    global.Text = dom.window.Text
    root = document.getElementById('root') as HTMLElement
  })

  it('moves an imperative handle when the ref object changes', async () => {
    type Handle = { value: string }
    const refA = createRef<Handle>()
    const refB = createRef<Handle>()
    let switchRef: (() => void) | undefined

    const Child = ({ targetRef }: { targetRef: typeof refA }) => {
      useImperativeHandle(targetRef, () => ({ value: 'handle' }), [])
      return <span>child</span>
    }

    const App = () => {
      const [useB, setUseB] = useState(false)
      switchRef = () => setUseB(true)
      return <Child targetRef={useB ? refB : refA} />
    }

    render(<App />, root)
    await new Promise((resolve) => setTimeout(resolve))
    expect(refA.current).toEqual({ value: 'handle' })
    expect(refB.current).toBe(null)

    switchRef!()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve))

    expect(refA.current).toBe(null)
    expect(refB.current).toEqual({ value: 'handle' })
  })

  it('ignores repeated stale state updates after a component has unmounted', async () => {
    let setChildCount: ((value: number) => void) | undefined
    let hideChild: (() => void) | undefined

    const Child = () => {
      const [count, setCount] = useState(0)
      setChildCount = setCount
      return <span>{count}</span>
    }

    const App = () => {
      const [show, setShow] = useState(true)
      hideChild = () => setShow(false)
      return <div>{show ? <Child /> : null}</div>
    }

    render(<App />, root)
    expect(root.innerHTML).toBe('<div><span>0</span></div>')

    hideChild!()
    await Promise.resolve()
    await Promise.resolve()
    expect(root.innerHTML).toBe('<div></div>')

    setChildCount!(1)
    await Promise.resolve()
    await Promise.resolve()
    expect(root.innerHTML).toBe('<div></div>')

    setChildCount!(2)
    await Promise.resolve()
    await Promise.resolve()
    expect(root.innerHTML).toBe('<div></div>')
  })

  it('uses Object.is semantics for hook dependency comparison', async () => {
    let setValue: ((value: number) => void) | undefined
    let rerender: (() => void) | undefined
    let computations = 0

    const App = () => {
      const [value, updateValue] = useState<number>(NaN)
      const [, setTick] = useState(0)
      setValue = updateValue
      rerender = () => setTick((tick) => tick + 1)

      const computed = useMemo(() => {
        computations++
        return computations
      }, [value])

      return <span>{computed}</span>
    }

    render(<App />, root)
    expect(computations).toBe(1)

    // Object.is(NaN, NaN) is true, so an unrelated rerender must not recompute.
    rerender!()
    await Promise.resolve()
    expect(computations).toBe(1)

    // Move to +0 first.
    setValue!(0)
    await Promise.resolve()
    expect(computations).toBe(2)

    // Object.is(+0, -0) is false, so this must recompute.
    setValue!(-0)
    await Promise.resolve()
    expect(computations).toBe(3)
  })
})
