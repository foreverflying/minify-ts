const path = require('path')
const minify = require('./Minifier').minify

let srcMap

module.exports = function (source, map) {
  if (!srcMap) {
    srcMap = new Map()
    const { srcDir, interfaces, obfuscate } = this.getOptions()
    const cwd = process.cwd()
    const dir = path.isAbsolute(srcDir) ? path.normalize(srcDir) : path.join(cwd, srcDir)
    const minifierOptions = {
      srcDir: dir,
      destDir: dir,
      interfaceFileArr: interfaces,
      generateSourceMap: true,
      obfuscate: obfuscate,
    }
    minify(minifierOptions, (srcPath, destPath, content, sourceMap) => {
      if (content !== undefined) {
        srcMap?.set(srcPath, [content.join(''), sourceMap])
      }
    })
  }
  const filePath = this.resourcePath
  console.log('file is:', filePath)
  let src = srcMap.get(filePath)
  if (src) {
    [source, map] = src
  }
  this.callback(null, source, map)
}
