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
  // Sep 2026: measured again, and a stereo *sample* is not clean after all - the same climb happens
  // with no worklet anywhere in the graph. `p1 audiosynth, play={noise{}>>hpf4{1500}}` at bpm=1410
  // (the white noise buffer is 2 channel) climbed 0.26 -> 0.35 over 90s and sat at 0.37 for the
  // whole minute after window.stop(), against 0.004 for the same patch with no filter in it. So a
  // buffer source reports its width from its buffer here, and any per-note filter it feeds is
  // pinned like a worklet's.
  //
  // **Fixed upstream.** Re-measured Sep 2026 on Electron 44 (Chromium 152) with this whole file's
  // fix reverted: both repros are then flat and fall to 0.004 after the stop - the bare
  // `p1 superosc, dur=1/8, lpf=20000, unison=3` one and the `noise{}>>hpf4{1500}` one. So Chromium
  // fixed the reconfiguration leak somewhere between 136 (Electron 36, where everything above was
  // measured) and 152. What follows is kept for older browsers, where it is cheap and correct - it
  // is not dead code until limut stops caring about pre-152 Chromium. The AudioParam leak
  // documented in play/eval-audio-params.js is a different bug and is NOT fixed in 152.
  //
  // A source only pins the filters it connects to *directly*, and keytar's does not: its stereo
  // superosc reaches the player's `hpf` through the merge in play/synth/audiosynth.js, and a
  // GainNode carries no width tag. So a wide source also tags the *event* (`_limutChannels`), and
  // every per-note filter built for that event is pinned to it however many gains, mergers or
  // passthrough nodes sit in between. The cost is that a filter on a mono sub-chain of a stereo
  // note (keytar's `noise{} >> hpf4{1500}`) is pinned to 2 and up-mixes, which is inaudible - the
  // note is summed into a stereo bus regardless.
  let outputChannels = (node) => {
    if (!node) { return 1 }
    if (node._limutChannels) { return node._limutChannels }
    // An AudioBufferSourceNode knows its width from its buffer, before it ever renders
    if (node.buffer && node.buffer.numberOfChannels > 1) { return node.buffer.numberOfChannels }
    return 1
  }

  // The width of the note being built, ie the widest source anything in this event has created.
  let noteChannels = (params) => (params && params._limutChannels) || 1
  // Record a source's width on the event. Never narrows: one mono source in a stereo note does not
  // make the note mono.
  let tagNoteChannels = (params, channels) => {
    if (params && channels > noteChannels(params)) { params._limutChannels = channels }
    return channels
  }
  // Tag both the node and its event from whatever the node itself reports, for sources that know
  // their own width (a buffer source with its buffer already loaded, a stereo worklet).
  let tagSource = (node, params) => {
    tagNoteChannels(params, outputChannels(node))
    return node
  }

  // Pin `dest` before it is connected, to the wider of the source feeding it and the note being
  // built. No-op unless that width is known to be wider than mono and the destination is a filter,
  // so the common mono path is untouched.
  let matchInputChannels = (source, dest, params) => {
    let channels = Math.max(outputChannels(source), noteChannels(params))
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

    let stereoBuffer = system.audio.createBufferSource() // A buffer source reports its buffer's width
    stereoBuffer.buffer = system.audio.createBuffer(2, 128, system.audio.sampleRate)
    assert(2, outputChannels(stereoBuffer), 'a stereo buffer source is stereo')
    let monoBuffer = system.audio.createBufferSource()
    monoBuffer.buffer = system.audio.createBuffer(1, 128, system.audio.sampleRate)
    assert(1, outputChannels(monoBuffer), 'a mono buffer source is mono')
    assert(1, outputChannels(system.audio.createBufferSource()), 'an unloaded buffer source is assumed mono')

    let note = {} // The note's width pins a filter even with nothing tagged upstream of it
    assert(1, noteChannels(note), 'an untouched note is mono')
    tagSource(stereoBuffer, note)
    assert(2, noteChannels(note), 'a stereo source makes the note stereo')
    tagSource(monoBuffer, note)
    assert(2, noteChannels(note), 'a mono source never narrows the note')
    let merged = system.audio.createGain() // Stands in for the audiosynth merge: carries no tag
    let noteFed = system.audio.createBiquadFilter()
    matchInputChannels(merged, noteFed, note)
    assert('explicit', noteFed.channelCountMode, 'the note width pins a filter behind an untagged gain')
    assert(2, noteFed.channelCount)

    let monoNote = system.audio.createBiquadFilter()
    matchInputChannels(merged, monoNote, {})
    assert('max', monoNote.channelCountMode, 'a mono note leaves the filter alone')
    assert(1, noteChannels(undefined), 'no event at all is mono')

    console.log('Node channels tests complete')
  }

  return {outputChannels, noteChannels, tagNoteChannels, tagSource, matchInputChannels}
})
