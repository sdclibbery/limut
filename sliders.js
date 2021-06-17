'use strict'
define(function(require) {
  let vars = require('vars')

  let sliders = {}

  let createSliderUI = (slider) => {
    let template = document.querySelector('#slider-template')
    let s = template.content.cloneNode(true)
    s.querySelector('p .slider-name').innerText = slider.name + ':'
    let range = slider.max-slider.min
    let input = s.querySelector('p .slider')
    input.value = Math.floor((slider.init-slider.min)*200/range)
    input.oninput = ({target}) => {
      slider.value = parseFloat(slider.min + (target.value*range/200))
    }
    slider.value = slider.init
    document.getElementById('sliders').appendChild(s)
  }

  let newSlider = (params) => {
    if (!params) { throw 'Cannot create slider, no params passed' }
    if (!params.name) { throw 'Cannot create slider, no name param' }
    if (!sliders[params.name]) {
      params.init = params.init || 0
      sliders[params.name] = params
      createSliderUI(sliders[params.name])
    }
    let slider = sliders[params.name]
    for (let k in params) { slider[k] = params[k] } 
    return () => slider.value || 0
  }
  vars['slider'] = newSlider
})