'use strict'
define(function(require) {
  let instances = {}
  let overrides = {}

  let gc_reset = () => {
    for (let id in instances) {
      instances[id].marked = false
    }
  }
  let gc_mark = (id) => {
    instances[id].marked = true
  }
  let gc_sweep = () => {
    for (let id in instances) {
      if (!instances[id].marked) {
        delete instances[id]
      }
    }
  }

  return {
    instances: instances,
    overrides: overrides,
    gc_reset: gc_reset,
    gc_mark: gc_mark,
    gc_sweep: gc_sweep,
  }
})
