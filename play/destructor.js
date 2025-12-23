'use strict';
define(function (require) {

  return () => {
    let destructor = {
      nodesToStop: [],
      nodesToDisconnect: [],
    }
    destructor.stop = (n1, n2, n3, n4, n5, n6, n7, n8) => {
      if (!!n1) { destructor.nodesToStop.push(n1) }
      if (!!n2) { destructor.nodesToStop.push(n2) }
      if (!!n3) { destructor.nodesToStop.push(n3) }
      if (!!n4) { destructor.nodesToStop.push(n4) }
      if (!!n5) { destructor.nodesToStop.push(n5) }
      if (!!n6) { destructor.nodesToStop.push(n6) }
      if (!!n7) { destructor.nodesToStop.push(n7) }
      if (!!n8) { destructor.nodesToStop.push(n8) }
    }
    destructor.disconnect = (n1, n2, n3, n4, n5, n6, n7, n8) => {
      if (!!n1) { destructor.nodesToDisconnect.push(n1) }
      if (!!n2) { destructor.nodesToDisconnect.push(n2) }
      if (!!n3) { destructor.nodesToDisconnect.push(n3) }
      if (!!n4) { destructor.nodesToDisconnect.push(n4) }
      if (!!n5) { destructor.nodesToDisconnect.push(n5) }
      if (!!n6) { destructor.nodesToDisconnect.push(n6) }
      if (!!n7) { destructor.nodesToDisconnect.push(n7) }
      if (!!n8) { destructor.nodesToDisconnect.push(n8) }
    }
    destructor.destroy = () => {
      destructor.nodesToStop.forEach(n => n.stop())
      destructor.nodesToDisconnect.forEach(n => n.disconnect())
    }
    return destructor
  }
})
