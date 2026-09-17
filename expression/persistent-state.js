'use strict'
define(function(require) {
  // State for a stateful var function (accum/smooth/rate) that must outlive the parse it was
  // created in. Every code update re-parses every line (update-code.js), so the per parse instance
  // state object in parse-var.js is thrown away and remade on each Ctrl+Enter - which is why accum
  // used to restart from zero every time anything in the buffer was edited. Keyed state lives here
  // instead, and is mark/swept per update exactly as sliders are: parsing a line marks the keys it
  // uses, and a line that has gone away leaves its keys unmarked, so they are swept.
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
