import { Minifier, MinifierOptions } from './Minifier'

const minifierOptions: MinifierOptions = {
    srcDir: `${__dirname}/../src`,
    destDir: `${__dirname}/../min`,
    interfaceFileArr: ['index.ts'],
}

// const minifierOptions: MinifierOptions = {
//     srcDir: `${__dirname}/../src`,
//     destDir: `${__dirname}/../min`,
//     interfaceFileArr: ['try/try.ts'],
// }

minifierOptions.sourceMapOutputDir = minifierOptions.destDir
const minifier = new Minifier(minifierOptions)
minifier.compileProject()
