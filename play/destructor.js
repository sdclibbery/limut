'use strict';
define(function (require) {

  return () => {
    let destructor = {
      nodesToStop: [],
      nodesToDisconnect: [],
    }
    destructor.stop = (...nodes) => {
      destructor.nodesToStop = destructor.nodesToStop.concat(nodes.flat())
    }
    destructor.disconnect = (...nodes) => {
      destructor.nodesToDisconnect = destructor.nodesToDisconnect.concat(nodes.flat())
    }
    destructor.destroy = () => {
      destructor.nodesToStop.forEach(n => n.stop())
      destructor.nodesToDisconnect.forEach(n => n.disconnect())
    }
    return destructor
  }
})
