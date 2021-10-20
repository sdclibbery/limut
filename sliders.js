'use strict'
define(function(require) {
  let vars = require('vars')
  let consoleOut = require('console')

  let sliders = {}

  let inputFromSlider = (slider, x) => Math.floor((x-slider.min)*1000/(slider.max-slider.min))
  let sliderFromInput = (slider, x) => parseFloat(slider.min + (x*(slider.max-slider.min)/1000))

  let idFromName = (name) => 'slider_'+name.replace(/[\W]+/g,"_")

  let createSliderUI = (slider) => {
    let template = document.querySelector('#slider-template')
    let s = template.content.cloneNode(true)
    s.querySelector('p .slider-name').innerText = slider.name + ':'
    s.querySelector('p').id = idFromName(slider.name)+'_root'
    s.querySelector('p .slider').id = idFromName(slider.name)
    document.getElementById('sliders').appendChild(s)
  }

  let deleteSliderUI = (slider) => {
    let s = document.querySelector('#'+idFromName(slider.name)+'_root')
    document.getElementById('sliders').removeChild(s)
  }

  let updateSliderUI = (slider) => {
    let input = document.querySelector('#'+idFromName(slider.name))
    if (slider.value === undefined) {
      slider.value = slider.init || 0
    }
    input.value = inputFromSlider(slider, slider.value)
    input.oninput = ({target}) => {
      slider.value = sliderFromInput(slider, target.value)
      consoleOut(`Slider '${slider.name}': ${slider.value}`)
    }
  }

  let newSlider = (params) => {
    if (!params) { throw 'Cannot create slider, no params passed' }
    if (!params.name) { throw 'Cannot create slider, no name param' }
    let slider = sliders[params.name]
    if (!slider) {
      params.min = params.min || 0
      params.max = params.max || 1
      params.init = (params.init !== undefined) ? params.init : params.min
      sliders[params.name] = params
      slider = sliders[params.name]
      createSliderUI(slider)
    } else {
      for (let k in params) { slider[k] = params[k] } 
    }
    updateSliderUI(slider)
    slider.marked = true
    return () => slider.value || 0
  }

  let gc_reset = () => {
    for (let name in sliders) {
      sliders[name].marked = false
    }
  }
  let gc_sweep = () => {
    for (let name in sliders) {
      if (!sliders[name].marked) {
        deleteSliderUI(sliders[name])
        delete sliders[name]
      }
    }
  }

  newSlider.isVarFunction = true
  vars['slider'] = newSlider
  return {
    gc_reset: gc_reset,
    gc_sweep: gc_sweep,
  }
})