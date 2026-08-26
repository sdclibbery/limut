// Electron-only bridge into the page. Currently just the audio thread load readout that
// electron-audio-load.js polls out of Chromium; play/system.js feature-detects this, so
// its absence is what tells the browser build there is no Audio meter to show.
const {contextBridge, ipcRenderer} = require('electron')

let latest = null
ipcRenderer.on('limut:audio-load', (event, load) => { latest = load })

contextBridge.exposeInMainWorld('limutElectron', {
  // {renderCapacity, callbackIntervalMean, callbackIntervalVariance}, or null when
  // there is no reading yet (nothing polled so far, or the last poll failed).
  audioLoad: () => latest,
})
