'use strict';
define(function (require) {
  let system = require('play/system');
  let envelope = require('play/pad-envelope')
  let effects = require('play/effects')
  let param = require('player/default-param')

  let processorCode = `
    class NoiseProcessor extends AudioWorkletProcessor {
      constructor() { super() }
      static get parameterDescriptors() {
        return [{
            name: "start",
            defaultValue: 0,
            minValue: 0,
            maxValue: 1,
          },{
            name: "stop",
            defaultValue: 0,
            minValue: 0,
            maxValue: 1,
        }]
      }
      process(inputs, outputs, parameters) {
        outputs[0].forEach(channel => {
          for (let i = 0; i < channel.length; i++) {
            channel[i] = parameters.start[i%parameters.start.length]*(Math.random()*2-1)
          }
        })
        return parameters.stop[0]<0.5
      }
    }
    registerProcessor("noise-processor", NoiseProcessor)
  `
  system.audio.audioWorklet.addModule("data:text/javascript;charset=utf-8,"+encodeURIComponent(processorCode))

  return (params) => {
    let vca = envelope(params, 0.1)
    let out = effects(params, vca)
    system.mix(out)

    let noise = new AudioWorkletNode(system.audio, "noise-processor")
    noise.connect(vca)
    noise.parameters.get('start').setValueAtTime(0, system.audio.currentTime)
    noise.parameters.get('start').setValueAtTime(1, params.time)
    noise.parameters.get('stop').setValueAtTime(0, system.audio.currentTime)
    noise.parameters.get('stop').setValueAtTime(1, params.endTime)
    system.disconnect(params, [noise,vca,out])
  }
});