'use strict'
define(function(require) {
  let players = {
    instances: {},
    overrides: {},
  }

  players.gc_reset = () => {
    for (let id in players.instances) {
      players.instances[id].marked = false
    }
  }
  players.gc_mark = (id) => {
    players.instances[id].marked = true
  }
  players.gc_sweep = () => {
    for (let id in players.instances) {
      if (!players.instances[id].marked) {
        delete players.instances[id]
      }
    }
  }

  return players
})
