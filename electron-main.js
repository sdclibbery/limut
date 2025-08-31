const {app, BrowserWindow} = require('electron')

app.commandLine.appendSwitch('disable-serial-blocklist')

app.on('ready', () => {
  mainWindow = new BrowserWindow({width: 1280, height: 800})
  mainWindow.webContents.session.on('select-serial-port', (event, portList, webContents, callback) => {
    event.preventDefault()
    console.log('Available serial ports:', portList)
    if (portList.length > 0) {
      let portNameTarget = 'cu.debug-console'//'dmx'
      const selectedPort = portList.filter(p => p.portName.toLowerCase().includes(portNameTarget))[0] // First port that includes the target string
      if (!!selectedPort) {
        console.log(`Programmatically selecting port: ${selectedPort.portName} ${selectedPort.portId}`)
        callback(selectedPort.portId)
        return
      }
    }
    console.log('No serial ports found.')
    callback('') // No port selected
  })
  mainWindow.loadURL(`file://${__dirname}/index.html`)
})
