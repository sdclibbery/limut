'use strict';
define(function (require) {
  let param = require('player/default-param')

  let subParam = (p, name, def) => {
    let v
    if (typeof p === 'object') { v = p[name] }
    return param(v, def)
  }

  let mainParam = (p, def) => {
    if (typeof p !== 'object') { return p }
    return subParam(p, 'value', def)
  }

  return {
    subParam: subParam,
    mainParam: mainParam,
  }
})