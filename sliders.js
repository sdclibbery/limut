'use strict'
define(function(require) {
  let addVar = require('predefined-vars').add
  let consoleOut = require('console')

  let sliders = {}

  let inputFromSlider = (slider, x) => {
    let lerp = (x-slider.min) / (slider.max-slider.min)
    let curved = Math.pow(lerp, Math.pow(2, -slider.curve))
    return Math.floor(1000 * curved)
  }
  let sliderFromInput = (slider, x) => {
    let lerp = x / 1000
    let curved = Math.pow(lerp, Math.pow(2, slider.curve))
    return parseFloat(slider.min + curved*(slider.max-slider.min))
  }

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

  let newSlider = (args, context) => {
    if (!args) { args={} }
    if (!args.name) {
      args.name = context
    }
    if (!args.name) {
      args.name = 'Slider'+Math.floor(Math.random()*10000)
    }
    let slider = sliders[args.name]
    if (!slider) {
      args.min = args.min || 0
      args.max = args.max || 1
      args.curve = args.curve || 0
      args.init = (args.value !== undefined) ? args.value : ((args.init !== undefined) ? args.init : args.min)
      sliders[args.name] = args
      slider = sliders[args.name]
      createSliderUI(slider)
    } else {
      for (let k in args) { slider[k] = args[k] } 
    }
    updateSliderUI(slider)
    slider.marked = true
    return () => {
      return slider.value || 0
    }
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

  newSlider.isStaticVarFunction = true
  addVar('slider', newSlider)
  return {
    gc_reset: gc_reset,
    gc_sweep: gc_sweep,
  }
})