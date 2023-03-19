'use strict'
define(function(require) {

  let buses = {
    instances: {},
  }

  buses.gc_reset = () => {
    for (let id in buses.instances) {
      buses.instances[id].marked = false
    }
  }
  buses.gc_mark = (id) => {
    buses.instances[id].marked = true
  }
  buses.gc_sweep = () => {
    for (let id in buses.instances) {
      if (!buses.instances[id].marked) {
        buses.instances[id].destroy()
        delete buses.instances[id]
      }
    }
  }
  
  return buses
})
