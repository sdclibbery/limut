'use strict';
define(function (require) {
  let system = require('play/system');
  let effects = require('play/effects/effects')
  let {fxMixChain} = require('play/effects/fxMixChain')
  let waveEffects = require('play/effects/wave-effects')
  let {evalMainParamEvent} = require('play/eval-audio-params')
  let perFrameAmp = require('play/effects/perFrameAmp')
  let destructor = require('play/destructor')
  let bassDrum = require('play/synth/io808/drumModules/bassDrum')
  let snareDrum = require('play/synth/io808/drumModules/snareDrum')
  let openHat = require('play/synth/io808/drumModules/openHat')
  let clsdHat = require('play/synth/io808/drumModules/clsdHat')
  let cowbell = require('play/synth/io808/drumModules/cowbell')
  let maracasHandclap = require('play/synth/io808/drumModules/maracasHandclap')
  let tomConga = require('play/synth/io808/drumModules/tomConga')
  let claveRimshot = require('play/synth/io808/drumModules/claveRimshot')
  let cymbal = require('play/synth/io808/drumModules/cymbal')

  let settings = (params, selector) => { return {
    level: evalMainParamEvent(params, 'level', 3/4) * 100,
    accent: ((((parseInt(params.value)||0) + evalMainParamEvent(params, 'add', 0))/9)) * 100,
    tone: evalMainParamEvent(params, 'tone', 1/2) * 100,
    decay: evalMainParamEvent(params, 'decay', 1/2) * 100,
    snappy: evalMainParamEvent(params, 'snappy', 1/2) * 100,
    tuning: evalMainParamEvent(params, 'tuning', 1/2) * 100,
    selector: selector,
  }}

  let types = {
    'bd': (params) => bassDrum(params, settings(params)),
    'sd': (params) => snareDrum(params, settings(params)),
    'oh': (params) => openHat(params, settings(params)),
    'ch': (params) => clsdHat(params, settings(params)),
    'cb': (params) => cowbell(params, settings(params)),
    'cp': (params) => maracasHandclap(params, settings(params, 1)),
    'ma': (params) => maracasHandclap(params, settings(params, 0)),
    'ht': (params) => tomConga('high')(params, settings(params, 1)),
    'mt': (params) => tomConga('mid')(params, settings(params, 1)),
    'lt': (params) => tomConga('low')(params, settings(params, 1)),
    'hc': (params) => tomConga('high')(params, settings(params, 0)),
    'mc': (params) => tomConga('mid')(params, settings(params, 0)),
    'lc': (params) => tomConga('low')(params, settings(params, 0)),
    'cl': (params) => claveRimshot(params, settings(params, 0)),
    'rs': (params) => claveRimshot(params, settings(params, 1)),
    'cy': (params) => cymbal(params, settings(params)),
  }
  let allMap = { 'x':'bd', 'X':'bd', 'v':'bd', 'V':'bd', 'o':'sd', 'O':'sd', 'i':'sd', 'u':'sd', '=':'oh', '-':'ch', ':':'ch',
                 'T':'cb', 'e':'cb', '*':'cp', 'H':'cp', 'm':'mt', 't':'rs', '~':'cy', '#':'cy', }

  return (params) => {
    params._destructor = destructor()

    let type = evalMainParamEvent(params, 'type')
    if (type === 'all') {
      type = allMap[params.value]
      if (!type) { throw `Unknown io808 value '${params.value}'` }
    }
    let playMethod = types[type]
    if (!playMethod) { throw `Unknown io808 type '${type}'` }
    let source = playMethod(params)
    setTimeout(() => params._destructor.destroy(), 100+(params.endTime - system.audio.currentTime)*1000)

    let vca = system.audio.createGain()
    let gainbase = 0.18 * evalMainParamEvent(params, "loud", 1)
    vca.gain.value = Math.max(0, gainbase * (typeof params.amp === 'number' ? params.amp : 1))
    waveEffects(params, effects(params, source)).connect(vca)
    fxMixChain(params, perFrameAmp(params, vca))
    params._destructor.disconnect(vca, source)
  }
});
