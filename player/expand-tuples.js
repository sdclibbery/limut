'use strict'
define((require) => {
  let {evalParamFrame} = require('player/eval-param')

  let tupleIndex = (v, i) => {
    if (Array.isArray(v)) {
      return v[i % v.length]
    } else {
      return v
    }
  }

  let multiplyEvents = (event) => {
    for (let k in event) {
      if (k == 'beat') { continue }
      let v = event[k]
      if (v && v.__alreadyExpanded) { continue }
      let evaled = evalParamFrame(v, event, event.count)
      if (Array.isArray(evaled)) { // If param k is going to eval to a tuple, expand it out
        let es = []
        for (let i=0; i<evaled.length; i++) {
          let e = Object.assign({}, event)
          if (Array.isArray(v)) {
            e[k] = v.flat()[i] // tuple in a tuple
          } else if (typeof v == 'function' || typeof v == 'object') {
            e[k] = (e,b,evalRecurse) => tupleIndex(evalRecurse(v, e,b),i)
            e[k].interval = v.interval
            e[k].__alreadyExpanded = true
          } else {
            e[k] = v // primitive so use same value across all tuple indices
          }
          es.push(...multiplyEvents(e)) // And recurse to expand out any other tuple params
        }
        return es
      }
    }
    return [event]
  }

  let expandTuples = (es) => {
    let result = es.flatMap(e => multiplyEvents(e))
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
    assert([{x:1,y:2}], expandTuples([{x:1,y:2}]))
    assert([{x:1},{x:2}], expandTuples([{x:1},{x:2}]))

    assert([{x:1},{x:2}], expandTuples([{x:[1,2]}]))
    assert([{x:1,y:3},{x:1,y:4},{x:2,y:3},{x:2,y:4}], expandTuples([{x:[1,2],y:[3,4]}]))
    assert([{x:1},{x:2},{x:3}], expandTuples([{x:[1,[2,3]]}]))
    assert([{x:1,y:3,w:5},{x:1,y:4,w:5},{x:2,y:3,w:5},{x:2,y:4,w:5}], expandTuples([{x:[1,2],y:[3,4],w:5}]))

    p = expandTuples([{x:()=>[1,2]}])
    assert(1, evalParamFrame(p[0].x,e,b))
    assert(2, evalParamFrame(p[1].x,e,b))

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
  }
  return expandTuples
})