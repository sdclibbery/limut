const {app, BrowserWindow} = require('electron')

app.commandLine.appendSwitch('disable-serial-blocklist')

app.on('ready', () => {
  mainWindow = new BrowserWindow({width: 1280, height: 800})
  mainWindow.webContents.session.on('select-serial-port', (event, portList, webContents, callback) => {
    event.preventDefault()
    console.log('Available serial ports:', portList)
    if (portList.length > 0) {
      let portNameTarget = 'cu.usbserial'//'cu.debug-console'
      let selectedPort = portList.filter(p => p.portName.toLowerCase().includes(portNameTarget))[0] // First port that includes the target string
      if (!!selectedPort) {
        console.log(`DMX using serial port: ${selectedPort.portName} ${selectedPort.portId}`)
        callback(selectedPort.portId)
        return
      }
      selectedPort = portList.filter(p => p.portName.toLowerCase().includes('debug'))[0] // Fallback to debug console to allow dev work without a physical dmx controller attached
      if (!!selectedPort) {
        console.log(`No DMX serial ports found, falling back to ${selectedPort.portName} ${selectedPort.portId}.`)
        callback(selectedPort.portId)
        return
      }
    }
    console.log('No DMX serial ports found.')
    callback('') // No port selected
  })
  mainWindow.loadURL(`file://${__dirname}/index.html`)
})
