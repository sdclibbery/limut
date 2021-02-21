const {app, BrowserWindow} = require('electron')
  const path = require('path')
  const url = require('url')
  
  function createWindow () {
    win = new BrowserWindow({width: 1280, height: 800})
    win.loadURL(`file://${__dirname}/index.html`);
  }  
  app.on('ready', createWindow)
