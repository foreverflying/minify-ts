# minify-ts
[![minify-ts npm version](https://img.shields.io/npm/v/minify-ts.svg?style=popout&color=blue&label=minify-ts)](https://www.npmjs.com/package/minify-ts)

A TypeScript minifier based on TypeScript compiler to safely rename all of the variables, classes, functions, properties and methods to short.

~~It also provides a useful feature: merge the SourceMap files generated in several steps, and overwrite the last one with the merged one.~~

* Notice: the merge SourceMap feature is stripped out to another package:

    `merge-source-map`

## What problems do I aim to solve?
   Popular traditional minifiers are mostly based on JavaScript, as a result, they cannot get the information of types to decide whether a property name can be changed safely or not. So generally they just leave it unchanged, which stops them achieve the smaller minified size. In another hand, more people like to write code with classes in TypeScript, so more properties and methods are involved. Keeping their names unchanged will also affect another goal: protect your source code. The minify-ts uses TypeScript compiler to find out the safe way and smartly keeps the exports unchanged in your specified files: the exported variables, functions, classes and their public members.

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

* Make sure you are confident with your TypeScript - they shall be perfectly typed, no "any", be careful on the type converting code, had better manually check those parts. For example:
    ```ts
    class A {
        public foo
        private bar
    }

    const a = new A()

    class B {
        public foo
        public bar
    }

    // you are trying to play tricks with the compiler, to access the private member of A
    // however, the compiler will lose the trace of types
    // as a result, the minify-ts might change these two "bar" to different names
    // set the "obfuscate" option to false would help for this case
    const b = a as unknown as B
    console.log(b.bar)
    ```

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
To show the usage: `minify-ts -h`
```
Usage: minify-ts [options] <src-dir> <out-dir> <interfaces...>

Minify all the files that used by the interface files.

Arguments:
  src-dir          the source folder path
  out-dir          the output folder path
  interfaces       the interface files (relative path to src-dir)

Options:
  -s --source-map  generate source files in the out-dir
  -o --obfuscate   can change to different names if two same name
                   variables does not have relations
  -h, --help       display help for command
```

## Examples
To minify your project in ./src, generate the minified files in ./dest, while all your exported variables, functions and classes are defined in file ./src/exports/export1.ts and ./src/exports/export2.ts:
```sh
minify-ts -s ./src ./dest exports/export1.ts exports/export2.ts
```
> Clarify: All the code files involved will be minified, not only the interface files.

# Usage
```ts
import { Minifier, MinifierOptions, SourceMapMerger } from 'minify-ts'

const options: MinifierOptions = {
    srcDir: '/absolute/path/to/src/folder',
    destDir: '/absolute/path/to/dest/folder',
    interfaceFileArr: ['relative/path/to/src/folder/file.ts'],
    generateSourceMap: true,    // optional, default is false
    obfuscate: false,           // optional, default is false
}

const minifier = new Minifier(options)
minifier.compileProject()
```

# Thanks to
[source-map](https://github.com/mozilla/source-map)

# TODO
Flatten the directory and change all file names to short.

Detect all the implicit declarations and give Warnings or Errors.

The minify implementation is based on TypeScript language service find references API, which makes it very slow, consider if there are better choices.