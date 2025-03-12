import path from 'path'
import ts from 'typescript'
import { MinifierOptions, minify, RenamedContent } from './minify'

export interface MinifyTsOptions {
    srcDir: string
    interfaceFileArr: string[]
    program?: ts.Program
    obfuscate?: boolean
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

const fileCallback = (srcPath: string, _destPath: string, content?: RenamedContent) => {
    if (content) {
        const renameMap = new Map<number, string>()
        fileRenameMap!.set(srcPath, renameMap)
        const { bufferArr, posArr } = content
        for (let i = 0; i < bufferArr.length; i++) {
            if (i & 1) {
                const text = decoder.decode(bufferArr[i])
                renameMap.set(posArr[i], text)
            }
        }
    }
}

export const createMinifyTransformer = (minifyTsOptions: MinifyTsOptions) => {
    return function minifyTransformer(context: ts.TransformationContext): ts.Transformer<ts.SourceFile> {
        const compilerOptions = context.getCompilerOptions()
        const getVisitFunc = (sourceFile: ts.SourceFile, renameMap?: Map<number, string>) => {
            if (renameMap) {
                const { createIdentifier, updateExportDeclaration } = ts.factory
                const visit = (node: ts.Node): ts.Node => {
                    if (ts.isIdentifier(node)) {
                        const { text } = node
                        const pos = getPosOfNode(node)
                        const newText = renameMap.get(pos)
                        if (newText) {
                            const identifier = createIdentifier(newText)
                            ts.setOriginalNode(identifier, node)
                            ts.setTextRange(identifier, node)
                            // this is useless, until now typescript doesn't put names into sourcemaps
                            ts.setSourceMapRange(identifier, {
                                pos: node.pos,
                                end: node.end,
                                source: {
                                    fileName: sourceFile.fileName,
                                    text: text,
                                    getLineAndCharacterOfPosition: sourceFile.getLineAndCharacterOfPosition,
                                },
                            })
                            return identifier
                        }
                    } else if (ts.isExportDeclaration(node) && node.isTypeOnly && node.exportClause) {
                        const { modifiers, exportClause, moduleSpecifier, attributes } = node
                        return updateExportDeclaration(node, modifiers, false, exportClause, moduleSpecifier, attributes)
                    }
                    return ts.visitEachChild(node, visit, context)
                }
                return visit
            } else {
                return (node: ts.Node) => node
            }
        }
        return (node: ts.SourceFile): ts.SourceFile => {
            if (!fileRenameMap) {
                fileRenameMap = new Map<string, Map<number, string>>()
                const { srcDir, interfaceFileArr, program, obfuscate } = minifyTsOptions
                const cwd = process.cwd()
                const srcFolder = path.isAbsolute(srcDir) ? path.normalize(srcDir) : path.join(cwd, srcDir)
                const minifierOptions: MinifierOptions = {
                    srcDir: srcFolder,
                    destDir: srcFolder,
                    interfaceFileArr,
                    obfuscate,
                    program,
                }
                minify(minifierOptions, fileCallback, compilerOptions)
            }
            const renameMap = fileRenameMap.get(node.fileName)
            const visit = getVisitFunc(node, renameMap)
            const result = ts.visitEachChild(node, visit, context)
            return result
        }
    }
}
