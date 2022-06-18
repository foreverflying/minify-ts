import path from 'path'
import { program } from 'commander'
import { Minifier, MinifierOptions, SourceMapMerger } from './index'

program.command('minify')
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
        }
        const minifier = new Minifier(minifierOptions)
        minifier.compileProject(options.obfuscate)
    })

program.command('mergeSourceMap')
    .description('Merge all the relevent SourceMap files of files with specific extentions in a folder.')
    .argument('<out-dir>', 'the output folder path')
    .argument('<file-exts...>', 'the file extentions, like .js or .d.ts, also accept .map')
    .option('-r --recursive', 'loop through all sub directories')
    .action((outDir: string, fileExts: string[], options: Record<string, boolean>) => {
        outDir = path.isAbsolute(outDir) ? path.normalize(outDir) : path.join(process.cwd(), outDir)
        const merger = new SourceMapMerger()
        return merger.merge(outDir, fileExts, options.recursive)
    })

program.parse(process.argv)
