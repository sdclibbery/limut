'use strict';
define(function(require) {

  let intervals = {
    constant: '0-constant',
    event: '1-event',
    frame: '2-frame',
    intervalLte: (l,r) => l<=r,
  }

  intervals.intervalMax = (es, ...more) => {
    return es.concat(more).reduce((a,e) => (e>a)?e:a, intervals.constant)
  }

  return intervals
})