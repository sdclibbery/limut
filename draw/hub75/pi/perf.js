'use strict'
// Drive a display at 60Hz with a realistic shader and report what it manages.
//
//   node draw/hub75/pi/perf.js [host:port] [seconds]
//
// The question this answers is the one PROTOCOL.md §11 exists for and CLAUDE.md lists as open:
// can the Pi sustain render + readback + output at 60Hz for the panel size, and what degrades
// first if it cannot. The display's own `stat` messages are the measurement — fps, renderMs,
// dropped, temp and the latching throttled bitmask — so this only has to keep the stream fed and
// print what comes back.

let crypto = require('node:crypto')
let codec = require('../codec')

let EP = process.argv[2] || 'hub75-01.local:7575'
let SECONDS = parseInt(process.argv[3] || '20', 10)
let hash = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16)

// Heavier than a gradient and lighter than a shadertoy port: enough per-pixel work that the GPU
// is doing something real, so renderMs means something.
let FRAG = `#version 300 es
precision highp float;
in vec2 fragCoord;
out vec4 fragColor;
uniform vec4 u_vs0;
uniform vec4 u_vs1;
void main() {
  vec4 v0 = vec4(fragCoord, 0.0, 1.0);
  vec2 p = v0.xy * u_vs0.x;
  float a = 0.0;
  for (int i = 0; i < 8; i++) {
    p = abs(p) / dot(p, p) - u_vs1.xy;
    a += length(p);
  }
  fragColor = vec4(sin(a + u_vs0.y) * 0.5 + 0.5, sin(a * 1.3 + u_vs0.z) * 0.5 + 0.5,
                   sin(a * 1.7 + u_vs0.w) * 0.5 + 0.5, 1.0);
}
`

let run = async () => {
  let info = await (await fetch(`http://${EP}/info`)).json()
  console.log(`${info.name} at ${EP}: ${info.display.w}x${info.display.h}, ${info.gl.renderer}`)
  console.log(`driving 60Hz for ${SECONDS}s\n`)

  let s = new WebSocket(`ws://${EP}/session`)
  s.binaryType = 'arraybuffer'
  let stats = []
  let ready = null
  s.addEventListener('message', (e) => {
    if (typeof e.data !== 'string') { return }
    let m = JSON.parse(e.data)
    if (m.type === 'stat') { stats.push(m); return }
    if (ready) { ready(m); ready = null }
  })
  let next = () => new Promise(r => { ready = r })
  await new Promise((res, rej) => {
    s.addEventListener('open', res)
    s.addEventListener('error', () => rej(new Error(`cannot reach the display at ${EP}`)))
  })
  s.send(JSON.stringify({ type: 'hello', proto: 1, client: 'perf', takeover: true }))
  await next()

  let id = hash(Buffer.from(FRAG, 'utf8'))
  s.send(JSON.stringify({ type: 'prog', id, frag: FRAG, uniforms: ['u_vs0', 'u_vs1'] }))
  let m = await next()
  if (m.type !== 'progok') { throw new Error('program rejected: ' + JSON.stringify(m)) }
  s.send(JSON.stringify({ type: 'layer', id: 0, prog: id, textures: [] }))

  let seq = 1, sent = 0, t0 = Date.now()
  console.log('   t   host fps   display fps   renderMs   dropped   temp   throttled')
  let timer = setInterval(() => {
    let t = (Date.now() - t0) / 1000
    // §12.1: skip rather than queue when the socket is backed up — a queued uniform frame is
    // stale by definition. bufferedAmount is the host-side rule and applies here too.
    if (s.bufferedAmount > 128 * 1024) { return }
    s.send(codec.encodeFrame({
      seq: seq++, dim: 1, beat: t * 2, hostTime: t,
      layers: [{ id: 0, uniforms: [[0.6 + Math.sin(t) * 0.2, t, t * 1.3, t * 1.7], [0.9, 0.7, 0, 0]] }],
    }))
    sent++
  }, 1000 / 60)

  let lastLen = 0
  let report = setInterval(() => {
    while (lastLen < stats.length) {
      let st = stats[lastLen++]
      let t = ((Date.now() - t0) / 1000).toFixed(0).padStart(4)
      console.log(`${t}s ${String(sent).padStart(9)} ${String(st.fps).padStart(13)} ` +
                  `${st.renderMs.toFixed(2).padStart(10)} ${String(st.dropped).padStart(9)} ` +
                  `${st.temp.toFixed(1).padStart(6)} ${('0x' + st.throttled.toString(16)).padStart(11)}`)
      sent = 0
    }
  }, 250)

  await new Promise(r => setTimeout(r, SECONDS * 1000))
  clearInterval(timer)
  clearInterval(report)
  await new Promise(r => setTimeout(r, 400))

  let mid = stats.slice(2)   // the first second or two includes connection and compile
  if (mid.length) {
    let fps = mid.map(x => x.fps)
    let ms = mid.map(x => x.renderMs)
    let avg = (a) => a.reduce((s2, v) => s2 + v, 0) / a.length
    console.log(`\nsteady state over ${mid.length}s:`)
    console.log(`  fps       mean ${avg(fps).toFixed(1)}  min ${Math.min(...fps)}  max ${Math.max(...fps)}`)
    console.log(`  renderMs  mean ${avg(ms).toFixed(2)}  max ${Math.max(...ms).toFixed(2)}`)
    console.log(`  dropped   ${mid[mid.length - 1].dropped - mid[0].dropped} over the window`)
    console.log(`  temp      ${mid[mid.length - 1].temp.toFixed(1)}C`)
    console.log(`  throttled 0x${mid[mid.length - 1].throttled.toString(16)}` +
                (mid[mid.length - 1].throttled ? '  ⚠️  undervoltage or thermal throttling' : ''))
  }
  s.close()
  process.exit(0)
}

run().catch(e => { console.error('🔴 perf crashed:', e && e.stack || e); process.exit(1) })
