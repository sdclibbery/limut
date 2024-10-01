'use strict';
define(function (require) {
  let param = require('player/default-param')
  let {units} = require('units')

  let subParam = (p, name, def) => {
    if (typeof p === 'object') {
      return param(p[name], def)
    }
    return def
  }

  let mainParam = (p, def) => {
    if (typeof p !== 'object') {
      return param(p, def)
    }
    return param(p.value, def)
  }

  let subParamUnits = (p, subParamName, requiredUnits, def) => {
    if (typeof p !== 'object') { return def }
    return units(param(p[subParamName], def), requiredUnits)
  }

  let mainParamUnits = (p, requiredUnits, def) => {
    do {
      p = units(p, requiredUnits)
    } while (typeof p === 'object')
    return param(p, def)
  }

  return {
    subParam: subParam,
    mainParam: mainParam,
    subParamUnits: subParamUnits,
    mainParamUnits: mainParamUnits,
  }
})