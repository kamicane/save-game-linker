#!/usr/bin/env node

import os from 'node:os'
import path from 'node:path'
import fse from 'fs-extra'

import chalk from 'chalk'
import yaml from 'yaml'
import yargs from 'yargs/yargs'

export function nicePath (p, color = 'blue') {
  return chalk[color](p.replace(os.homedir(), '~'))
}

// import SGDB from 'steamgriddb'

// import { CONFIG } from './lib/util.js'
// import { processGameShortcut } from './lib/game-shortcuts.js'
// import { processSteamShortcut, writeSteamShortcuts } from './lib/steam-shortcuts.js'

// async function linkSave (srcPath, dstPath) {
//   if (!CONFIG.DRY_RUN) {
//     await fse.mkdirp(path.dirname(dstPath))
//     await fse.symlink(srcPath, dstPath, process.platform === 'win32' ? 'junction' : 'dir')
//   }
//   console.log(`  linked ${nicePath(dstPath, 'yellow')} to ${nicePath(srcPath, 'blue')}`)
// }

// async function processGameSave (gameName, saveDir, savesDir) {
//   const srcDir = path.join(savesDir, gameName)

//   let srcStat
//   try {
//     srcStat = await fse.stat(srcDir)
//   } catch (err) { }

//   const srcReal = srcStat ? await fse.realpath(srcDir) : null

//   let dstStat
//   try {
//     dstStat = await fse.stat(saveDir)
//   } catch (err) { }

//   const dstReal = dstStat ? await fse.realpath(saveDir) : null

//   // scenarios
//   // 1: source directory exists, destination does not exist = link
//   // 2: source directory exists, destination exists, not already linked = delete destination and link
//   // 2: source directory exists, destination exists, already linked = log
//   // 2: source directory does not exist, destination exists and is directory = move destination to source and link
//   // 2: source directory does not exist, destination exists and is not directory = warn
//   // 2: source directory does not exist, destination does not exist = do nothing, no warn

//   if (srcStat && srcStat.isDirectory()) {
//     if (dstReal === srcReal) {
//       console.log(`  ${nicePath(saveDir, 'yellow')} is already linked to ${nicePath(srcDir, 'blue')}`)
//     } else {
//       try {
//         const lstat = await fse.lstat(saveDir)
//         if (lstat && !CONFIG.DRY_RUN) await fse.rm(saveDir, { recursive: true, force: true })
//         if (lstat) console.log(`  ${nicePath(saveDir, 'red')} was deleted`)
//       } catch (err) { }
//       await linkSave(srcDir, saveDir)
//     }
//   } else if (dstStat && dstStat.isDirectory()) {
//     try {
//       const lstat = await fse.lstat(srcDir)
//       if (lstat && !CONFIG.DRY_RUN) await fse.rm(srcDir, { recursive: true, force: true })
//       if (lstat) console.log(`  ${nicePath(srcDir, 'red')} was deleted`)
//     } catch (err) { }
//     if (!CONFIG.DRY_RUN) await fse.rename(saveDir, srcDir)
//     console.log(`  moved ${nicePath(saveDir, 'blue')} to ${nicePath(savesDir, 'blue')}`)
//     await linkSave(srcDir, saveDir)
//   }
// }

