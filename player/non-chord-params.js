'use strict';
define(function (require) {

  let expandedId = (p, idx) =>  p+idx

  let findNonChordParams = (params, p) => {
    let ps = []
    let idx = 1
    while (params[expandedId(p, idx)] !== undefined) {
      ps.push(expandedId(p, idx))
      idx++
    }
    return ps
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

    assert([], findNonChordParams({}, 'wave'))
    assert([], findNonChordParams({wave:1}, 'wave'))
    assert([], findNonChordParams({wave11:1}, 'wave'))
    assert(['wave1'], findNonChordParams({wave1:1}, 'wave'))
    assert(['wave1','wave2'], findNonChordParams({wave1:1,wave2:2}, 'wave'))
    assert(['wave1'], findNonChordParams({wave1:1,wave3:4}, 'wave'))
  }

  return {
    findNonChordParams: findNonChordParams,
  }
});
