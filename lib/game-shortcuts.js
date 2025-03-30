import path from 'node:path'
import { EventEmitter } from 'node:events'

import fse from 'fs-extra'
import createDesktopShortcut from 'create-desktop-shortcuts'

export default class GameShortcuts extends EventEmitter {
  constructor (argv) {
    super()
    this.argv = argv
  }

  async processGame (gameName, gameObj) {
    const argv = this.argv

    const exeFullPath = path.join(argv.gamesDir, gameName, gameObj.exe)
    const exeExists = await fse.exists(exeFullPath)

    if (exeExists) {
      const shortcut = {
        filePath: exeFullPath,
        outputPath: argv.shortcutsDir,
        workingDirectory: path.join(argv.gamesDir, gameName),
        name: gameName,
        comment: argv.appName,
        arguments: gameObj.args || ''
      }

      const created = createDesktopShortcut({
        verbose: false,
        windows: shortcut
      })

      if (!created) this.emit('game-info', gameName, { type: 'noop', item: exeFullPath, reason: 'CREATE_DESKTOP_SHORTCUTS_ERROR' })
      else this.emit('game-info', gameName, { type: 'create', item: shortcut.outputPath })
    } else {
      this.emit('game-info', gameName, { type: 'noop', reason: 'exe_not_found', item: exeFullPath })
    }
  }

  async process (gameList) {
    for (const gameName in gameList) {
      const gameObj = gameList[gameName]
      this.emit('game-start', gameName, gameObj)

      if (gameObj.exe == null) {
        this.emit('game-info', gameName, { type: 'noop', reason: 'no_exe' })
        continue
      }
      try {
        await this.processGame(gameName, gameObj)
      } catch (err) {
        this.emit('game-error', gameName, err)
      }
    }
  }
}
