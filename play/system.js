'use strict';
define(function (require) {
let {move, filterInPlace} = require('array-in-place')

if (window.Module === undefined) { window.Module == {} }
var system = {
  sc: window.Module,
  queued: [],
  active: [],
}
system.sc.onRuntimeInitialized = () => console.log('Supercollider runtime initialised')
system.sc.monitorRunDependencies = (t) => console.log('SuperCollider dependencies: ', t)
system.sc.print = (t) => console.log('SuperCollider: ', t)
system.sc.printErr = (t) => console.error('SuperCollider error: ', t)
system.sc.setStatus = (t) => console.log('SuperCollider status: ', t)

system.sc.sendOSC_t = (name, tags, ...args) => {
  for (let i = 0; i < args.length; i++) {
    args[i] = { type: tags[i], value: args[i] }
  }
  let data  = osc.writePacket({ address: name, args: args }, { metadata: true })
  let ep    = system.sc.oscDriver[57110]
  let rcv   = ep ? ep['receive'] : undefined
  if (typeof rcv == 'function') rcv(57120, data)
}

system.sc.nodeId = 0
system.sc.play = (time, synthDef, amp, freq) => {
  system.sc.nodeId++
  let id = system.sc.nodeId
  setTimeout(() => {
    system.sc.sendOSC_t('/s_new', 'siiisfsf', synthDef, id, 1, 0, 'amp', amp, 'freq', freq)
  }, (time - system.timeNow())*1000)
  return id
}
system.sc.free = (time, id) => {
  setTimeout(() => {
    system.sc.sendOSC_t('/n_free', 'i', id)
  }, (time - system.timeNow() + 0.01)*1000)
}

system.add = (startTime, update) => {
  system.queued.push({t:startTime, update:update})
}

let state = {}
system.frame = (time, count) => {
  move(system.queued, system.active, ({t}) => time > t)
  state.count = count
  state.time = time
  filterInPlace(system.active, ({update}) => update(state))
}

let booted = false
system.resume = () => {
  if (!booted) {
    //["-u", "57110", "-D", "0", "-i", "0", "-o", "2"]
    console.log('Supercollider booting with ', system.sc['arguments'])
    system.sc.callMain(system.sc['arguments'])
    booted = true
  }
}

const startTime = performance.now()
system.timeNow = function () {
  return (performance.now() - startTime)/1000
}

system.latency = () => {
  return 0 // ??? 
}

system.mainAmp = (amp) => {
  if (typeof amp == 'number') {
    system.mainAmpValue = amp
    // ???
  }
  return system.mainAmpValue
}
system.mainAmpUi = (amp) => {
  if (typeof amp == 'number') {
    system.mainAmpUiValue = amp
    // ???
  }
  return system.mainAmpUiValue
}

system.compressorReduction = () => {
  if (!system.compressor) { return 0 }
  // ???
}

system.spectrum = () => {
    // ???
    return [0,0,0,0]
}
system.scope = () => {
  let data = new Float32Array(system.analyser.fftSize)
  // ???
  return data
}

system.mix = function (node) {
    // ???
  }

system.mainReverb = (reverb) => {
  if (typeof reverb == 'number') {
    // ???
  }
  return 0//system.vcaReverb.gain.value
}

return system;
});
