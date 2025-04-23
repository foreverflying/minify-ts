import path from 'path'
import { program } from 'commander'
import { minify, MinifierOptions, writeDestFile } from './minify'

program
    .description('Minify all the files that used by the interface files.')
    .argument('<src-dir>', 'the source folder path')
    .argument('<out-dir>', 'the output folder path')
    .argument('<interfaces...>', 'the interface files (relative path to src-dir)')
    .option('-s --source-map', 'generate source files in the out-dir')
    .option('-o --obfuscate', 'can change to different names if two same name variables does not have relations')
    .action((srcDir: string, outDir: string, interfaces: string[], options: Record<string, boolean>) => {
        const cwd = process.cwd()
        const minifierOptions: MinifierOptions = {
            srcDir: path.isAbsolute(srcDir) ? path.normalize(srcDir) : path.join(cwd, srcDir),
            destDir: path.isAbsolute(outDir) ? path.normalize(outDir) : path.join(cwd, outDir),
            interfaceFileArr: interfaces,
            generateSourceMap: options.sourceMap,
            obfuscate: options.obfuscate,
        }
        minify(minifierOptions, writeDestFile)
    })

program.parse(process.argv)
