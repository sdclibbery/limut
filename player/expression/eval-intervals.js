'use strict';
define(function(require) {

  let lte = (l,r) => {
    return l <= r
  }

  return {
    constant: '0-constant',
    event: '1-event',
    frame: '2-frame',
    intervalLte: lte,
  }
})