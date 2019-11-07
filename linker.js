#!/usr/bin/env node
'use strict'

const fse = require('fs-extra')
const path = require('path')
const os = require('os')
const yaml = require('yaml')

const HOMEDIR = os.homedir()

const SAVES_PATH = path.join(HOMEDIR, 'Dropbox', 'Saves')
const YAML_PATH = path.join(SAVES_PATH, 'paths.yml')

const IS_WINDOWS = process.platform === 'win32'

if (!IS_WINDOWS && !process.argv[2]) {
  console.warn('MUST PROVIDE A PATH ON LINUX')
  process.exit(0)
}

const LINK_DIR = IS_WINDOWS ? HOMEDIR : path.resolve(process.argv[2])

async function linkGameSave (srcPath, dstPath) {
  await fse.ensureSymlink(srcPath, dstPath, IS_WINDOWS ? 'junction' : 'dir')
  console.log('linked', dstPath, 'to', srcPath)
}

async function relink () {
  const saveGames = await fse.readFile(YAML_PATH, 'utf8')
  const saveGameList = await yaml.parse(saveGames)

  for (const gameName in saveGameList) {
    const gamePath = saveGameList[gameName]
    if (!/^~/.test(gamePath)) continue

    const dstPath = path.normalize(gamePath.replace('~', LINK_DIR))
    const srcPath = path.normalize(path.join(SAVES_PATH, gameName))

    let srcStats
    try {
      srcStats = await fse.stat(srcPath)
    } catch (err) {}

    let dstStats
    try {
      dstStats = await fse.stat(dstPath)
    } catch (err) {}

    if (srcStats && srcStats.isDirectory()) {
      if (dstStats) {
        const realPath = await fse.realpath(dstPath)
        const realDst = await path.normalize(realPath)
        if (realDst === srcPath) {
          console.log(gameName, 'IS_LINKED')
        } else if (dstStats.isDirectory()) {
          console.log(gameName, 'IS_DIR')
          console.log('removed', dstPath)
          await fse.remove(dstPath)
          await linkGameSave(srcPath, dstPath)
        } else {
          console.log(gameName, 'UNKNOWN')
        }
      } else {
        console.log(gameName, 'DST_NOT_FOUND')
        await linkGameSave(srcPath, dstPath)
      }

      // console.log(srcPath, dstPath)
    } else if (!srcStats) {
      console.log(gameName, 'SRC_NOT_FOUND')
      if (dstStats && dstStats.isDirectory()) {
        await fse.move(dstPath, srcPath)
        console.log('moved', dstPath, 'to', srcPath)
        await linkGameSave(srcPath, dstPath)
      }
    }
  }
}

relink()
