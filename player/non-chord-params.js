'use strict';
define(function (require) {
  let {evalParamFrame} = require('player/eval-param')

  let expandedId = (p, idx) =>  '_'+p+idx

  let nonChordIndex = (v, i) => {
    if (Array.isArray(v)) {
      return v[i % v.length]
    } else {
      return v
    }
  }

  let findNonChordParams = (params, p) => {
    let ps = []
    let idx = 0
    while (params[expandedId(p, idx)] !== undefined) {
      ps.push(expandedId(p, idx))
      idx++
    }
    return ps
  }

  let expandNonChordEvent = (e, nonChordParams) => {
    for (let k in nonChordParams) {
      let v = e[k]
      let evaled = evalParamFrame(v, e, e.count)
      if (Array.isArray(evaled)) { // If param k is going to eval to an array at the start of the event, expand it out
        for (let idx=0; idx<evaled.length; idx++) {
          let id = expandedId(k,idx)
          if (Array.isArray(v)) { // Already an array; just expand it
            e[id] = v.flat()[idx]
          } else if (typeof v == 'function' || typeof v == 'object') {
            e[id] = (e,b,evalRecurse) => nonChordIndex(evalRecurse(v, e,b),idx) // Get correct value out of a function that returns a chord
            e[id].interval = v.interval
          } else if (!!v) {
            e[id] = v
          }
        }
      } else { // Need to expand even if it doesn't expand to an array
        e[expandedId(k,0)] = v
      }
      delete e[k]
    }
  }

  let expandNonChordParams = (es, nonChordParams) => {
    es.forEach(e => expandNonChordEvent(e, nonChordParams))
    return es
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual, msg) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}${msg?'\n'+msg:''}`) }
    }
    let es
    let e = {}
    let b = 0

    assert([], findNonChordParams({}, 'waves'))
    assert([], findNonChordParams({waves:1}, 'waves'))
    assert(['_waves0'], findNonChordParams({_waves0:1}, 'waves'))
    assert(['_waves0','_waves1'], findNonChordParams({_waves0:1,_waves1:2}, 'waves'))
    assert(['_waves0'], findNonChordParams({_waves0:1,_waves3:4}, 'waves'))

    assert([{foo:1}], expandNonChordParams([{foo:1}], {waves:true}))
    assert([{foo:1},{foo:2}], expandNonChordParams([{foo:1},{foo:2}], {waves:true}))
    assert([{_waves0:1}], expandNonChordParams([{waves:1}], {waves:true}))
    assert([{_waves0:1,_waves1:2}], expandNonChordParams([{waves:[1,2]}], {waves:true}))

    es = expandNonChordParams([{waves:{value:[1,2]}}], {waves:true})
    assert({_waves0:{value:1},_waves1:{value:2}}, evalParamFrame(es[0],e,b))

    es = expandNonChordParams([{waves:()=>[1,2]}], {waves:true})
    assert({_waves0:1,_waves1:2}, evalParamFrame(es[0],e,b))

    console.log('Non chord params tests complete')
  }

  return {
    expandNonChordParams: expandNonChordParams,
    findNonChordParams: findNonChordParams,
  }
});
