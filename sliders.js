'use strict'
define(function(require) {
  let vars = require('vars')

  let sliders = {}

  let newSlider = (params) => {
    if (!params) { throw 'Cannot create slider, no params passed' }
    if (!params.name) { throw 'Cannot create slider, no name param' }
    if (!sliders[params.name]) { sliders[params.name] = params }
    let slider = sliders[params.name]
    for (k in params) { slider[k] = params[k] } 
    return () => slider.value || 0
  }
  vars['slider.new'] = newSlider
})