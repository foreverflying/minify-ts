import path from 'path'
import ts, { CustomTransformers, SyntaxKind } from 'typescript'
import { MinifierOptions, minify } from './minify'

export interface MinifyTsOptions {
    srcDir: string
    interfaceFileArr: string[]
    obfuscate?: boolean
    compilerOptions?: ts.CompilerOptions
}

const decoder = new TextDecoder()
let fileRenameMap: Map<string, Map<number, string>> | undefined

const getPosOfNode = (node: ts.Node) => {
    const fullText = node.getFullText()
    const firstChar = node.getText()[0]
    let i = 0
    while (fullText[i] !== '/') {
        if (fullText[i] === firstChar) {
            return node.pos + i
        }
        i++
    }
    const startPos = fullText.lastIndexOf(node.getText())
    return node.pos + startPos
}

const fileCallback = (srcPath: string, _destPath: string, content?: Uint8Array[]) => {
    if (content) {
        const renameMap = new Map<number, string>()
        fileRenameMap!.set(srcPath, renameMap)
        let pos = 0
        for (let i = 0; i < content.length; i++) {
            if (i & 1) {
                const text = decoder.decode(content[i])
                renameMap.set(pos, text)
                pos += text.length
            } else {
                pos += content[i].length
            }
        }
    }
}

export const createMinifyTransformer = (minifyTsOptions: MinifyTsOptions) => {
    return function minifyTransformer(context: ts.TransformationContext): ts.Transformer<ts.SourceFile> {
        const getVisitFunc = (sourceFile: ts.SourceFile, renameMap?: Map<number, string>) => {
            if (renameMap) {
                const { createIdentifier } = ts.factory
                let shift = 0
                const visit = (node: ts.Node): ts.Node => {
                    if (node.kind === SyntaxKind.Identifier) {
                        const { text } = node as ts.Identifier
                        const pos = getPosOfNode(node)
                        const newText = renameMap.get(pos - shift)
                        if (newText) {
                            shift += text.length - newText.length
                            const identifier = createIdentifier(newText)
                            ts.setOriginalNode(identifier, node)
                            ts.setTextRange(identifier, node)
                            // there are useless, until now typescript doesn't put names into sourcemaps
                            ts.setSourceMapRange(identifier, {
                                pos: node.pos,
                                end: node.end,
                                source: {
                                    fileName: sourceFile.fileName,
                                    text: text,
                                    getLineAndCharacterOfPosition: sourceFile.getLineAndCharacterOfPosition,
                                },
                            })
                            return ts.visitEachChild(identifier, visit, context)
                        }
                    }
                    return ts.visitEachChild(node, visit, context)
                }
                return visit
            } else {
                const visit = (node: ts.Node): ts.Node => {
                    return ts.visitEachChild(node, visit, context)
                }
                return visit
            }
        }
        return (node: ts.SourceFile): ts.SourceFile => {
            if (!fileRenameMap) {
                fileRenameMap = new Map<string, Map<number, string>>()
                const { srcDir, interfaceFileArr, obfuscate, compilerOptions } = minifyTsOptions
                const cwd = process.cwd()
                const srcFolder = path.isAbsolute(srcDir) ? path.normalize(srcDir) : path.join(cwd, srcDir)
                const minifierOptions: MinifierOptions = {
                    srcDir: srcFolder,
                    destDir: srcFolder,
                    interfaceFileArr,
                    obfuscate,
                }
                minify(minifierOptions, fileCallback, compilerOptions)
            }
            const visit = getVisitFunc(node, fileRenameMap.get(node.fileName))
            return ts.visitEachChild(node, visit, context)
        }
    }
}

export const createMinifyTransformers = (minifyTsOptions: MinifyTsOptions): CustomTransformers => {
    return {
        before: [createMinifyTransformer(minifyTsOptions)]
    }
}
