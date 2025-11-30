import ts from 'typescript'
import { minify, MinifierOptions, writeDestFile } from '../minify'

const configFile = ts.readJsonConfigFile('tsconfig.json', ts.sys.readFile)

const minifierOptions: MinifierOptions = {
    srcDir: '/opt/workspace/minify-ts/src/try',
    destDir: '/opt/workspace/minify-ts/min/src/try',
    interfaceFileArr: [
        'fileB.ts',
    ],
    // obfuscate: true,
}

const compilerOptions = ts.parseJsonSourceFileConfigFileContent(configFile, ts.sys, '/opt/workspace/minify-ts/')
minify(minifierOptions, writeDestFile, compilerOptions.options)
