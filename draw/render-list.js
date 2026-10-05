'use strict'
define((require) => {
let {move, filterInPlace} = require('array-in-place')

let byZorder = (l,r) => l.zorder - r.zorder

return () => {
  let rl = {
    queued: [],
    active: [],
  }
  let current // the state being rendered, read by the predicates below
  let started = (q) => current.time > q.t
  let render = (a) => a.render(current)

  rl.add = (startTime, render, zorder) => {
    rl.queued.push({t:startTime, render:render, zorder:zorder})
  }

  rl.isEmpty = () => rl.queued.length === 0 && rl.active.length === 0

  rl.render = (state) => {
    current = state
    move(rl.queued, rl.active, started)
    rl.active.sort(byZorder)
    filterInPlace(rl.active, render)
  }
  
  return rl
}
})
