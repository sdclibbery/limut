const {app, BrowserWindow} = require('electron')
  const path = require('path')
  const url = require('url')
  
  function createWindow () {
    win = new BrowserWindow({width: 1280, height: 800})
    win.maximize()
    if (app.commandLine.hasSwitch('dev')) {
      win.toggleDevTools()
      win.loadURL(`file://${__dirname}/index.html?test`)
    } else {
      win.loadURL(`file://${__dirname}/index.html`)
    }
  }  
  app.on('ready', createWindow)
