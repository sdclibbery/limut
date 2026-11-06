'use strict'
define(function(require) {
  let addVar = require('predefined-vars').add
  let consoleOut = require('console')

  let sliders = {}
  let inlineSliders = {}
  let autoRerun = false
  let sliderChangeListeners = []
  let sweepListeners = []

  let inputFromSlider = (slider, x) => {
    let lerp = Math.min(Math.max((x-slider.min) / (slider.max-slider.min), 0), 1)
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
      sliderChangeListeners.forEach(cb => cb(slider.name, slider.value))
    }
  }

  let setSliderValue = (name, value) => {
    let slider = sliders[name]
    if (!slider) { return }
    slider.value = value
    let input = document.querySelector('#'+idFromName(slider.name))
    if (input) { input.value = inputFromSlider(slider, value) }
    if (slider.updateWidget) { slider.updateWidget() }
  }

  let setInlineValue = (slider, value) => {
    slider.value = value
    sliderChangeListeners.forEach(cb => cb(slider.name, slider.value))
  }

  let getSliderValues = () => {
    let result = []
    for (let name in sliders) {
      if (sliders[name].value !== undefined) {
        result.push({ name: name, value: sliders[name].value })
      }
    }
    return result
  }

  let newInlineSlider = (args, context) => {
    args = Object.assign({}, args)
    if (!args.name) { args.name = 'inline_'+args.inline }
    let literal = args.value
    delete args.value
    delete args.init
    let slider = sliders[args.name]
    let created = !slider
    if (created) {
      slider = { min:0, max:1, curve:0 }
      sliders[args.name] = slider
    }
    for (let k in args) { slider[k] = args[k] }
    slider.min = args.min || 0
    slider.max = args.max || 1
    slider.curve = args.curve || 0
    // Auto reruns parse the code from the last Ctrl+Enter, whose literal may predate a drag
    if (typeof literal === 'number' && (created || !autoRerun)) { slider.value = literal }
    if (slider.value === undefined) { slider.value = slider.min }
    slider.marked = true
    inlineSliders[args.inline] = slider
    let sliderValue = () => slider.value || 0
    sliderValue.isNonTemporal = true
    sliderValue.interval = 'frame'
    return sliderValue
  }

  let newSlider = (args, context) => {
    if (args && args.value1 !== undefined) {
      args = Object.assign({}, args)
      if (args.max === undefined) { args.max = args.value1 }
      delete args.value1
    }
    if (args && args.inline !== undefined) { return newInlineSlider(args, context) }
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
    let sliderValue = () => {
      return slider.value || 0
    }
    sliderValue.isNonTemporal = true
    sliderValue.interval = 'frame'
    return sliderValue
  }

  let gc_reset = () => {
    inlineSliders = {}
    for (let name in sliders) {
      sliders[name].marked = false
    }
  }
  let gc_sweep = () => {
    for (let name in sliders) {
      if (!sliders[name].marked) {
        if (sliders[name].inline === undefined) { deleteSliderUI(sliders[name]) }
        else if (autoRerun) { continue } // Its section has ended; keep the dragged value for when it comes back
        delete sliders[name]
      }
    }
    sweepListeners.forEach(cb => cb())
  }

  newSlider.isStaticVarFunction = true
  addVar('slider', newSlider)

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual, msg) => {
      if (expected !== actual) { console.trace(`Assertion failed${msg?' '+msg:''}.\n>>Expected:\n  ${expected}\n>>Actual:\n  ${actual}`) }
    }
    let panelCount = () => document.getElementById('sliders').querySelectorAll('.slider').length
    let before = panelCount()
    let v = newSlider({value:0.5, inline:900}, 'p.amp')
    assert(0.5, v())
    assert(before, panelCount(), 'inline slider not in panel')
    let s = sliders['inline_900']
    assert(s, inlineSliders[900])
    setInlineValue(s, 0.8)
    autoRerun = true
    newSlider({value:0.5, inline:900}, 'p.amp')
    assert(0.8, v(), 'stale literal on auto rerun does not undo drag')
    autoRerun = false
    newSlider({value:0.5, inline:900}, 'p.amp')
    assert(0.5, v(), 'literal adopted on manual run')
    newSlider({min:2, max:4, inline:901}, 'p.amp')
    assert(2, sliders['inline_901'].value, 'no literal starts at min')
    newSlider({value:1, name:'foo', inline:902}, 'p.amp')
    assert(inlineSliders[902], sliders['foo'], 'name overrides inline name')
    autoRerun = true
    newSlider({value:0.7, inline:905}, 'p.amp')
    assert(0.7, inlineSliders[905].value, 'literal adopted on creation in auto rerun')
    setInlineValue(inlineSliders[905], 0.9)
    gc_reset(); gc_sweep()
    assert(0.9, sliders['inline_905'] && sliders['inline_905'].value, 'auto rerun sweep keeps inline slider')
    autoRerun = false
    gc_reset(); gc_sweep()
    assert(undefined, sliders['inline_905'], 'manual sweep removes inline slider')
    gc_reset()
    newSlider({value:3, value1:8, inline:903}, 'p.amp')
    assert(8, inlineSliders[903].max, 'second positional arg is max')
    assert(undefined, inlineSliders[903].value1)
    newSlider({value:3, value1:8, max:5, inline:904}, 'p.amp')
    assert(5, inlineSliders[904].max, 'named max wins')
    delete sliders['inline_900']; delete sliders['inline_901']; delete sliders['foo']; delete sliders['inline_903']; delete sliders['inline_904']
    inlineSliders = {}
    console.log('Slider tests complete')
  }
  return {
    gc_reset: gc_reset,
    setAutoRerun: (auto) => { autoRerun = auto },
    gc_sweep: gc_sweep,
    onSliderChange: (cb) => { sliderChangeListeners.push(cb) },
    onSweep: (cb) => { sweepListeners.push(cb) },
    setSliderValue: setSliderValue,
    getSliderValues: getSliderValues,
    getInlineSlider: (n) => inlineSliders[n],
    setInlineValue: setInlineValue,
    inputFromSlider: inputFromSlider,
    sliderFromInput: sliderFromInput,
  }
})