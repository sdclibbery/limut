'use strict'
define((require) => {
let {move, filterInPlace} = require('array-in-place')

return () => {
  let rl = {
    queued: [],
    active: [],
  }

  rl.add = (startTime, render, zorder) => {
    rl.queued.push({t:startTime, render:render, zorder:zorder})
  }

  rl.isEmpty = () => rl.queued.length === 0 && rl.active.length === 0

  rl.render = (state) => {
    move(rl.queued, rl.active, ({t}) => state.time > t)
    rl.active.sort((l,r) => l.zorder - r.zorder)
    filterInPlace(rl.active, ({render}) => render(state))
  }
  
  return rl
}
})
