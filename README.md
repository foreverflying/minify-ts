# minify-ts
A TypeScript minifier based on TypeScript compiler to safely rename all of the variables, classes, functions, properties and methods to short.

It also provides a useful feature: merge the SourceMap files generated in several steps, and overwrite the last one with the merged one.

## What problems do I aim to solve?
1. Popular traditional minifiers are mostly based on JavaScript, as a result, they cannot get the information of types to decide whether a property name can be changed safely or not. So generally they just leave it unchanged, which stops them achieve the smaller minified size. In another hand, more people like to write code with classes in TypeScript, so more properties and methods are involved. Keeping their names unchanged will also affect another goal: protect your source code. The minify-ts uses TypeScript compiler to find out the safe way and smartly keeps the exports unchanged in your specified files: the exported variables, functions, classes and their public members.

1. We usually process the TypeScript code with many tools in pipelines, many of them may generate SourceMap files for debugging use, but these SourceMap files are mapped to the files generated in the previous step, not the original one. Several npm packages are aiming to solve this problem, as I tried, the best working one is [multi-stage-sourcemap](https://github.com/azu/multi-stage-sourcemap), however, it just processes only two SourceMap files each time, you need to figure out which two - not very friendly for batch processing, another problem is it does not support the "bundled" SourceMap, which means it has more than one sources. The minify-ts is designed to batch process all the SourceMap files in a folder in a very efficient way, it automatically traces up through the SourceMap chain collecting information, but only overwrites the very last one. Also, it supports the bundled SourceMap files.

## Install
install as a dev dependency and run with `npx minify-ts`
```sh
npm install --save-dev minify-ts
```
or install it globally and run with command `minify-ts`
```sh
npm install -g minify-ts
```

## Important:

* It only changes the names but keeps the origin spaces and line endings, so that can make it easier when you need to manually check the unexpected renamings. Also, it does not compile the code files into .javascript, the generated files are still .ts files, later after compiling them into .js files, you can use tools like terser to do further compression.

* Make sure all the generated files with SourceMaps have a link line (//# sourceMappingURL=xxx.map) pointing to the relevant .map file. The mergeSourceMap feature depends on it to trace up the SouceMap chains.

* Currently minify-ts does not support inline SourceMaps.

* To avoid unexpected renaming, you need to ensure your code perfectly passed the tsc compiling, and all the declarations are with explicit types. For example:
    ```ts
    type Point = {
        x: number
        y: number
    }

    // do not do this
    let start: Point
    let end
    const point = { x: 10, y: 20 }
    end = start = point1

    // always declare variables with explict types
    let start: Point
    let end: Point
    const point: Point = { x: 10, y: 20 }
    end = start = point

    // this is fine, because when "end" is declared the type can be infered
    let start: Point
    const point: Point = { x: 10, y: 20 }
    let end = start = point
    ```

# Command line usage
For minify, to show the usage: `minify-ts minify -h`
```
Usage: minify-ts minify [options] <src-dir> <out-dir> <interfaces...>

Minify all the files that used by the interface files.

Arguments:
  src-dir          the source folder path
  out-dir          the output folder path
  interfaces       the interface files (relative path to src-dir)

Options:
  -s --source-map  generate source files in the out-dir
  -o --obfuscate   can change to different names if two same name variables doesnot
                   have relations
  -h, --help       display help for command
```

For merge SourceMap files, to show the usage: `minify-ts mergeSourceMap -h`
```
Usage: minify-ts mergeSourceMap [options] <out-dir> <file-exts...>

Merge all the relevent SourceMap files of files with specific extentions in a folder.

Arguments:
  out-dir         the output folder path
  file-exts       the file extentions, like .js or .d.ts, also accept .map

Options:
  -r --recursive  loop through all sub directories
  -h, --help      display help for command
```

## Examples
To minify your project in ./src, generate the minified files in ./dest, while all your exported variables, functions and classes are defined in file ./src/exports/export1.ts and ./src/exports/export2.ts:
```sh
minify-ts minify -s ./src ./dest exports/export1.ts exports/export2.ts
```
> Clarify: All the code files involved will be minified, not only the interface files.

To merge the SourceMap files *.js.map and *.d.ts.map in ./dest folder and its sub folders, overwrite them with the merged SourceMap files:
```sh
minify-ts mergeSourceMap -r ./dest .js.map .d.ts.map
```
or passing the code files in, it will automatically find out the linked SourceMap files by looking up from the code files.
```sh
minify-ts mergeSourceMap -r ./dest .js .d.ts
```

# Usage
```ts
import { Minifier, MinifierOptions, SourceMapMerger } from 'minify-ts'

// use Minifier
const options: MinifierOptions = {
    srcDir: '/absolute/path/to/src/folder',
    destDir: '/absolute/path/to/dest/folder',
    interfaceFileArr: ['relative/path/to/src/folder/file.ts'],
    generateSourceMap: true,
}

const obfuscate = false
const minifier = new Minifier(options)
minifier.compileProject(obfuscate)

// use SourceMapMerger
const recursive = true
const merger = new SourceMapMerger(
    '/absolute/path/to/dest/folder',
    ['.js.map', '.d.ts.map'],
    recursive,
)
```

# Thanks to
[source-map](https://github.com/mozilla/source-map)

[multi-stage-sourcemap](https://github.com/azu/multi-stage-sourcemap)

# TODO
Flatten the directory and change all file names to short.

Detect all the implicit declarations and give Warnings or Errors.

The minify implementation is based on TypeScript language service find references API, which makes it very slow, consider if there are better choices.