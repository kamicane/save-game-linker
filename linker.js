#!/usr/bin/env node

import os from 'node:os'
import path from 'node:path'
import fse from 'fs-extra'

import chalk from 'chalk'
import yaml from 'yaml'
import yargs from 'yargs/yargs'

import createDesktopShortcut from 'create-desktop-shortcuts'
import { readVdf, writeVdf } from 'steam-binary-vdf'
import SteamCat from 'steam-categories'
import { crc32 } from 'node:zlib'

let HOME_DIR
let DRY_RUN

function genSteamAppId (exePath) {
  const crc = crc32(exePath + '\0') // Append null byte
  return (crc | 0x80000000) >>> 0 // Set highest bit
}

async function decodeSteamShortcut (file) {
  const inBuffer = await fse.readFile(file)
  return readVdf(inBuffer)
}

async function encodeSteamShortcut (file, obj) {
  const outBuffer = writeVdf(obj)
  await fse.writeFile(file, outBuffer)
}

function nicePath (p, color = 'blue') {
  // return path.relative(HOME_DIR, p)
  return chalk[color](p.replace(HOME_DIR, '~'))
}

async function linkSave (srcPath, dstPath) {
  if (!DRY_RUN) {
    await fse.mkdirp(path.dirname(dstPath))
    await fse.symlink(srcPath, dstPath, process.platform === 'win32' ? 'junction' : 'dir')
  }
  console.log(`  linked ${nicePath(dstPath, 'yellow')} to ${nicePath(srcPath, 'blue')}`)
}

async function processGameSave (gameName, saveDir, savesDir) {
  const srcDir = path.join(savesDir, gameName)

  let srcStat
  try {
    srcStat = await fse.stat(srcDir)
  } catch (err) { }

  const srcReal = srcStat ? await fse.realpath(srcDir) : null

  let dstStat
  try {
    dstStat = await fse.stat(saveDir)
  } catch (err) { }

  const dstReal = dstStat ? await fse.realpath(saveDir) : null

  // scenarios
  // 1: source directory exists, destination does not exist = link
  // 2: source directory exists, destination exists, not already linked = delete destination and link
  // 2: source directory exists, destination exists, already linked = log
  // 2: source directory does not exist, destination exists and is directory = move destination to source and link
  // 2: source directory does not exist, destination exists and is not directory = warn
  // 2: source directory does not exist, destination does not exist = do nothing, no warn

  if (srcStat && srcStat.isDirectory()) {
    if (dstReal === srcReal) {
      console.log(`  ${nicePath(saveDir, 'yellow')} is already linked to ${nicePath(srcDir, 'blue')}`)
    } else {
      try {
        const lstat = await fse.lstat(saveDir)
        if (lstat && !DRY_RUN) await fse.rm(saveDir, { recursive: true, force: true })
        if (lstat) console.log(`  ${nicePath(saveDir, 'red')} was deleted`)
      } catch (err) { }
      await linkSave(srcDir, saveDir)
    }
  } else if (dstStat && dstStat.isDirectory()) {
    try {
      const lstat = await fse.lstat(srcDir)
      if (lstat && !DRY_RUN) await fse.rm(srcDir, { recursive: true, force: true })
      if (lstat) console.log(`  ${nicePath(srcDir, 'red')} was deleted`)
    } catch (err) { }
    if (!DRY_RUN) await fse.rename(saveDir, srcDir)
    console.log(`  moved ${nicePath(saveDir, 'blue')} to ${nicePath(savesDir, 'blue')}`)
    await linkSave(srcDir, saveDir)
  }
}

async function processGameShortcut (gameName, gameExe, gameArgs, gamesDir, shortcutsDir) {
  const exeFullPath = path.join(gamesDir, gameName, gameExe)
  const exeExists = await fse.exists(exeFullPath)

  if (exeExists) {
    const shortcut = {
      filePath: exeFullPath,
      outputPath: shortcutsDir,
      workingDirectory: path.join(gamesDir, gameName),
      name: gameName,
      comment: 'sgl',
      arguments: gameArgs || ''
    }

    let created = true

    if (!DRY_RUN) {
      created = createDesktopShortcut({
        verbose: false,
        windows: shortcut
      })
    }

    if (!created) console.log(`  The shortcut ${nicePath(path.join(shortcutsDir, gameName), 'red')} was not created`)
    else console.log(`  The shortcut ${nicePath(shortcut.outputPath, 'green')} was created`)
  } else {
    console.log(`  The shortcut ${nicePath(path.join(shortcutsDir, gameName), 'red')} was not created (${chalk.red(exeFullPath)} not found)`)
  }
}

