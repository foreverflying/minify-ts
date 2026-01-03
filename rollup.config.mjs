import { builtinModules, createRequire } from 'node:module'
import terser from '@rollup/plugin-terser'

const require = createRequire(import.meta.url)
const pkg = require('./package.json')

export default {
    input: {
        index: 'min/out/index.js',
        cli: 'min/out/cli.js',
    },

    external: [
        ...builtinModules,
        ...builtinModules.map(m => `node:${m}`),
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
    ],

    output: {
        dir: 'lib',
        format: 'esm',
        entryFileNames: '[name].min.js',
        chunkFileNames: '[name].min.js',
        // sourcemap: true,
    },

    plugins: [
        terser(),
    ],
}
