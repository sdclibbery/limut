'use strict';
define(function(require) {

    let units = [
        { keyword:'#', template:{'#':1} },
        { keyword:'b', template:{b:1,_units:'b'} },
        { keyword:'cpb', template:{_units:'cpb'} },
        { keyword:'kcpb', template:{_units:'cpb'}, _unitscale:1000 },
        { keyword:'s', template:{_units:'s'} },
        { keyword:'ms', template:{_units:'s'}, _unitscale:1/1000 },
        { keyword:'hz', template:{_units:'hz'} },
        { keyword:'khz', template:{_units:'hz'}, _unitscale:1000 },
        { keyword:'cps', template:{_units:'hz'} },
        { keyword:'kcps', template:{_units:'hz'}, _unitscale:1000 },
        { keyword:'bpm', template:{_units:'hz'}, _unitscale:1/60 },
    ]

    let keyword = (state, kw) => {
      if (state.str.slice(state.idx, state.idx + kw.length).toLowerCase() !== kw) { return false} // Keyword doesn't match
      state.idx += kw.length
      return true
    }
  
    let parseUnits = (n, state) => {
        for (let idx in units) {
            let unit = units[idx]
            if (keyword(state, unit.keyword)) {
                n = Object.assign({value:n}, unit.template)
                if (unit._unitscale) {
                    n.value *= unit._unitscale
                }
            }
        }
        return n
    }

  // TESTS
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(3) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(3) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  let st
  st = {str:'2',idx:0}; parseUnits(9, st); assert(0, st.idx)
  st = {str:'#',idx:0}; parseUnits(9, st); assert(1, st.idx)
  st = {str:'ms',idx:0}; parseUnits(9, st); assert(2, st.idx)

  assert(9, parseUnits(9, {str:'2',idx:0}))
  assert(9, parseUnits(9, {str:'db',idx:0}))
  assert({value:9,'#':1}, parseUnits(9, {str:'#',idx:0}))
  assert({value:9,'b':1,_units:'b'}, parseUnits(9, {str:'b',idx:0}))
  assert({value:9,_units:'s'}, parseUnits(9, {str:'s',idx:0}))
  assert({value:9,_units:'s'}, parseUnits(9, {str:'S',idx:0}))
  assert({value:0.009,_units:'s'}, parseUnits(9, {str:'ms',idx:0}))
  
  console.log('Parse units tests complete')
  }
  
  return parseUnits
})