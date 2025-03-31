#!/usr/bin/env node

import os from 'node:os'
import path from 'node:path'
import fse from 'fs-extra'

import chalk from 'chalk'
import yaml from 'yaml'
import yargs from 'yargs/yargs'

import GameSaves from './lib/game-saves.js'
import SteamShortcuts from './lib/steam-shortcuts.js'
import GameShortcuts from './lib/game-shortcuts.js'

import findSteamAppId from './lib/steam-appid.js'

function nicePath (p, color = 'grey') {
  return chalk[color](p.replace(os.homedir(), '~'))
}

function attachEvents (processor) {
  processor.on('error', (err) => {
    console.log(`${chalk.red(err.message)} ${err.stack}`)
  })

  processor.on('info', (info) => {
    console.log(`${chalk.green(info.message)}`)
  })

  processor.on('game-start', (gameName) => {
    console.log(chalk.blue(gameName))
  })

  processor.on('game-error', (gameName, err) => {
    console.log(`  ${chalk.red(err.message)} ${err.stack}`)
  })

  processor.on('game-info', (gameName, infoObj) => {
    switch (infoObj.type) {
      case 'delete': {
        console.log(`  ${chalk.red('Deleted')} ${nicePath(infoObj.item)} (${infoObj.reason})`)
        break
      }
      case 'move': {
        console.log(`  ${chalk.magenta('Moved')} ${nicePath(infoObj.from)} to ${nicePath(infoObj.to)}`)
        break
      }
      case 'link': {
        console.log(`  ${chalk.green('Linked')} ${nicePath(infoObj.from)} to ${nicePath(infoObj.to)}`)
        break
      }
      case 'create': {
        console.log(`  ${chalk.green('Created')} ${infoObj.item}`)
        break
      }
      case 'noop': {
        if (infoObj.item != null) console.log(`  No Operation for ${infoObj.item} (${infoObj.reason})`)
        else console.log(`  No Operation (${infoObj.reason})`)
        break
      }
      default: {
        console.log(`  ${infoObj.message}`)
      }
    }
  })
}

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

  parser.epilogue(`https://github.com/kamicane/${appName}`)

  const argv = parser.parse()
  const commands = argv._

  const pathsFile = path.resolve(argv.pathsFile)

  argv.appName = appName

  if (commands.includes('steam-shortcuts')) {
    argv.steamShortcutsFile = path.join(argv.steamDir, 'userdata', `${argv.steamUserId}/config/shortcuts.vdf`)
    argv.steamLevelDB = path.join(homeDir, 'AppData/Local/Steam/htmlcache/Local Storage/leveldb')
  }

  if (argv.dryRun) {
    console.log(chalk.green('Dry Run Mode\n'))
  }

  if (commands.includes('game-shortcuts') || commands.includes('steam-shortcuts') || commands.includes('link-saves')) {
    console.log('Home Directory      : ', chalk.blue(homeDir))
    console.log('Paths File          : ', chalk.blue(pathsFile))
  }
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

  argv.cacheDir = path.join(homeDir, 'game-linker', 'cache')
  argv.iconCacheDir = path.join(argv.cacheDir, 'icons')
  argv.iconDir = path.join(homeDir, 'game-linker', 'icons')

  await fse.ensureDir(argv.iconDir)
  await fse.ensureDir(argv.cacheDir)
  await fse.ensureDir(argv.iconCacheDir)

  if (commands.includes('rename-game')) {
    if (argv.name == null || argv.newName == null) {
      console.log(chalk.red('Provide --name, --new-name'))
      return
    }

    const gameObj = gameList[argv.name]
    if (gameObj == null) {
      console.log(`Game ${argv.name} not found in list`)
      return
    }

    if (gameList[argv.newName]) {
      console.log(`Game ${argv.newName} already exists`)
      return
    }

    const newGameDir = path.join(argv.gamesDir, argv.newName)
    const oldGameDir = path.join(argv.gamesDir, argv.name)
    const newSaveDir = path.join(argv.savesDir, argv.newName)
    const oldSaveDir = path.join(argv.savesDir, argv.name)

    if (await fse.exists(newGameDir)) {
      console.log(`Game directory ${argv.newName} already exists`)
      return
    }

    if (await fse.exists(newSaveDir)) {
      console.log(`Save directory ${argv.newName} already exists`)
      return
    }

    if (await fse.exists(oldGameDir)) {
      await fse.rename(oldGameDir, newGameDir)
      console.log(`renamed ${nicePath(oldGameDir)} to ${nicePath(newGameDir)}`)
    }

    if (await fse.exists(oldSaveDir)) {
      await fse.rename(oldSaveDir, newSaveDir)
      console.log(`renamed ${nicePath(oldSaveDir)} to ${nicePath(newSaveDir)}`)
    }

    delete gameList[argv.name]
    gameList[argv.newName] = gameObj

    const newGameListStr = yaml.stringify(gameList)
    await fse.writeFile(argv.pathsFile, newGameListStr, 'utf-8')

    return
  }

  if (commands.includes('find-steam-appid')) {
    if (argv.name == null) {
      console.log(chalk.red('Provide --name'))
      return
    }

    console.log(chalk.yellow(`Searching for ${argv.name}\n`))

    const steamItem = await findSteamAppId(argv.name, argv)
    if (steamItem) {
      console.log(`Found ${chalk.magenta(steamItem.name)}, Steam AppId ${chalk.yellow(steamItem.appid)}`)
    } else {
      console.log(`${chalk.red(`${argv.name} not found`)}`)
    }
    return
  }

  if (commands.includes('link-saves')) {
    console.log(chalk.yellow('\nProcessing Game Saves\n'))

    const gameSaveProcessor = new GameSaves()

    attachEvents(gameSaveProcessor)

    await gameSaveProcessor.process(gameList, argv)
  }

  if (commands.includes('steam-shortcuts')) {
    console.log(chalk.yellow('\nProcessing Steam Shortcuts\n'))

    const steamShortcutsProcessor = new SteamShortcuts()

    attachEvents(steamShortcutsProcessor)

    await steamShortcutsProcessor.process(gameList, argv)
  }

  if (commands.includes('game-shortcuts')) {
    console.log(chalk.yellow('\nProcessing Game Shortcuts\n'))

    const gameShortcutsProcessor = new GameShortcuts()

    attachEvents(gameShortcutsProcessor)

    await gameShortcutsProcessor.process(gameList, argv)
  }
}

init()
