'use strict'
define((require) => {
  let {evalParamFrame,evalParamFrameIgnoreThisVars} = require('player/eval-param')

  let tupleIndex = (v, i) => {
    if (Array.isArray(v)) {
      return v[i % v.length]
    } else {
      return v
    }
  }

  let multiplyEvents = (event, index) => {
    for (let k in event) {
      if (k == 'beat') { continue }
      let v = event[k]
      if (v && v.__alreadyExpanded) { continue }
      let evaled = evalParamFrameIgnoreThisVars(v, event, event.count)
      if (Array.isArray(evaled)) { // If param k is going to eval to a tuple, expand it out
        let es = []
        for (let i=0; i<evaled.length; i++) {
          let e = Object.assign({}, event)
          if (Array.isArray(v)) {
            e[k] = v.flat()[i] // tuple in a tuple
            if (e[k] === undefined) { continue }
          } else if (typeof v == 'function' || typeof v == 'object') {
            e[k] = (e,b,evalRecurse) => tupleIndex(evalRecurse(v, e,b),i) // Get correct value out of a function that returns a tuple
            e[k].interval = v.interval
            e[k].__alreadyExpanded = true
          } else {
            e[k] = v // primitive so use same value across all tuple indices
          }
          es.push(...multiplyEvents(e, index)) // And recurse to expand out any other tuple params
        }
        es.forEach(e => e.index = index++)
        return es
      }
    }
    event.index = index++
    return [event]
  }

  let expandTuples = (es) => {
    let result = es.flatMap(e => {
      let index = 0
      return multiplyEvents(e, index)
    })
    return result
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }
    let p
    let e = {}
    let b = 0

    assert([], expandTuples([]))
    assert([{x:1,y:2,index:0}], expandTuples([{x:1,y:2}]))
    assert([{x:1,index:0},{x:2,index:0}], expandTuples([{x:1},{x:2}]))

    assert([{x:1,index:0},{x:2,index:1}], expandTuples([{x:[1,2]}]))
    assert([{x:1,y:3,index:0},{x:1,y:4,index:1},{x:2,y:3,index:2},{x:2,y:4,index:3}], expandTuples([{x:[1,2],y:[3,4]}]))
    assert([{x:1,index:0},{x:2,index:1},{x:3,index:2}], expandTuples([{x:[1,[2,3]]}]))
    assert([{x:1,y:3,w:5,index:0},{x:1,y:4,w:5,index:1},{x:2,y:3,w:5,index:2},{x:2,y:4,w:5,index:3}], expandTuples([{x:[1,2],y:[3,4],w:5}]))

    p = expandTuples([{x:()=>[1,2]}])
    assert(1, evalParamFrame(p[0].x,e,b))
    assert(0, evalParamFrame(p[0].index,e,b))
    assert(2, evalParamFrame(p[1].x,e,b))
    assert(1, evalParamFrame(p[1].index,e,b))

    p = expandTuples([{x:{r:[1,2]}}])
    assert({r:1}, evalParamFrame(p[0].x,e,b))
    assert({r:2}, evalParamFrame(p[1].x,e,b))

    p = expandTuples([{x:{r:()=>[1,2]}}])
    assert({r:1}, evalParamFrame(p[0].x,e,b))
    assert({r:2}, evalParamFrame(p[1].x,e,b))

    p = expandTuples([{x:{r:()=>[1,2],g:3}}])
    assert({r:1,g:3}, evalParamFrame(p[0].x,e,b))
    assert({r:2,g:3}, evalParamFrame(p[1].x,e,b))

    p = expandTuples([{x:()=>{return({r:1})}}])
    assert({r:1}, evalParamFrame(p[0].x,e,b))

    p = expandTuples([{x:()=>{return({r:()=>[1,2],g:3})}}])
    assert({r:1,g:3}, evalParamFrame(p[0].x,e,b))
    assert({r:2,g:3}, evalParamFrame(p[1].x,e,b))

    p = expandTuples([{x:()=>{return({r:()=>[1,2],g:[3,4]})}}])
    assert({r:1,g:3}, evalParamFrame(p[0].x,e,b))
    assert({r:1,g:4}, evalParamFrame(p[1].x,e,b))
    assert({r:2,g:3}, evalParamFrame(p[2].x,e,b))
    assert({r:2,g:4}, evalParamFrame(p[3].x,e,b))

    let pff = () => [3,4]
    pff.interval = 'frame'
    p = expandTuples([{x:[{r:1,g:pff},{r:2,g:pff}]}])
    assert({r:1,g:3}, evalParamFrame(p[0].x,e,b))
    assert({r:1,g:4}, evalParamFrame(p[1].x,e,b))
    assert({r:2,g:3}, evalParamFrame(p[2].x,e,b))
    assert({r:2,g:4}, evalParamFrame(p[3].x,e,b))
    assert(undefined, p[4])

    let tvf = (e) => e.f
    tvf.interval = 'frame'
    tvf._thisVar = true
    p = expandTuples([{x:tvf,f:1}])
    assert(1, p.length)
    assert(1, evalParamFrame(p[0].x,p[0],b))
    assert(1, evalParamFrame(p[0].f,p[0],b))

    p = expandTuples([{x:tvf,f:[3,4]}])
    assert(2, p.length)
    assert(3, evalParamFrame(p[0].x,p[0],b))
    assert(3, evalParamFrame(p[0].f,p[0],b))
    assert(4, evalParamFrame(p[1].x,p[1],b))
    assert(4, evalParamFrame(p[1].f,p[1],b))

    p = expandTuples([{x:[{r:1,g:tvf},{r:2,g:tvf}],f:[3,4]}])
    assert(4, p.length)
    assert({r:1,g:3}, evalParamFrame(p[0].x,p[0],b))
    assert(3, evalParamFrame(p[0].f,p[0],b))
    assert({r:1,g:4}, evalParamFrame(p[1].x,p[1],b))
    assert(4, evalParamFrame(p[1].f,p[1],b))
    assert({r:2,g:3}, evalParamFrame(p[2].x,p[2],b))
    assert(3, evalParamFrame(p[2].f,p[2],b))
    assert({r:2,g:4}, evalParamFrame(p[3].x,p[3],b))
    assert(4, evalParamFrame(p[3].f,p[3],b))

    console.log('Expand tuples tests complete')
  }
  return expandTuples
})