/* eslint-disable @typescript-eslint/no-non-null-assertion */
import ts, { Program } from 'typescript'
import fs from 'fs'
import path from 'path'
import { Mapping, SourceMapGenerator } from 'source-map'

type RefNode = {
    refSet: Set<string>
    name: string
    isSignature?: boolean
    isFixed?: boolean
}

type RenameNode = {
    pos: number
    name: string
    changed: string
    changedBuffer: Uint8Array
}

// these minimum options are very important for the Minifier tracing the references correctly in the lib files
const defaultCompilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
}

const renameCharStr = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ$_'

const reservedWordStr = 'break,case,catch,class,const,continue,debugger,default,delete,do,else,enum,\
export,extends,false,finally,for,function,if,import,in,istanceOf,new,null,return,super,switch,this,throw,\
true,try,typeOf,var,void,while,with,as,implements,interface,let,package,private,protected,public,static,\
any,boolean,constructor,declare,get,module,require,number,set,string,symbol,type,from,of'

const matchInString = (short: string, long: string, from: number) => {
    let i = 0
    while (i < short.length) {
        if (long[from + i] !== short[i]) {
            return false
        }
        i++
    }
    return true
}

export type MinifierOptions = {
    srcDir: string
    destDir: string
    interfaceFileArr: string[]
    sourceMapInputDir?: string
    sourceMapOutputDir?: string
}

export class Minifier {
    constructor(options: MinifierOptions) {
        const { srcDir, destDir, interfaceFileArr, sourceMapInputDir, sourceMapOutputDir } = options
        this._srcDir = path.normalize(srcDir + path.sep)
        this._destDir = path.normalize(destDir + path.sep)
        this._sourceMapInputDir = path.normalize(sourceMapInputDir + path.sep)
        this._sourceMapOutputDir = path.normalize(sourceMapOutputDir + path.sep)
        this._interfaceFileArr = interfaceFileArr.map(filePath => path.join(srcDir, filePath))
        this._interfaceFileSet = new Set<number>()
        this._exportEntryMap = new Map<string, number>()
        this._fileArr = []
        this._decFileArr = []
        this._fileMap = new Map<string, number>()
        this._refMap = new Map<string, RefNode>()
        this._nameTable = renameCharStr.split('')
        this._reservedWordSet = new Set<string>()
        for (const word of reservedWordStr.split(',')) {
            this._reservedWordSet.add(word)
        }
    }

