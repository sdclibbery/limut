'use strict'
define((require) => {
  let {evalParamEvent,evalParamFrame} = require('player/eval-param')

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
      let evaled = evalParamFrame(v, event, event.count)
      if (Array.isArray(evaled)) { // If param k is a tuple, expand it out
        let es = []
        for (let i=0; i<evaled.length; i++) {
          let e = Object.assign({}, event)
          if (Array.isArray(v)) {
            e[k] = v[i] // get correct element from tuple
          } else if (typeof v == 'function') {
            e[k] = (e,b,evalRecurse) => tupleIndex(v(e,b,evalRecurse),i) // return function to get tuple, then index it
            e[k].interval = v.interval
          } else if (typeof v == 'object') {
            e[k] = (e,b,evalRecurse) => tupleIndex(evalRecurse(v, e,b,evalRecurse),i) // return function to get tuple, then index it
            e[k].interval = v.interval
          } else {
            e[k] = v // primitive so use same value across all tuple indices
          }
          e[k] = evalParamEvent(e[k], e, e.count) // eval to the event level
          es.push(...multiplyEvents(e)) // And recurse to expand out any other tuple params
        }
        return es
      }
      else {
        event[k] = evalParamEvent(event[k], event, event.count) // eval to the event level
      }
    }
    return [event]
  }

  let expandTuples = (es) => {
    return es.flatMap(e => multiplyEvents(e))
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

    p = expandTuples([{x:()=>[1,2]}])
    assert(1, p[0].x)
    assert(2, p[1].x)

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