async function processSteamShortcut (gameName, gameExe, gameArgs, gamesDir) {
  const exeFullPath = path.join(gamesDir, gameName, gameExe)
  const exeExists = await fse.exists(exeFullPath)

  if (exeExists) {
    const steamShortcut = {
      appid: genSteamAppId(path.join(gameName, gameExe)),
      appname: gameName,
      Exe: `"${exeFullPath}"`,
      StartDir: `"${path.join(gamesDir, gameName)}"`,
      LaunchOptions: gameArgs || '',
      tags: { 0: 'sgl' }
    }

    console.log(`  Local Steam AppId: ${chalk.blue(steamShortcut.appid)}`)

    return steamShortcut
  } else {
    console.log(`  Steam Shortcut not created: ${chalk.red(exeFullPath)} not found`)

    return null
  }
}

async function writeSteamShortcuts (steamUserId, steamShortcuts, steamShortcutsFile, steamLevelDB, steamCollection) {
  if (DRY_RUN) return // todo

  const oldShortcutsVdf = await decodeSteamShortcut(steamShortcutsFile)

  const oldShortcuts = {}
  const allShortcuts = []

  for (const steamShortcut of Object.values(oldShortcutsVdf.shortcuts)) {
    const isSGLGame = Object.values(steamShortcut.tags).includes('sgl')
    if (!isSGLGame) allShortcuts.push(steamShortcut)
    else oldShortcuts[steamShortcut.appid] = steamShortcut
  }

  for (const steamShortcut of steamShortcuts) {
    const oldShortcut = oldShortcuts[steamShortcut.appid]
    if (oldShortcut) {
      oldShortcut.Exe = steamShortcut.Exe
      oldShortcut.StartDir = steamShortcut.StartDir
      oldShortcut.LaunchOptions = steamShortcut.LaunchOptions
      allShortcuts.push(oldShortcut)
    } else {
      allShortcuts.push(steamShortcut)
    }
  }

  const cats = new SteamCat(steamLevelDB, steamUserId)

  try {
    await cats.read()
  } catch (error) {
    console.log(chalk.red('Error reading steam categories, close Steam before proceeding'))
    return
  }

  let sglCollection = cats.get('save-game-linker')

  if (!sglCollection) {
    sglCollection = cats.add('save-game-linker', {
      name: steamCollection
    })
  }

  sglCollection.value.added = []

  const newShortcutsObj = { shortcuts: {} }

  let steamObjIdx = 0
  for (const steamShortcut of allShortcuts) {
    newShortcutsObj.shortcuts[steamObjIdx++] = steamShortcut
    sglCollection.value.added.push(steamShortcut.appid)
  }

  await encodeSteamShortcut(steamShortcutsFile, newShortcutsObj)
  await cats.save()
  await cats.close()
}

