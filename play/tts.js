'use strict';
define(function (require) {
  let system = require('play/system');

  // Text-to-speech buffer cache, modelled on play/samples.js: synthesize speech to
  // an AudioBuffer once per (text + voice-opts) key, returning null while not ready
  // so the synth can stay silent until the buffer exists (same contract as getBuffer).

  let buffers = {}
  let nullBuffer = system.audio.createBuffer(1, 100, 22050)

  // meSpeak (an in-browser espeak port) is loaded from a CDN on first use. The engine
  // (mespeak.js) is a plain IIFE that defines a `meSpeak` object but loads no config or
  // voice on its own. We evaluate it inside a Function sandbox (rather than a <script>
  // tag) so its top-level `var meSpeak` can't leak to / clobber limut's global AMD
  // environment, then point its own loaders at the CDN config + an English voice (this
  // build's loadConfig/loadVoice take URLs, not data, and fetch asynchronously). The
  // jsdelivr CDN serves these with permissive CORS so the cross-origin XHRs succeed.
  let cdn = 'https://cdn.jsdelivr.net/npm/mespeak@1.9.6/'
  let meSpeak = null
  let meSpeakLoading = null

  let loadMeSpeak = () => {
    if (meSpeak) { return Promise.resolve(meSpeak) }
    if (meSpeakLoading) { return meSpeakLoading }
    meSpeakLoading = fetch(cdn + 'mespeak.js').then(r => r.text()).then((src) => {
      let mod = { exports: {} }
      let factory = new Function('require', 'module', 'exports',
        src + '\n;return (typeof meSpeak !== "undefined") ? meSpeak : module.exports;')
      let ms = factory(() => ({}), mod, mod.exports)
      ms.loadConfig(cdn + 'mespeak_config.json')
      ms.loadVoice(cdn + 'voices/en/en.json')
      // loadConfig/loadVoice are async XHRs with no joint completion callback, so poll
      // until both the config and the default voice are in place.
      return new Promise((resolve, reject) => {
        let tries = 0
        let iv = setInterval(() => {
          if (ms.isConfigLoaded() && ms.getDefaultVoice()) {
            clearInterval(iv)
            meSpeak = ms
            console.log('meSpeak TTS ready: voice=' + ms.getDefaultVoice())
            resolve(ms)
          } else if (++tries > 150) { // ~15s
            clearInterval(iv)
            reject(new Error('meSpeak config/voice load timed out (config=' + ms.isConfigLoaded() + ' voice=' + ms.getDefaultVoice() + ')'))
          }
        }, 100)
      })
    }).catch((e) => {
      meSpeakLoading = null
      console.error('Failed to load meSpeak TTS engine', e)
      throw e
    })
    return meSpeakLoading
  }

  // Cache key: same text + voice opts reuse one synthesized buffer. Note transposition
  // is applied later via playbackRate, so it is deliberately not part of the key.
  let cacheKey = (text, opts) => text + '|' + JSON.stringify(opts || {})

  let getTtsBuffer = (text, opts) => {
    if (!text) { return null }
    let key = cacheKey(text, opts)
    let buffer = buffers[key]
    if (buffer === nullBuffer) { return null }
    if (buffer) { return buffer }
    buffers[key] = nullBuffer // mark as synthesizing so we only kick off once
    let clearOnFail = () => { if (buffers[key] === nullBuffer) { delete buffers[key] } }
    loadMeSpeak().then((ms) => {
      if (!ms.isConfigLoaded() || !ms.getDefaultVoice()) {
        console.warn('meSpeak not ready (config=' + ms.isConfigLoaded() + ' voice=' + ms.getDefaultVoice() + ')')
        clearOnFail(); return
      }
      let wav = ms.speak(text, Object.assign({ rawdata: 'ArrayBuffer' }, opts))
      if (!wav || typeof wav === 'number' || !wav.byteLength) {
        console.warn('meSpeak.speak produced no audio for text: ' + JSON.stringify(text))
        clearOnFail(); return
      }
      system.audio.decodeAudioData(wav, (buf) => {
        buffers[key] = buf
      }, (e) => { console.error('meSpeak decode failed', e); clearOnFail() })
    }).catch(clearOnFail)
    return null
  }

  let isReady = () => !!meSpeak && meSpeak.isConfigLoaded() && !!meSpeak.getDefaultVoice()

  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    // Cache-key behaviour only (synthesis needs the browser audio engine plus a CDN
    // fetch, so it is not exercised here to keep the suite offline-safe).
    console.assert(getTtsBuffer('') === null, 'tts: empty text returns null')
    console.assert(cacheKey('hi', {pitch:50}) === cacheKey('hi', {pitch:50}), 'tts: same text+opts share one key')
    console.assert(cacheKey('hi', {pitch:50}) !== cacheKey('hi', {pitch:80}), 'tts: differing opts get distinct keys')
    console.assert(cacheKey('hi', {pitch:50}) !== cacheKey('bye', {pitch:50}), 'tts: differing text get distinct keys')
    console.assert(cacheKey('hi') === cacheKey('hi', {}), 'tts: missing opts treated as empty')
    console.log('tts tests complete')
  }

  return {
    getTtsBuffer: getTtsBuffer,
    isReady: isReady,
  }
})
