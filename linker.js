#!/usr/bin/env node
'use strict'

const os = require('os')
const path = require('path')
const fse = require('fs-extra')
const yaml = require('yaml')
const chalk = require('chalk')

const yargs = require('yargs/yargs')

const IS_WINDOWS = process.platform === 'win32'

const HOME_DIR_DEFAULT = os.homedir()
const SAVE_DIR_DEFAULT = path.join(HOME_DIR_DEFAULT, 'Dropbox', 'Saves')
const CONF_FILE_DEFAULT = path.join(SAVE_DIR_DEFAULT, `paths-${IS_WINDOWS ? 'windows' : 'linux'}.yml`)

const parser = yargs(process.argv.slice(2))

parser
  .alias('h', 'help')
  .alias('v', 'version')

parser.option('dry-run', {
  default: false,
  type: 'boolean',
  describe: 'do not make any file system modifications'
})

parser.option('home-dir', {
  default: HOME_DIR_DEFAULT,
  type: 'string',
  normalize: true,
  describe: 'home dir'
})

parser.option('save-dir', {
  default: SAVE_DIR_DEFAULT,
  type: 'string',
  normalize: true,
  describe: 'where to store save directories'
})

parser.option('conf', {
  default: CONF_FILE_DEFAULT,
  type: 'string',
  normalize: true,
  describe: 'configuration file to use'
})

parser.epilogue('https://github.com/kamicane/save-game-linker')

const argv = parser.parse()

const HOME_DIR = path.resolve(argv.homeDir)
const CONF_FILE = path.resolve(argv.conf)
const SAVE_DIR = path.resolve(argv.saveDir)
const DRY_RUN = argv.dryRun

console.log('using HOME_DIR: ', chalk.green(HOME_DIR))
console.log('using SAVE_DIR: ', chalk.blue(SAVE_DIR))
console.log('using CONF_FILE: ', chalk.blue(CONF_FILE))
console.log('using DRY_RUN: ', chalk.red(DRY_RUN), '\n')

// console.log(argv)

const MAPPINGS = {
  $SAVED_GAMES: ['Saved Games'],
  $APPDATA_ROAMING: ['AppData/Roaming', 'Application Data'],
  $APPDATA_LOCAL: ['AppData/Local', 'Local Settings', 'Local Settings/Application Data'],
  $DOCUMENTS: ['Documents', 'My Documents'],
  $APPDATA_LOCAL_LOW: ['AppData/LocalLow']
}

function nicePath (p) {
  return path.relative(HOME_DIR, p)
}

const PRETTY_SAVE_DIR = chalk.blue(nicePath(SAVE_DIR))

async function linkSave (srcPath, dstPath) {
  if (!DRY_RUN) await fse.ensureSymlink(srcPath, dstPath, IS_WINDOWS ? 'junction' : 'dir')
  console.log('\t', 'linked', chalk.yellow(nicePath(dstPath)), 'to', chalk.blue(nicePath(srcPath)))
}

async function linkSaves (gameName, srcPath, statMap) {
  for (const dstPath in statMap) {
    const dstStats = statMap[dstPath]
    if (dstStats) { // exists already
      const realPath = await fse.realpath(dstPath)

      if (realPath === srcPath) { // exists and is a symlink already pointing to savePath
        console.log('\t', chalk.green(nicePath(dstPath)), 'is already linked to', chalk.blue(nicePath(srcPath)))
      } else if (dstStats.isDirectory()) {
        if (!DRY_RUN) await fse.remove(realPath)
        console.log('\t', chalk.red(nicePath(dstPath)), 'is a directory, destroyed')
        await linkSave(srcPath, dstPath)
      } else {
        if (!DRY_RUN) await fse.remove(realPath)
        console.log('\t', chalk.red(nicePath(dstPath)), 'is of an unknown type, destroyed')
        await linkSave(srcPath, dstPath)
      }
    } else { // doesn't exist
      console.log('\t', chalk.yellow(nicePath(dstPath)), 'was not present')
      await linkSave(srcPath, dstPath)
    }
  }
}

async function processGame (gameName, dstPaths) {
  const srcPath = path.join(SAVE_DIR, gameName)

  const statMap = {}

  for (const dstPath of dstPaths) {
    let dstStats
    try {
      dstStats = await fse.stat(dstPath)
    } catch (err) {}

    statMap[dstPath] = dstStats
  }

  let srcStats
  try {
    srcStats = await fse.stat(srcPath)
  } catch (err) {}

  if (srcStats && srcStats.isDirectory()) {
    // game save is found in your save dir
    // destroy everything and relink everything
    console.log(chalk.magenta(gameName), 'is already in', PRETTY_SAVE_DIR, 'everything else will be destroyed')

    await linkSaves(gameName, srcPath, statMap)
  } else if (!srcStats) {
    console.log(chalk.red(gameName), 'is not in', PRETTY_SAVE_DIR, 'trying to find a source...')
    // save is not in your save dir (yet)
    for (const dstPath in statMap) {
      const dstStats = statMap[dstPath]
      if (dstStats && dstStats.isDirectory()) {
        // if destination exists move to save dir
        console.log('\t', chalk.blue(nicePath(dstPath)), 'exists, moved to', PRETTY_SAVE_DIR, 'extra copies will be destroyed and relinked.')
        if (!DRY_RUN) await fse.move(dstPath, srcPath)
        // and linkSaves
        await linkSaves(gameName, srcPath, statMap)

        break // !important: break at first directory found.
      }
    }
  } else {
    // should never happen
    console.log('\t', chalk.red(nicePath(srcPath)), 'is of an unknown type, skipping...')
  }
}

async function relink () {
  const saveGames = await fse.readFile(CONF_FILE, 'utf8')
  const saveGameList = await yaml.parse(saveGames)

  for (const gameName in saveGameList) {
    const gamePath = saveGameList[gameName]
    const dstPaths = new Set()

    if (!/^\$/.test(gamePath)) {
      dstPaths.add(path.resolve(HOME_DIR, gamePath))
    } else {
      const parts = gamePath.split('/')
      const type = parts.shift()

      const dstBases = MAPPINGS[type]
      for (const dstBase of dstBases) {
        const dstBaseFull = path.join(HOME_DIR, dstBase)
        const dstBaseReal = await fse.realpath(dstBaseFull)
        dstPaths.add(path.join(dstBaseReal, ...parts))
      }
    }

    await processGame(gameName, dstPaths)
  }
}

relink()
