import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { exec } from 'node:child_process'
import { EventEmitter } from 'node:events'

import fse from 'fs-extra'

const execp = promisify(exec)

function createShortcutString (shortcutLocation, props) {
  return `
    $WshShell = New-Object -ComObject WScript.Shell;
    $Shortcut = $WshShell.CreateShortcut("${path.normalize(shortcutLocation)}");
    $Shortcut.TargetPath = "${path.normalize(props.TargetPath)}";
    $Shortcut.Arguments = "${props.Arguments}";
    $Shortcut.IconLocation = "${props.IconLocation},0";
    $Shortcut.WorkingDirectory = "${path.normalize(props.WorkingDirectory)}";
    $Shortcut.Description = "${props.Description}";
    $Shortcut.Save();
  `
}

export default class GameShortcuts extends EventEmitter {
  async processGame (gameName, gameObj, argv) {
    const exe = gameObj.exe.replace(/^~\//, `${os.homedir()}/`)

    const exeFullPath = path.resolve(argv.gamesDir, gameName, exe)
    const exeExists = await fse.exists(exeFullPath)

    const iconPath = path.join(argv.iconDir, `${gameName}.ico`)
    const iconExists = await fse.exists(iconPath)

    if (exeExists) {
      const shortcutLocation = path.join(argv.shortcutsDir, `${gameName}.lnk`)

      const workingDir = path.isAbsolute(exe) ? path.dirname(exe) : path.join(argv.gamesDir, gameName)

      const shortcutString = createShortcutString(shortcutLocation, {
        TargetPath: exeFullPath,
        Arguments: gameObj.args || '',
        IconLocation: iconExists ? iconPath : '',
        WorkingDirectory: workingDir,
        Description: argv.appName
      })

      this.emit('game-info', gameName, { type: 'create', item: shortcutLocation })
      return shortcutString
    } else {
      this.emit('game-info', gameName, { type: 'noop', message: 'exe_not_found', item: exeFullPath })
      return null
    }
  }

  async process (gameList, argv) {
    const psCommandStrings = []
    for (const gameName in gameList) {
      const gameObj = gameList[gameName]
      this.emit('game-start', gameName, gameObj)

      if (gameObj.exe == null) {
        this.emit('game-info', gameName, { type: 'noop', message: 'no_exe' })
        continue
      }

      const commandString = await this.processGame(gameName, gameObj, argv)
      if (commandString != null) {
        psCommandStrings.push(commandString)
      }
    }

    if (psCommandStrings.length > 0) {
      return execp(psCommandStrings.join('\n'), { shell: 'powershell' })
    }
  }
}
