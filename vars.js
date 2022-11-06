'use strict';
define(function(require) {
  let vars = {
  }

  let clear = () => vars = {}
  let get = (k) => vars[k]
  let set = (k, v) => { vars[k] = v }
  let all = () => vars

  return {
    clear: clear,
    get: get,
    set: set,
    all: all,
  }
})