    compileProject(obfuscation = false, compilerOptions = defaultCompilerOptions) {
        const servicesHost: ts.LanguageServiceHost = {
            getScriptFileNames: () => this._interfaceFileArr,
            getScriptVersion: () => '0',
            getScriptSnapshot: fileName => {
                if (!fs.existsSync(fileName)) {
                    return undefined
                }
                return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName).toString())
            },
            getCurrentDirectory: () => process.cwd(),
            getCompilationSettings: () => compilerOptions,
            getDefaultLibFileName: ts.getDefaultLibFilePath,
            fileExists: ts.sys.fileExists,
            readFile: ts.sys.readFile,
            readDirectory: ts.sys.readDirectory,
            directoryExists: ts.sys.directoryExists,
            getDirectories: ts.sys.getDirectories,
        }
        const service = ts.createLanguageService(servicesHost)
        const program = service.getProgram()!
        this.findIdentifiers(program)
        const contentArr = this._fileArr.map(fileName => program.getSourceFile(fileName)!.getFullText()!)
        this.findReferences(service, contentArr)
        const renameArr = this.buildRenameArr(obfuscation)
        this.generateDestFiles(renameArr, contentArr, program)
    }

    private findIdentifiers(program: ts.Program) {
        const { _srcDir, _interfaceFileArr, _interfaceFileSet, _fileArr, _decFileArr, _fileMap } = this
        const typeChecker = program.getTypeChecker()
        const fileNodeArr = program.getSourceFiles().filter(file => {
            const { fileName } = file
            if (fileName.startsWith(_srcDir)) {
                if (!fileName.endsWith('.d.ts')) {
                    _fileMap.set(fileName, _fileArr.push(fileName) - 1)
                    return true
                } else {
                    _decFileArr.push(fileName)
                }
            }
            return false
        })
        for (const fileName of _interfaceFileArr) {
            const fileIndex = _fileMap.get(fileName)!
            const fileNode = fileNodeArr[fileIndex]
            _interfaceFileSet.add(fileIndex)
            this.findExportsInFile(typeChecker, fileNode, fileIndex)
        }
        for (let i = 0; i < fileNodeArr.length; i++) {
            const fileNode = fileNodeArr[i]
            this.visitNode(fileNode, i, 0)
        }
    }

    private findExportsInFile(typeChecker: ts.TypeChecker, fileNode: ts.Node, fileIndex: number) {
        const { _exportEntryMap, _fileMap } = this
        const symbol = typeChecker.getSymbolAtLocation(fileNode)!
        const exportsArr = typeChecker.getExportsOfModule(symbol)
        for (const entry of exportsArr) {
            const declarations = entry.getDeclarations()!
            let declareNode = declarations[0] as ts.NamedDeclaration
            if (declareNode.name?.kind === ts.SyntaxKind.Identifier && entry.name !== 'default') {
                const key = this.addDeclaration(declareNode.name, fileIndex)
                this.markFixedName(key)
            }
            if (entry.flags & ts.SymbolFlags.Alias) {
                const origin = typeChecker.getAliasedSymbol(entry)
                const originDeclarations = origin.getDeclarations()!
                declareNode = originDeclarations[0]
            }
            const fileName = declareNode.getSourceFile().fileName
            const declareFileIndex = _fileMap.get(fileName)
            if (declareFileIndex !== undefined) {
                const key = this.getKeyFromNode(declareNode, declareFileIndex)
                _exportEntryMap.set(key, declareNode.kind)
            }
        }
    }

    private visitNode(node: ts.Node, fileIndex: number, layer: number) {
        const children = node.getChildren()
        // // eslint-disable-next-line @typescript-eslint/no-var-requires
        // const { syntaxKindMap } = require('./syntaxKindMap')
        // const nodeTypeStr = syntaxKindMap[node.kind]
        // console.log(`${'  '.repeat(layer)}${layer} - type: ${nodeTypeStr}, children: ${children.length}`)
        switch (node.kind) {
            case ts.SyntaxKind.InterfaceDeclaration:
            case ts.SyntaxKind.TypeAliasDeclaration:
            case ts.SyntaxKind.EnumDeclaration: {
                const { name } = node as ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.EnumDeclaration
                const key = this.addDeclaration(name, fileIndex)
                this.markFixedName(key)
                break
            }
            case ts.SyntaxKind.ModuleDeclaration:
            case ts.SyntaxKind.ClassDeclaration:
            case ts.SyntaxKind.FunctionDeclaration: {
                const { name } = node as ts.ModuleDeclaration | ts.ClassDeclaration | ts.FunctionDeclaration
                if (name?.kind === ts.SyntaxKind.Identifier) {
                    this.addDeclaration(name, fileIndex)
                }
                break
            }
            case ts.SyntaxKind.PropertySignature:
            case ts.SyntaxKind.MethodSignature: {
                const signatureNode = node as ts.PropertySignature | ts.MethodSignature | ts.EnumMember
                if (signatureNode.name.kind === ts.SyntaxKind.Identifier) {
                    const key = this.addDeclaration(signatureNode.name, fileIndex, true)
                    let parent = signatureNode.parent
                    if (parent.kind !== ts.SyntaxKind.InterfaceDeclaration) {
                        while (parent.kind !== ts.SyntaxKind.TypeAliasDeclaration) {
                            parent = parent.parent
                        }
                    }
                    if (this.isNodeInExportEntryMap(parent, fileIndex)) {
                        this.markFixedName(key)
                    }
                }
                break
            }
            case ts.SyntaxKind.EnumMember: {
                const enumMemberNode = node as ts.EnumMember
                if (enumMemberNode.name.kind === ts.SyntaxKind.Identifier) {
                    const key = this.addDeclaration(enumMemberNode.name, fileIndex)
                    if (this.isNodeInExportEntryMap(enumMemberNode.parent, fileIndex)) {
                        this.markFixedName(key)
                    }
                }
                break
            }
            case ts.SyntaxKind.PropertyDeclaration:
            case ts.SyntaxKind.MethodDeclaration: {
                const memberNode = node as ts.PropertyDeclaration | ts.MethodDeclaration
                if (memberNode.name.kind === ts.SyntaxKind.Identifier) {
                    const key = this.addDeclaration(memberNode.name, fileIndex)
                    const isExported = this.isNodeInExportEntryMap(memberNode.parent, fileIndex)
                    const isPrivate = ts.getCombinedModifierFlags(memberNode) & ts.ModifierFlags.Private
                    if (!isPrivate && isExported) {
                        this.markFixedName(key)
                    }
                }
                break
            }
            case ts.SyntaxKind.PropertyAssignment:
            case ts.SyntaxKind.ShorthandPropertyAssignment: {
                const assignNode = node as ts.PropertyAssignment | ts.ShorthandPropertyAssignment
                if (assignNode.name.kind === ts.SyntaxKind.Identifier) {
                    const key = this.addDeclaration(assignNode.name, fileIndex)
                    let outerNode = assignNode.parent.parent
                    while (outerNode.kind === ts.SyntaxKind.PropertyAssignment) {
                        outerNode = outerNode.parent.parent
                    }
                    if (outerNode.kind === ts.SyntaxKind.VariableDeclaration) {
                        if (this.isNodeInExportEntryMap(outerNode, fileIndex)) {
                            this.markFixedName(key)
                        }
                    }
                }
                break
            }
            case ts.SyntaxKind.VariableDeclaration:
            case ts.SyntaxKind.BindingElement:
            case ts.SyntaxKind.ImportSpecifier: {
                const varNode = node as ts.VariableDeclaration | ts.BindingElement | ts.ImportSpecifier
                if (varNode.name.kind === ts.SyntaxKind.Identifier) {
                    const key = this.addDeclaration(varNode.name, fileIndex)
                    if (this._interfaceFileSet.has(fileIndex)) {
                        if (ts.getCombinedModifierFlags(varNode) & ts.ModifierFlags.Export) {
                            this.markFixedName(key)
                        }
                    }
                }
                break
            }
            case ts.SyntaxKind.Parameter: {
                const { name } = node as ts.ParameterDeclaration
                if (name.kind === ts.SyntaxKind.Identifier) {
                    if (name.text !== 'this') {
                        this.addDeclaration(name, fileIndex)
                    }
                }
                break
            }
            default:
        }
        for (const child of children) {
            this.visitNode(child, fileIndex, layer + 1)
        }
    }

    private addDeclaration(identifier: ts.Identifier, fileIndex: number, isSignature?: boolean) {
        const { _refMap } = this
        const key = this.getKeyFromNode(identifier, fileIndex)
        const refNode = _refMap.get(key)
        if (refNode) {
            refNode.isSignature ||= isSignature
        } else {
            const refSet = new Set<string>()
            refSet.add(key)
            _refMap.set(key, { refSet, name: identifier.text, isSignature })
        }
        return key
    }

    private markFixedName(declareKey: string) {
        this._refMap.get(declareKey)!.isFixed = true
    }

    private isNodeInExportEntryMap(node: ts.Node, fileIndex: number) {
        const key = this.getKeyFromNode(node, fileIndex)
        const kind = this._exportEntryMap.get(key)
        return node.kind === kind
    }

    private getKeyFromNode(node: ts.Node, fileIndex: number) {
        const fullText = node.getFullText()
        const firstChar = node.getText()[0]
        let i = 0
        while (fullText[i] !== '/') {
            if (fullText[i] === firstChar) {
                return `${fileIndex}_${node.pos + i}`
            }
            i++
        }
        const startPos = fullText.lastIndexOf(node.getText())
        return `${fileIndex}_${node.pos + startPos}`
    }

    private findReferences(service: ts.LanguageService, contentArr: string[]) {
        const { _refMap, _fileMap } = this
        const declareKeyArr = [..._refMap.keys()]
        for (const key of declareKeyArr) {
            const { name } = _refMap.get(key)!
            const { fileIndex, pos } = this.getFileAndPosFromKey(key)
            const declareFileName = this._fileArr[fileIndex]
            const refArr = service.getReferencesAtPosition(declareFileName, pos)!
            for (const ref of refArr) {
                const { textSpan, fileName } = ref
                const refFileIndex = _fileMap.get(fileName)
                if (refFileIndex !== undefined) {
                    const { start, length } = textSpan
                    const fileText = contentArr[refFileIndex]
                    if (length !== name.length || !matchInString(name, fileText, start)) {
                        continue
                    }
                    this.addReference(key, refFileIndex, start)
                } else {
                    this.markFixedName(key)
                }
            }
        }
    }

    private addReference(declareKey: string, fileIndex: number, pos: number) {
        const key = `${fileIndex}_${pos}`
        if (key === declareKey) {
            return
        }
        const { _refMap } = this
        let declareNode = _refMap.get(declareKey)!
        let targetNode = _refMap.get(key)
        if (!targetNode) {
            _refMap.set(key, declareNode)
            declareNode.refSet.add(key)
            return
        }
        if (targetNode !== declareNode) {
            if (declareNode.refSet.size < targetNode.refSet.size) {
                [declareNode, targetNode] = [targetNode, declareNode]
            }
            for (const refKey of targetNode.refSet) {
                declareNode.refSet.add(refKey)
                _refMap.set(refKey, declareNode)
            }
            declareNode.isSignature ||= targetNode.isSignature
            declareNode.isFixed ||= targetNode.isFixed
        }
    }

    private getFileAndPosFromKey(key: string) {
        const [fileIndexStr, posStr] = key.split('_')
        const fileIndex = parseInt(fileIndexStr)
        const pos = parseInt(posStr)
        return { fileIndex, pos }
    }

    private buildRenameArr(obfuscation: boolean) {
        const fixedNodeArr: RefNode[] = []
        const refNodeArr: RefNode[] = []
        this.consolidRefNodes(fixedNodeArr, refNodeArr, obfuscation)
        const renameSetArr: Set<string>[] = []
        for (let i = 0; i < this._fileArr.length; i++) {
            renameSetArr.push(new Set<string>())
        }
        const sigSet = new Set<string>()
        this.preFillFixedName(fixedNodeArr, renameSetArr, sigSet)
        return this.renameAllReferences(refNodeArr, renameSetArr, sigSet)
    }

    private consolidRefNodes(fixedNodeArr: RefNode[], refNodeArr: RefNode[], obfuscation: boolean) {
        const { _refMap } = this
        const refNodeSet = new Set<RefNode>()
        for (const [, refNode] of _refMap) {
            refNodeSet.add(refNode)
        }
        let refNodeIterator = refNodeSet.values()
        if (!obfuscation) {
            const nameRefNodeMap = new Map<string, RefNode>()
            for (let refNode of refNodeSet) {
                const { name } = refNode
                let sameNameNode = nameRefNodeMap.get(name)
                if (!sameNameNode) {
                    nameRefNodeMap.set(name, refNode)
                } else {
                    if (sameNameNode.refSet.size < refNode.refSet.size) {
                        [sameNameNode, refNode] = [refNode, sameNameNode]
                    }
                    for (const refKey of refNode.refSet) {
                        sameNameNode.refSet.add(refKey)
                    }
                    sameNameNode.isSignature ||= refNode.isSignature
                    sameNameNode.isFixed ||= refNode.isFixed
                    nameRefNodeMap.set(name, sameNameNode)
                }
            }
            refNodeIterator = nameRefNodeMap.values()
        }
        for (const refNode of refNodeIterator) {
            if (refNode.isFixed) {
                fixedNodeArr.push(refNode)
            } else {
                refNodeArr.push(refNode)
            }
        }
        refNodeArr.sort((left, right) => right.refSet.size - left.refSet.size)
    }

    private preFillFixedName(fixedNodeArr: RefNode[], renameSetArr: Set<string>[], sigSet: Set<string>) {
        for (const { name, refSet, isSignature } of fixedNodeArr) {
            const fileIndexSet = new Set<number>()
            for (const key of refSet) {
                const { fileIndex } = this.getFileAndPosFromKey(key)
                fileIndexSet.add(fileIndex)
            }
            for (const fileIndex of fileIndexSet) {
                renameSetArr[fileIndex].add(name)
            }
            if (isSignature) {
                sigSet.add(name)
            }
        }
    }

    private renameAllReferences(refNodeArr: RefNode[], renameSetArr: Set<string>[], sigSet: Set<string>) {
        const encoder = new TextEncoder()
        const renameArr: RenameNode[][] = []
        for (let i = 0; i < renameSetArr.length; i++) {
            renameArr.push([])
        }
        for (const refNode of refNodeArr) {
            let nameIndex = 10
            let name = this.getNameFromIndex(nameIndex)
            while (!this.tryOccupyName(renameSetArr, sigSet, refNode, name)) {
                name = this.getNameFromIndex(++nameIndex)
            }
            const nameBuffer = encoder.encode(name)
            for (const key of refNode.refSet) {
                const { fileIndex, pos } = this.getFileAndPosFromKey(key)
                renameArr[fileIndex].push({
                    pos,
                    name: refNode.name,
                    changed: name,
                    changedBuffer: nameBuffer,
                })
            }
        }
        for (const rename of renameArr) {
            rename.sort((left, right) => left.pos - right.pos)
        }
        return renameArr
    }

    private tryOccupyName(renameSetArr: Set<string>[], sigSet: Set<string>, refNode: RefNode, name: string) {
        if (this._reservedWordSet.has(name)) {
            return false
        }
        const { refSet, isSignature } = refNode
        if (isSignature && sigSet.has(name)) {
            return false
        }
        const fileIndexSet = new Set<number>()
        for (const key of refSet) {
            const { fileIndex } = this.getFileAndPosFromKey(key)
            fileIndexSet.add(fileIndex)
        }
        for (const fileIndex of fileIndexSet) {
            if (renameSetArr[fileIndex].has(name)) {
                return false
            }
        }
        if (isSignature) {
            sigSet.add(name)
        }
        for (const fileIndex of fileIndexSet) {
            renameSetArr[fileIndex].add(name)
        }
        return true
    }

    private getNameFromIndex(nameIndex: number): string {
        const { _nameTable } = this
        let index = nameIndex & 63
        let name = ''
        nameIndex >>>= 6
        if (nameIndex) {
            do {
                name = _nameTable[index] + name
                index = nameIndex & 63
                // eslint-disable-next-line no-cond-assign
            } while (nameIndex >>>= 6)
            index += 9
        }
        if (index < 64) {
            return _nameTable[index] + name
        } else {
            index -= 64
            return _nameTable[10] + _nameTable[index] + name
        }
    }

    private generateDestFiles(renameArr: RenameNode[][], contentArr: string[], program: Program) {
        const encoder = new TextEncoder()
        const { _srcDir, _destDir, _fileArr, _decFileArr, _sourceMapInputDir, _sourceMapOutputDir } = this
        const srcDirNameLen = _srcDir.length
        for (let i = 0; i < renameArr.length; i++) {
            const fileRenameArr = renameArr[i]
            const srcFileName = _fileArr[i]
            const filePath = srcFileName.slice(srcDirNameLen)
            const dirName = path.dirname(filePath)
            const destFileName = path.join(_destDir, filePath)
            fs.mkdirSync(path.join(_destDir, dirName), { recursive: true })
            const content = contentArr[i]
            const modified: Uint8Array[] = []
            let from = 0
            if (_sourceMapOutputDir) {
                const fileName = path.basename(filePath)
                const sourceRoot = path.join(_sourceMapOutputDir, dirName)
                const sourceMapGen = new SourceMapGenerator({
                    file: fileName,
                    sourceRoot: sourceRoot,
                })
                if (_sourceMapInputDir) {
                    const inputSourceMapFileName = path.join(_sourceMapInputDir, filePath + '.map')
                    if (fs.existsSync(inputSourceMapFileName)) {
                        //
                    }
                }
                const sourceFile = program.getSourceFile(srcFileName)!
                const relativeSourcePath = path.relative(sourceRoot, srcFileName)
                let lastLine = 0
                let lineOffset = 0
                for (const renameNode of fileRenameArr) {
                    const { pos, name, changed, changedBuffer } = renameNode
                    const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, pos)
                    if (line !== lastLine) {
                        lastLine = line
                        lineOffset = 0
                    } else {
                        lineOffset += changed.length - name.length
                    }
                    const mapping: Mapping = {
                        generated: { line: line + 1, column: character + 1 - lineOffset },
                        original: { line: line + 1, column: character + 1 },
                        source: relativeSourcePath,
                        name: name
                    }
                    sourceMapGen.addMapping(mapping)
                    const buffer = encoder.encode(content.substring(from, pos))
                    modified.push(buffer, changedBuffer)
                    from = pos + name.length
                }
                fs.mkdirSync(path.join(_sourceMapOutputDir, dirName), { recursive: true })
                const mapFile = fs.openSync(path.join(_sourceMapOutputDir, filePath + '.map'), 'w+')
                const mapFileContent = JSON.stringify(sourceMapGen.toJSON())
                fs.writeFileSync(mapFile, mapFileContent)
                fs.closeSync(mapFile)
            } else {
                for (const renameNode of fileRenameArr) {
                    const { pos, name, changedBuffer } = renameNode
                    const buffer = encoder.encode(content.substring(from, pos))
                    modified.push(buffer, changedBuffer)
                    from = pos + name.length
                }
            }
            if (from < content.length) {
                const buffer = encoder.encode(content.substring(from))
                modified.push(buffer)
            }
            const dest = fs.openSync(destFileName, 'w+')
            fs.writevSync(dest, modified)
            fs.closeSync(dest)
        }
        for (const srcFileName of _decFileArr) {
            const destFileName = _destDir + srcFileName.slice(srcDirNameLen)
            const dirName = path.dirname(destFileName)
            fs.mkdirSync(dirName, { recursive: true })
            fs.copyFileSync(srcFileName, destFileName)
        }
    }

    private _srcDir: string
    private _destDir: string
    private _interfaceFileArr: string[]
    private _interfaceFileSet: Set<number>
    private _sourceMapInputDir?: string
    private _sourceMapOutputDir?: string
    private _exportEntryMap: Map<string, number>
    private _fileArr: string[]
    private _decFileArr: string[]
    private _fileMap: Map<string, number>
    private _refMap: Map<string, RefNode>
    private _nameTable: string[]
    private _reservedWordSet: Set<string>
}
