'use strict'
define(function(require) {
  // State for a stateful var function (accum/smooth/rate) that must outlive the parse it was
  // created in, since every code update re-parses every line. Mark/swept per update like sliders:
  // parsing a line marks the keys it uses, and unmarked keys are swept.
  let store = {}

  let get = (key) => {
    let entry = store[key]
    if (entry === undefined) {
      entry = { marked:true, state:{} }
      store[key] = entry
    } else {
      entry.marked = true
    }
    return entry.state
  }

  let gc_reset = () => {
    for (let key in store) { store[key].marked = false }
  }

  let gc_sweep = () => {
    for (let key in store) {
      if (!store[key].marked) { delete store[key] }
    }
  }

  return {
    get: get,
    gc_reset: gc_reset,
    gc_sweep: gc_sweep,
  }
})
