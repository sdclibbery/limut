'use strict';
define(function(require) {

  let lte = (l,r) => {
    return l <= r
  }

  return {
    constant: 0,
    event: 1,
    frame: 2,
    intervalLte: lte,
  }
})