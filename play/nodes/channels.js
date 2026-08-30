'use strict';
define(function (require) {

  // Keeping a per-note BiquadFilter from being widened after it starts rendering.
  //
  // A BiquadFilter is created with channelCountMode 'max', so it adopts the channel count of
  // whatever connects to it. Chromium reallocates the filter's per-channel DSP state when that
  // happens, and doing it to a *worklet-fed* filter leaves something permanently resident on the
  // audio thread: the cost never comes back, not on note end and not on Ctrl-. With a filter built
  // per note, every note pays again, so render capacity climbs until the thread misses its
  // deadline and the audio drops out.
  //
  // Measured Aug 2026, Electron, `p1 superosc, dur=1/8, amp=1/32, lpf=20000, unison=3` (only ~16
  // notes/sec and 4-11 voices, nowhere near saturation): render capacity climbed 0.20 -> 0.33 over
  // 100s and stayed at 0.21-0.30 with p90 0.99 for the whole 50s after window.stop(), with zero
  // voices and a node census showing an empty graph. The same patch with the same DSP but a mono
  // source (`unison={3,pan:0}`) sat flat and fell back to 0.0096 within 15s of stopping, and so did
  // the same stereo source with no filter at all. Pinning the filter's channel count - the fix
  // below - made the stereo case flat and clean too, 0.0097 after stopping.
  //
  // Only superosc with a stereo unison pan spread is wider than mono, so only it tags itself. A
  // stereo *sample* into a filter measured clean (an AudioBufferSourceNode knows its width from the
  // buffer before it ever renders), so nothing here touches that path: an untagged source keeps
  // today's 'max' behaviour rather than being pinned to a width we would only be guessing at.
  let outputChannels = (node) => (node && node._limutChannels) || 1

  // Pin `dest` to the width of `source` before they are connected. No-op unless the source is known
  // to be wider than mono and the destination is a filter, so the common mono path is untouched.
  let matchInputChannels = (source, dest) => {
    let channels = outputChannels(source)
    if (channels < 2) { return dest }
    if (!(dest instanceof BiquadFilterNode)) { return dest }
    dest.channelCountMode = 'explicit'
    dest.channelCount = channels
    dest._limutChannels = channels // Carry the width on down the chain, eg to a second filter stage
    return dest
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let system = require('play/system')
    let assert = (expected, actual, msg) => {
      if (expected !== actual) { console.trace(`Assertion failed ${msg||''}.\n>>Expected: ${expected}\n>>Actual:   ${actual}`) }
    }

    assert(1, outputChannels(undefined), 'nothing is mono')
    assert(1, outputChannels(system.audio.createGain()), 'an untagged node is assumed mono')
    let stereo = system.audio.createGain()
    stereo._limutChannels = 2
    assert(2, outputChannels(stereo), 'a tagged node reports its width')

    let filter = system.audio.createBiquadFilter()
    matchInputChannels(stereo, filter)
    assert('explicit', filter.channelCountMode, 'a stereo source pins the filter')
    assert(2, filter.channelCount)
    assert(2, outputChannels(filter), 'the pinned filter carries the width onward')

    let monoFed = system.audio.createBiquadFilter()
    matchInputChannels(system.audio.createGain(), monoFed)
    assert('max', monoFed.channelCountMode, 'a mono source leaves the filter alone')

    let gain = system.audio.createGain() // Only filters are reconfigured; everything else is left as is
    matchInputChannels(stereo, gain)
    assert('max', gain.channelCountMode, 'a non filter destination is left alone')

    console.log('Node channels tests complete')
  }

  return {outputChannels, matchInputChannels}
})
