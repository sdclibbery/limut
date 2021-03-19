'use strict';
define(function (require) {

if (window.Module === undefined) { window.Module == {} }
var sc = window.Module
sc.onRuntimeInitialized = () => console.log('Supercollider runtime initialised')
sc.monitorRunDependencies = (t) => console.log('SuperCollider dependencies: ', t)
sc.print = (t) => console.log('SuperCollider: ', t)
sc.printErr = (t) => console.error('SuperCollider error: ', t)
sc.setStatus = (t) => console.log('SuperCollider status: ', t)

sc.oscMsg = (name, tags, ...args) => {
  for (let i = 0; i < args.length; i++) {
    args[i] = { type: tags[i], value: args[i] }
  }
  return { address: name, args: args }
}
sc.sendOSC = (data) => {
  let ep    = sc.oscDriver[57110]
  let rcv   = ep ? ep['receive'] : undefined
  if (typeof rcv == 'function') rcv(57120, data)
}
sc.dumpOSC = () => {
  sc.sendOSC(osc.writePacket(sc.oscMsg('/dumpOSC', 'i',1)))
}

sc.nodeId = 100
sc.nextNode = () => {
  sc.nodeId++
  if (sc.nodeId >= 3999) {
    sc.nodeId = 100
  }
  return sc.nodeId
}

sc.busId = 10
sc.nextBus = () => {
  sc.busId++
  if (sc.busId >= 7999) {
    sc.busId = 10
  }
  return sc.busId
}

sc.dumpTree = () => {
  sc.sendOSC(osc.writePacket(sc.oscMsg('/g_dumpTree', 'ii',0,0)))
}

const synthDefMixDown = Uint8Array.from(
  // SynthDef("mix-down", { |bus=10,out=0| Out.ar(0, In.ar(bus, 2)); }).add.asBytes.postcs();
  [ 83, 67, 103, 102, 0, 0, 0, 2, 0, 1, 8, 109, 105, 120, 45, 100, 111, 119, 110, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 2, 65, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 98, 117, 115, 0, 0, 0, 0, 3, 111, 117, 116, 0, 0, 0, 1, 0, 0, 0, 3, 7, 67, 111, 110, 116, 114, 111, 108, 1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 1, 1, 2, 73, 110, 2, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 3, 79, 117, 116, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, -1, -1, -1, -1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0 ]
)

sc.addSynthDef = (synthDefBin) => {
  if (synthDefBin.done === undefined) {
    sc.sendOSC(osc.writePacket(sc.oscMsg('/d_recv', 'b', synthDefBin)))
    synthDefBin.done = true
  }
}

sc.play = (synthDef, freq, detuneSemis) => {
  sc.bundle = []
  sc.bundleGroup = sc.nextNode()
  sc.bus = sc.nextBus()
  sc.bundle.push(sc.oscMsg('/g_new', 'iii', sc.bundleGroup, 0, 0))
  let id = sc.nextNode()
  sc.bundle.push(sc.oscMsg('/s_new', 'siiisisfsf', synthDef, id, 0, sc.bundleGroup, 'bus', sc.bus, 'freq', freq, 'detune', detuneSemis||0))
  return id
}

sc.commit = (lastNode, time) => {
  sc.addSynthDef(synthDefMixDown)
  sc.bundle.push(sc.oscMsg('/s_new', 'siiisisi', 'mix-down', sc.nextNode(), 3, lastNode, 'bus', sc.bus, 'out', 0))
  let bundleTime = Math.max(time - sc.system.timeNow(), 0)
  let tt = osc.timeTag(bundleTime)
  sc.sendOSC(osc.writeBundle({timeTag: tt, packets: sc.bundle}))
}

sc.setSynthValue = (node, p, v) => {
 sc.sendOSC(osc.writePacket(sc.oscMsg('/n_set', 'isf', node, p, v)))
}

let booted = false
sc.resume = () => {
  if (!booted) {
    //["-u", "57110", "-D", "0", "-i", "0", "-o", "2"]
    sc['arguments']['-n'] = 4096
    sc['arguments']['-b'] = 8192
    console.log('Supercollider booting with ', sc['arguments'])
    sc.callMain(sc['arguments'])
    booted = true
  }
}

return sc;
});