async function init () {
  const confFile = path.join(os.homedir(), '.save-game-linker')
  let configuration

  try {
    const configurationText = await fse.readFile(confFile, 'utf-8')
    configuration = yaml.parse(configurationText)
  } catch (err) { }

  let homeDirDefault = os.homedir()
  let gamesDirDefault = 'C:/Games'
  let shortcutsDirDefault = path.join(homeDirDefault, 'GameLinks')
  let savesDirDefault = path.join(homeDirDefault, 'Dropbox', 'Saves')
  let pathsFileDefault
  let steamDirDefault = 'C:/Program Files (x86)/Steam'
  let steamUserIdDefault

  if (configuration != null) {
    if (configuration.saves_dir) savesDirDefault = path.resolve(configuration.saves_dir)
    if (configuration.games_dir) gamesDirDefault = path.resolve(configuration.games_dir)
    if (configuration.shortcuts_dir) shortcutsDirDefault = path.resolve(configuration.shortcuts_dir)
    if (configuration.paths_file) pathsFileDefault = path.resolve(configuration.paths_file)
    if (configuration.home_dir) homeDirDefault = path.resolve(configuration.home_dir)
    if (configuration.steam_dir) steamDirDefault = path.resolve(configuration.steam_dir)
    if (configuration.steam_user_id) steamUserIdDefault = configuration.steam_user_id
  }

  if (pathsFileDefault == null) {
    pathsFileDefault = path.join(savesDirDefault, 'games.yml')
  }

  const parser = yargs(process.argv.slice(2))

  parser.wrap(parser.terminalWidth())

  parser.scriptName('game-linker')

  parser.demandCommand(1, 'You need to specify at least one command\n')

  parser.command('link-saves', chalk.green('Link savegames'))
  parser.command('steam-shortcuts', chalk.green('Generate steam shortcuts'))
  parser.command('game-shortcuts', chalk.green('Generate game shortcuts'))

  parser.option('home-dir', {
    default: homeDirDefault,
    type: 'string',
    normalize: true,
    describe: `User home directory ${chalk.grey('(all commands)')}`
  })

  parser.option('paths-file', {
    default: pathsFileDefault,
    type: 'string',
    normalize: true,
    describe: `Paths YAML file to use ${chalk.grey('(all commands)')}`
  })

  parser.option('dry-run', {
    default: false,
    type: 'boolean',
    describe: `Do not make any file system modifications ${chalk.grey('(all commands)')}`
  })

  parser.option('saves-dir', {
    default: savesDirDefault,
    type: 'string',
    normalize: true,
    describe: `Directory where to store saves ${chalk.grey('(link-saves)')}`
  })

  parser.option('shortcuts-dir', {
    default: shortcutsDirDefault,
    type: 'string',
    normalize: true,
    describe: `Directory where to store game links ${chalk.grey('(game-shortcuts)')}`
  })

  parser.option('games-dir', {
    default: gamesDirDefault,
    type: 'string',
    normalize: true,
    describe: `Directory where games are located ${chalk.grey('(game-shortcuts, steam-shortcuts)')}`
  })

  parser.option('steam-collection', {
    default: 'Non-Steam Games',
    type: 'string',
    describe: `The collection to add steam shortcuts to ${chalk.grey('(steam-shortcuts)')}`
  })

  parser.option('steam-dir', {
    default: steamDirDefault,
    type: 'string',
    normalize: true,
    describe: `Steam installation directory ${chalk.grey('(steam-shortcuts)')}`
  })

  parser.option('steam-user-id', {
    default: steamUserIdDefault,
    type: 'number',
    normalize: true,
    describe: `Steam user id ${chalk.grey('(steam-shortcuts)')}`
  })

  parser
    .alias('h', 'help')
    .alias('v', 'version')

  parser.epilogue('https://github.com/kamicane/game-linker')

  const argv = parser.parse()
  const commands = argv._

  const pathsFile = path.resolve(argv.pathsFile)

  HOME_DIR = path.resolve(argv.homeDir)

  let steamShortcutsFile, steamLevelDB

  if (commands.includes('steam-shortcuts')) {
    steamShortcutsFile = path.join(argv.steamDir, 'userdata', `${argv.steamUserId}/config/shortcuts.vdf`)
    steamLevelDB = path.join(HOME_DIR, 'AppData/Local/Steam/htmlcache/Local Storage/leveldb')
  }

  DRY_RUN = argv.dryRun

  if (DRY_RUN) {
    console.log(chalk.green('Dry Run Mode\n'))
  }

  console.log('Home Directory      : ', chalk.blue(HOME_DIR))
  console.log('Paths File          : ', chalk.blue(pathsFile))
  if (commands.includes('link-saves')) {
    console.log('Saves Directory     : ', chalk.blue(argv.savesDir))
  }
  if (commands.includes('game-shortcuts')) {
    console.log('Shortcuts Directory : ', chalk.blue(argv.shortcutsDir))
  }
  if (commands.includes('game-shortcuts') || commands.includes('steam-shortcuts')) {
    console.log('Games Directory     : ', chalk.blue(argv.gamesDir))
  }
  if (commands.includes('steam-shortcuts')) {
    console.log('Steam Shortcuts     : ', chalk.blue(steamShortcutsFile))
    console.log('Steam LevelDB       : ', chalk.blue(steamLevelDB))
  }

  const paths = await fse.readFile(pathsFile, 'utf8')
  const gameList = await yaml.parse(paths)

  const steamShortcuts = []

  for (const gameName in gameList) {
    let gameObj = gameList[gameName]

    if (!gameObj) continue

    console.log(`\n${chalk.magenta(gameName)}`)

    if (typeof gameObj === 'string') {
      gameObj = { saves: gameObj }
    }

    if (commands.includes('link-saves')) {
      const saveDir = gameObj.saves?.replace(/^~\//, `${HOME_DIR}/`)
      if (saveDir) await processGameSave(gameName, path.resolve(saveDir), argv.savesDir)
    }

    if (gameObj.exe) {
      if (commands.includes('game-shortcuts')) {
        await processGameShortcut(gameName, gameObj.exe, gameObj.args, argv.gamesDir, argv.shortcutsDir)
      }

      if (commands.includes('steam-shortcuts')) {
        const steamGameObj = await processSteamShortcut(gameName, gameObj.exe, gameObj.args, argv.gamesDir)
        if (steamGameObj) {
          steamShortcuts.push(steamGameObj)
        }
      }
    }
  }

  if (commands.includes('steam-shortcuts')) {
    await writeSteamShortcuts(argv.steamUserId, steamShortcuts, steamShortcutsFile, steamLevelDB, argv.steamCollection)
  }
}

init()
