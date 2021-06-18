'use strict'
define(function(require) {
  let vars = require('vars')

  let sliders = {}

  let inputFromSlider = (slider, x) => Math.floor((x-slider.min)*1000/(slider.max-slider.min))
  let sliderFromInput = (slider, x) => parseFloat(slider.min + (x*(slider.max-slider.min)/1000))

  let idFromName = (name) => 'slider_'+name.replace(/[\W]+/g,"_")

  let createSliderUI = (slider) => {
    let template = document.querySelector('#slider-template')
    let s = template.content.cloneNode(true)
    s.querySelector('p .slider-name').innerText = slider.name + ':'
    s.querySelector('p .slider').id = idFromName(slider.name)
    document.getElementById('sliders').appendChild(s)
  }

  let updateSliderUI = (slider) => {
    let input = document.querySelector('#'+idFromName(slider.name))
    if (slider.value === undefined) {
      slider.value = slider.init || 0
    }
    input.value = inputFromSlider(slider, slider.value)
    input.oninput = ({target}) => {
      slider.value = sliderFromInput(slider, target.value)
    }
  }

  let newSlider = (params) => {
    if (!params) { throw 'Cannot create slider, no params passed' }
    if (!params.name) { throw 'Cannot create slider, no name param' }
    let slider = sliders[params.name]
    if (!slider) {
      params.init = params.init || 0
      sliders[params.name] = params
      slider = sliders[params.name]
      createSliderUI(slider)
    } else {
      for (let k in params) { slider[k] = params[k] } 
    }
    updateSliderUI(slider)
    return () => slider.value || 0
  }
  vars['slider'] = newSlider
})