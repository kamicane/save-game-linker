import path from 'node:path'
import fse from 'fs-extra'
import createDesktopShortcut from 'create-desktop-shortcuts'

import { LinkError } from './util.js'

async function processGameShortcut (gameName, gameObj, argv) {
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

    let created = true

    created = createDesktopShortcut({
      verbose: false,
      windows: shortcut
    })

    // if (!created) console.log(`  The shortcut ${nicePath(path.join(argv.shortcutsDir, gameName), 'red')} was not created`)
    if (!created) throw new LinkError(exeFullPath, 'CREATE_DESKTOP_SHORTCUTS')
    else return shortcut.outputPath
    // else console.log(`  The shortcut ${nicePath(shortcut.outputPath, 'green')} was created`)
  } else {
    throw new LinkError(exeFullPath, 'EXE_NOT_FOUND')
    // return new Error('')
    // console.log(`  The shortcut ${nicePath(path.join(argv.shortcutsDir, gameName), 'red')} was not created (${chalk.red(exeFullPath)} not found)`)
  }
}

export default async function * processGameShortcuts (gameList, argv) {
  for (const gameName in gameList) {
    const gameObj = gameList[gameName]
    if (gameObj.exe == null) {
      yield [gameName, null]
      continue
    }
    try {
      yield [gameName, await processGameShortcut(gameName, gameObj, argv)]
    } catch (err) {
      yield [gameName, err]
    }
  }
}