async function init () {
  const appName = 'game-linker'
  const homeDir = os.homedir()

  const confFile = path.join(homeDir, `.${appName}`)
  let configuration

  try {
    const configurationText = await fse.readFile(confFile, 'utf-8')
    configuration = yaml.parse(configurationText)
  } catch (err) { }

  let gamesDirDefault = 'C:/Games'
  let shortcutsDirDefault = path.join(homeDir, 'GameLinks')
  let savesDirDefault = path.join(homeDir, 'Dropbox', 'Saves')
  let pathsFileDefault
  let steamDirDefault = 'C:/Program Files (x86)/Steam'
  let steamUserIdDefault

  if (configuration != null) {
    if (configuration.saves_dir) savesDirDefault = path.resolve(configuration.saves_dir)
    if (configuration.games_dir) gamesDirDefault = path.resolve(configuration.games_dir)
    if (configuration.shortcuts_dir) shortcutsDirDefault = path.resolve(configuration.shortcuts_dir)
    if (configuration.paths_file) pathsFileDefault = path.resolve(configuration.paths_file)
    if (configuration.steam_dir) steamDirDefault = path.resolve(configuration.steam_dir)
    if (configuration.steam_user_id) steamUserIdDefault = configuration.steam_user_id
  }

  if (pathsFileDefault == null) {
    pathsFileDefault = path.join(savesDirDefault, 'games.yml')
  }

  const parser = yargs(process.argv.slice(2))

  parser.wrap(parser.terminalWidth())

  parser.scriptName(appName)

  parser.demandCommand(1, 'You need to specify at least one command\n')

  parser.command('link-saves', chalk.green('Link savegames'))
  parser.command('steam-shortcuts', chalk.green('Generate steam shortcuts'))
  parser.command('game-shortcuts', chalk.green('Generate game shortcuts'))

  parser.option('paths-file', {
    default: pathsFileDefault,
    type: 'string',
    normalize: true,
    describe: `Paths YAML file to use ${chalk.grey('(all commands)')}`
  })

  // parser.option('dry-run', {
  //   default: false,
  //   type: 'boolean',
  //   describe: `Do not make any file system modifications ${chalk.grey('(all commands)')}`
  // })

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

  parser.epilogue(`https://github.com/kamicane/${CONFIG.APP_NAME}`)

  const argv = parser.parse()
  const commands = argv._

  const pathsFile = path.resolve(argv.pathsFile)

  argv.appName = appName

  if (commands.includes('steam-shortcuts')) {
    argv.steamShortcutsFile = path.join(argv.steamDir, 'userdata', `${argv.steamUserId}/config/shortcuts.vdf`)
    argv.steamLevelDB = path.join(homeDir, 'AppData/Local/Steam/htmlcache/Local Storage/leveldb')
  }

  // if (argv.dryRun) {
  //   console.log(chalk.green('Dry Run Mode\n'))
  // }

  console.log('Home Directory      : ', chalk.blue(homeDir))
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
    console.log('Steam Shortcuts     : ', chalk.blue(argv.steamShortcutsFile))
    console.log('Steam LevelDB       : ', chalk.blue(argv.steamLevelDB))
  }

  const paths = await fse.readFile(pathsFile, 'utf8')
  const gameList = await yaml.parse(paths)

  // let sgdb
  // if (configuration.steamgriddb_api_key != null) {
  //   sgdb = new SGDB(configuration.steamgriddb_api_key)
  // }

  const cacheDir = path.join(homeDir, 'game-linker', 'cache')
  const iconDir = path.join(homeDir, 'game-linker', 'icons')

  await fse.ensureDir(iconDir)
  await fse.ensureDir(cacheDir)

  // for (const gameName in gameList) {
  //   let gameObj = gameList[gameName]

  //   if (!gameObj) continue

  //   console.log(`\n${chalk.magenta(gameName)}`)

  //   if (typeof gameObj === 'string') {
  //     gameObj = { saves: gameObj }
  //   }

  //   if (commands.includes('link-saves')) {
  //     const saveDir = gameObj.saves?.replace(/^~\//, `${homeDir}/`)
  //     if (saveDir) await processGameSave(gameName, path.resolve(saveDir), argv.savesDir)
  //   }

  //   if (gameObj.exe) {
  //     if (commands.includes('game-shortcuts')) {
  //       await processGameShortcut(gameName, gameObj.exe, gameObj.args, argv.gamesDir, argv.shortcutsDir)
  //     }

  //     if (commands.includes('steam-shortcuts')) {
  //       const steamGameObj = await processSteamShortcut(gameName, gameObj.exe, gameObj.args, argv.gamesDir)
  //       if (steamGameObj) {
  //         steamShortcuts.push(steamGameObj)
  //       }
  //     }
  //   }
  // }

  // if (commands.includes('steam-shortcuts')) {
  //   await writeSteamShortcuts(argv.steamUserId, steamShortcuts, steamShortcutsFile, steamLevelDB, argv.steamCollection)
  // }
}

init()
