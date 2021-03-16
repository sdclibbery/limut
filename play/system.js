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

system.sc.oscMsg = (name, tags, ...args) => {
  for (let i = 0; i < args.length; i++) {
    args[i] = { type: tags[i], value: args[i] }
  }
  return { address: name, args: args }
}
system.sc.sendOSC = (data) => {
  let ep    = system.sc.oscDriver[57110]
  let rcv   = ep ? ep['receive'] : undefined
  if (typeof rcv == 'function') rcv(57120, data)
}
system.sc.nodeId = 1000
system.sc.nextNode = () => {
  system.sc.nodeId++
  return system.sc.nodeId
}
system.sc.busId = 10
system.sc.nextBus = () => {
  system.sc.busId++
  if (system.sc.busId >= 999) {
    system.sc.busId = 10
  }
  return system.sc.busId
}
system.sc.dumpTree = () => {
  system.sc.sendOSC(osc.writePacket(system.sc.oscMsg('/g_dumpTree', 'ii',0,0)))
}
system.sc.dumpOSC = () => {
  system.sc.sendOSC(osc.writePacket(system.sc.oscMsg('/dumpOSC', 'i',1)))
}

system.sc.addSynthDef = (synthDefBin) => {
  if (synthDefBin.done === undefined) {
    system.sc.sendOSC(osc.writePacket(system.sc.oscMsg('/d_recv', 'b', synthDefBin)))
    synthDefBin.done = true
  }
}
system.sc.play = (synthDef, freq) => {
  system.sc.bundle = []
  system.sc.bundleGroup = system.sc.nextNode()
  system.sc.bus = system.sc.nextBus()
  system.sc.bundle.push(system.sc.oscMsg('/g_new', 'iii', system.sc.bundleGroup, 0, 0))
  let id = system.sc.nextNode()
  system.sc.bundle.push(system.sc.oscMsg('/s_new', 'siiisisf', synthDef, id, 0, system.sc.bundleGroup, 'bus', system.sc.bus, 'freq', freq))
  return id
}
system.sc.commit = (time) => {
  let bundleTime = Math.max(time - system.timeNow(), 0)
  let tt = osc.timeTag(bundleTime)
  system.sc.sendOSC(osc.writeBundle({timeTag: tt, packets: system.sc.bundle}))
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
