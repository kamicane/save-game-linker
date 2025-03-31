import path from 'node:path'
import { EventEmitter } from 'node:events'

import fse from 'fs-extra'
import createDesktopShortcut from 'create-desktop-shortcuts'

export default class GameShortcuts extends EventEmitter {
  async processGame (gameName, gameObj, argv) {
    const exeFullPath = path.join(argv.gamesDir, gameName, gameObj.exe)
    const exeExists = await fse.exists(exeFullPath)

    const iconPath = path.join(argv.iconDir, `${gameName}.ico`)
    const iconExists = await fse.exists(iconPath)

    if (exeExists) {
      if (iconExists) {
        this.emit('game-info', gameName, { message: iconPath })
      }
      const shortcut = {
        filePath: exeFullPath,
        outputPath: argv.shortcutsDir,
        workingDirectory: path.join(argv.gamesDir, gameName),
        name: gameName,
        icon: iconExists ? iconPath : '',
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

  async process (gameList, argv) {
    for (const gameName in gameList) {
      const gameObj = gameList[gameName]
      this.emit('game-start', gameName, gameObj)

      if (gameObj.exe == null) {
        this.emit('game-info', gameName, { type: 'noop', reason: 'no_exe' })
        continue
      }
      try {
        await this.processGame(gameName, gameObj, argv)
      } catch (err) {
        this.emit('game-error', gameName, err)
      }
    }
  }
}
