'use strict';

let inited = false
let port
let writer
let init = async () => {
  inited = true
  // let deviceCriteria = {filters: [{usbVendorId: 0x0403}]}
  let ports = await navigator.serial.getPorts()//deviceCriteria)
  console.log('DMX available ports: ', ports)
  if (ports.length === 0) {
    console.log('🔴 Cannot use DMX: No ports found')
    return
  }
  port = ports[0] // Just pick the first for now
  console.log(`🔵 Using DMX port: ${port.getInfo().usbVendorId}:${port.getInfo().usbProductId}:${port.getInfo().bluetoothServiceClassId}`)
  await port.open({
    baudRate: 250000,
    dataBits: 8,
    stopBits: 2,
    parity: "none",
  })
  writer = await port.writable.getWriter()
}

let waitUntil = async (time) => {
  while (performance.now() < time - 1) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  while (performance.now() < time) {
    // busy wait up to 1 ms
  }
}

let lastSendTime = 0
let sendData = async (data) => {
  await waitUntil(lastSendTime + 25) // wait till 25 milliseconds after last send to give max 40hz updates
  lastSendTime = performance.now()
  
  port.setSignals({break: true, requestToSend: false}) // Break
  await waitUntil(performance.now() + 0.1)

  port.setSignals({break: false, requestToSend: false}) // Mark After Break
  await waitUntil(performance.now() + 0.015)

// console.log('DMX sending:', data)
  writer.write(data)
}

let data
let started = false
let loop = async () => {
  await sendData(data)
  setTimeout(loop, 0)
}
onmessage = (e) => {
  if (!inited) { init() }
  if (!writer) { console.log('DMX writer not inited'); return }
  if (!writer.ready) { console.log('DMX writer not ready'); return }
  data = e.data
   if (!started) {
    started = true
    loop()
  }
}