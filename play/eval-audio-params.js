'use strict';
define(function (require) {
  let system = require('play/system')
  let evalParam = require('player/eval-param').evalParamFrame

  let setAudioParamValue = (node, vname, v) => {
    try {
      if (v !== undefined) {
        system.sc.setSynthValue(node, vname, v)
      }
    } catch (e) {
      console.log(e)
      throw `Failed setting audio param ${vname} to ${v}`
    }
  }

  let evalPerFrameParam = (node, params, pname, vname, def) =>{
    if (params[pname] === undefined) {
      return def || 0 // default value; no callback
    } else if (typeof params[pname] == 'number') {
      return params[pname] // single value; no need for callback
    } else {
      system.add(params.time, state => {
        if (state.time > params.endTime) { return false }
        setAudioParamValue(node, vname, evalParam(params[pname], params, state.count)) // update value on per-frame callback
        return true
      })
      let v = evalParam(params[pname], params, params.count)
      return v == undefined ? def : v // initial value
    }
  }

  let evalPerEventParam = (params, p, def) => {
    let v = params[p]
    if (typeof v !== 'number' && !v) { return def }
    v =  evalParam(v, params, params.count)
    if (typeof v !== 'number' && !v) { return def }
    return v
  }

  return {
    evalPerEvent: evalPerEventParam,
    evalPerFrame: evalPerFrameParam,
  }
})
