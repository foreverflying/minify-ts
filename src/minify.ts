import ts, { SyntaxKind } from 'typescript'
import fs from 'fs'
import path from 'path'
import { type Mapping, SourceMapGenerator } from 'source-map'

type VisitHelper = {
    typeChecker: ts.TypeChecker
    service: ts.LanguageService
    contentArr: string[]
}

type RefNode = {
    key: string
    refSet: Set<string>
    name: string
    link?: RefNode
    isFixed?: true
    isSignature?: true
    isJsxCom?: true
}

type RenameNode = {
    pos: number
    name: string
    changed: string
    changedBuffer: Uint8Array
}

// these minimum options are very important for the Minifier tracing the references correctly in the lib files
const defaultCompilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
}

const renameCharStr = '0123456789abcdefghijklmnopqrstuvwxyz$_ABCDEFGHIJKLMNOPQRSTUVWXYZ'

const reservedWordStr = 'break,case,catch,class,const,continue,debugger,default,delete,do,else,enum,\
export,extends,false,finally,for,function,get,if,import,in,istanceOf,new,null,return,super,switch,this,throw,\
true,try,typeOf,var,void,while,with,as,implements,interface,let,package,private,protected,public,static,\
any,boolean,constructor,declare,get,module,require,number,set,string,symbol,type,from,of,\
Infinity,NaN,undefined,global,globalThis,eval,uneval,isFinite,isNaN,parseFloat,parseInt,decodeURI,\
decodeURIComponent,encodeURI,encodeURIComponent,Object,Function,Boolean,Symbol,Error,AggregateError,EvalError,\
InternalError,RangeError,ReferenceError,SyntaxError,TypeError,URIError,Number,BigInt,Math,Date,String,RegExp,\
Array,Int8Array,Uint8Array,Uint8ClampedArray,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,\
Float64Array,BigInt64Array,BigUint64Array,Map,Set,WeakMap,WeakSet,ArrayBuffer,SharedArrayBuffer,Atomics,\
DataView,JSON,Promise,Generator,GeneratorFunction,AsyncFunction,__dirname,__filename,console,process,Buffer,\
setImmediate,setInterval,setTimeout,clearImmediate,clearInterval,clearTimeout'

const basicTypeFlags = ts.TypeFlags.Any | ts.TypeFlags.String | ts.TypeFlags.Number
    | ts.TypeFlags.Boolean | ts.TypeFlags.BigInt | ts.TypeFlags.Literal | ts.TypeFlags.Void
    | ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Never | ts.TypeFlags.Unknown

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
    generateSourceMap?: boolean
    obfuscate?: boolean
    program?: ts.Program
}

export type RenamedContent = {
    bufferArr: Uint8Array[]
    posArr: number[]
}

export type FileCallback = (srcPath: string, destPath: string, content?: RenamedContent, sourceMap?: string) => void

export const writeDestFile: FileCallback = (srcPath, destPath, content, sourceMap) => {
    const destDir = path.dirname(destPath)
    fs.mkdirSync(destDir, { recursive: true })
    if (content !== undefined) {
        const dest = fs.openSync(destPath, 'w+')
        fs.writevSync(dest, content.bufferArr)
        fs.closeSync(dest)
        if (sourceMap !== undefined) {
            const destMap = fs.openSync(destPath + '.map', 'w+')
            fs.writeFileSync(destMap, sourceMap)
            fs.closeSync(destMap)
        }
    } else {
        fs.copyFileSync(srcPath, destPath)
    }
}

export const minify = (options: MinifierOptions, fileCallback: FileCallback, compilerOptions?: ts.CompilerOptions) => {
    const minifier = new Minifier(options, compilerOptions)
    minifier.compileProject(fileCallback, options.program)
}

class Minifier {
    constructor(options: MinifierOptions, compilerOptions?: ts.CompilerOptions) {
        const { srcDir, destDir, interfaceFileArr, generateSourceMap, obfuscate } = options
        const cwd = process.cwd()
        const sep = path.sep
        this._srcRoot = path.isAbsolute(srcDir) ? path.normalize(srcDir + sep) : path.join(cwd, srcDir, sep)
        this._destRoot = path.isAbsolute(destDir) ? path.normalize(destDir + sep) : path.join(cwd, destDir, sep)
        this._generateSourceMap = !!generateSourceMap
        this._obfuscate = !!obfuscate
        this._interfaceFileArr = interfaceFileArr.map(filePath => path.join(this._srcRoot, filePath))
        this._interfaceFileSet = new Set<number>()
        this._exportNodeSet = new Set<ts.Node>()
        this._fileArr = []
        this._decFileArr = []
        this._fileMap = new Map<string, number>()
        this._exportedRefSet = new Set<string>()
        this._identifierMap = new Map<string, RefNode>()
        this._refMap = new Map<string, RefNode>()
        this._nameTable = renameCharStr.split('')
        this._reservedWordSet = new Set<string>()
        this._compilerOptions = compilerOptions || defaultCompilerOptions
        for (const word of reservedWordStr.split(',')) {
            this._reservedWordSet.add(word)
        }
    }

    compileProject(fileCallback: FileCallback, program?: ts.Program) {
        const getScriptSnapshot = (fileName: string) => {
            if (!fs.existsSync(fileName)) {
                return undefined
            }
            return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName).toString())
        }
        const { _interfaceFileArr, _compilerOptions, _fileArr, _fileMap, _srcRoot, _decFileArr } = this
        const servicesHost: ts.LanguageServiceHost = {
            getScriptFileNames: () => _interfaceFileArr,
            getScriptVersion: () => '0',
            getScriptSnapshot,
            getCurrentDirectory: () => process.cwd(),
            getCompilationSettings: () => _compilerOptions,
            getDefaultLibFileName: ts.getDefaultLibFilePath,
            fileExists: ts.sys.fileExists,
            readFile: ts.sys.readFile,
            readDirectory: ts.sys.readDirectory,
            directoryExists: ts.sys.directoryExists,
            getDirectories: ts.sys.getDirectories,
        }
        const service = ts.createLanguageService(servicesHost)
        const serviceProgram = service.getProgram()!
        const typeChecker = serviceProgram.getTypeChecker()
        const fileNodeArr = serviceProgram.getSourceFiles().filter(file => {
            const { fileName } = file
            if (fileName.startsWith(_srcRoot) && !fileName.endsWith('.d.ts')) {
                if (program && !program.getSourceFile(fileName)) {
                    return false
                }
                _fileMap.set(fileName, _fileArr.push(fileName) - 1)
                return true
            } else {
                _fileMap.set(fileName, - _decFileArr.push(fileName))
                return false
            }
        })
        const contentArr = _fileArr.map(fileName => serviceProgram.getSourceFile(fileName)!.getFullText()!)
        const visitHelper: VisitHelper = { typeChecker, service, contentArr }
        this.findIdentifiers(visitHelper, fileNodeArr)
        const renameArr = this.buildRenameArr(this._obfuscate)
        this.generateDestFiles(renameArr, contentArr, serviceProgram, fileCallback)
    }

    private findIdentifiers(visitHelper: VisitHelper, fileNodeArr: ts.SourceFile[]) {
        const { _interfaceFileArr, _interfaceFileSet, _fileMap } = this
        for (const fileName of _interfaceFileArr) {
            const fileIndex = _fileMap.get(fileName)!
            _interfaceFileSet.add(fileIndex)
        }
        for (let i = 0; i < fileNodeArr.length; i++) {
            const fileNode = fileNodeArr[i]
            this.visitNode(visitHelper, fileNode, i, 0)
        }
    }

    private visitNode(helper: VisitHelper, node: ts.Node, fileIndex: number, layer: number) {
        const { _interfaceFileSet, _identifierMap, _fileArr } = this
        const { typeChecker, service, contentArr } = helper
        const children = node.getChildren()
        // const nodeTypeStr = ts.SyntaxKind[node.kind]
        // console.log(`${'  '.repeat(layer)}${layer} - type: ${nodeTypeStr}, children: ${children.length}`)
        if (ts.isModuleDeclaration(node)) {
            const { name } = node
            const text = name.text
            if (text === 'globalThis' || text === 'global' || text === 'window') {
                this.traceExportedNode(typeChecker, node, false)
            }
        } else if (_interfaceFileSet.has(fileIndex)) {
            if (ts.isExportDeclaration(node)) {
                const exportClause = node.exportClause
                if (exportClause && ts.isNamedExports(exportClause)) {
                    for (const element of exportClause.elements) {
                        if (ts.isExportSpecifier(element)) {
                            const refNode = this.getRefNodeOfDeclaration(element)
                            this.markRefNodeExported(refNode)
                            const symbol = typeChecker.getExportSpecifierLocalTargetSymbol(element)
                            if (symbol?.declarations?.length) {
                                for (const declaration of symbol.declarations) {
                                    this.traceExportedStatement(typeChecker, declaration, false)
                                    if (ts.isVariableDeclaration(declaration)) {
                                        const typeNode = (declaration).type
                                        if (typeNode && ts.isTypeReferenceNode(typeNode) && typeNode.typeArguments?.length) {
                                            for (const argument of typeNode.typeArguments) {
                                                this.traceExportedNode(typeChecker, argument)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            } else if (ts.isExportAssignment(node)) {
                const symbol = typeChecker.getSymbolAtLocation(node.expression)
                if (symbol?.declarations?.length) {
                    for (const declaration of symbol.declarations) {
                        this.traceExportedStatement(typeChecker, declaration, false)
                    }
                }
            } else if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(mod => mod.kind === SyntaxKind.ExportKeyword)) {
                this.traceExportedStatement(typeChecker, node)
            }
        }
        if (ts.isIdentifier(node) && node.text !== 'this') {
            const key = this.getKeyFromNode(node, fileIndex)
            const identifierRefNode = _identifierMap.get(key)
            const { parent, text } = node
            if (ts.isJsxSelfClosingElement(parent) || ts.isJsxOpeningElement(parent) || ts.isJsxClosingElement(parent)) {
                if (identifierRefNode && !identifierRefNode.isJsxCom) {
                    const firstChar = text[0]
                    if (identifierRefNode && firstChar >= 'A' && firstChar <= 'Z') {
                        identifierRefNode.isJsxCom = true
                    }
                }
                return
            }
            if (!identifierRefNode) {
                let symbol = typeChecker.getSymbolAtLocation(node)
                if (symbol && (symbol.flags & ts.SymbolFlags.Alias)) {
                    const aliasedSymbol = symbol ? typeChecker.getAliasedSymbol(symbol) : symbol
                    if (aliasedSymbol !== symbol && aliasedSymbol.escapedName === symbol.escapedName) {
                        symbol = aliasedSymbol
                    }
                }
                if (symbol?.declarations?.length) {
                    let { declarations } = symbol
                    const { fileIndex, pos } = this.getFileAndPosFromKey(key)
                    const refArr = service.getReferencesAtPosition(_fileArr[fileIndex], pos)!
                    let refNode = this.getRefNodeOfDeclaration(declarations[0])
                    this.linkReferencesToRefNode(refArr, refNode, text, contentArr)
                    let i = 0
                    let last: RefNode | undefined = undefined
                    while (i < declarations.length) {
                        const declaration = declarations[i++]
                        let isSignature = false
                        if (ts.isMethodDeclaration(declaration) || ts.isPropertyDeclaration(declaration)) {
                            isSignature = true
                            if (!declaration.modifiers?.some((modifier) => modifier.kind === SyntaxKind.PrivateKeyword)) {
                                const extraDeclarations = this.collectDeclarationsInBaseType(typeChecker, declaration)
                                if (extraDeclarations.length) {
                                    declarations = declarations.concat(extraDeclarations)
                                }
                            }
                        }
                        refNode = this.getRefNodeOfDeclaration(declaration)
                        if (isSignature) {
                            refNode.isSignature = true
                        }
                        if (last && last !== refNode) {
                            this.linkRefNodes(refNode, last)
                        }
                        last = refNode
                    }
                }
            } else if (ts.isShorthandPropertyAssignment(node.parent)) {
                const { pos } = this.getFileAndPosFromKey(key)
                const refArr = service.getReferencesAtPosition(_fileArr[fileIndex], pos)!
                this.linkReferencesToRefNode(refArr, identifierRefNode, text, contentArr)
            }
        }
        for (const child of children) {
            this.visitNode(helper, child, fileIndex, layer + 1)
        }
    }

    private linkReferencesToRefNode(refArr: ts.ReferenceEntry[], refNode: RefNode, name: string, contentArr: string[]) {
        const { _identifierMap, _fileMap } = this
        for (const ref of refArr) {
            const { textSpan, fileName } = ref
            const refFileIndex = _fileMap.get(fileName)!
            if (refFileIndex >= 0) {
                const { start, length } = textSpan
                const fileText = contentArr[refFileIndex]
                if (length !== name.length || !matchInString(name, fileText, start)) {
                    continue
                }
                const key = `${refFileIndex}_${start}`
                refNode.refSet.add(key)
                const previousRefNode = _identifierMap.get(key)
                if (previousRefNode) {
                    this.linkRefNodes(previousRefNode, refNode)
                } else {
                    _identifierMap.set(key, refNode)
                }
            } else {
                refNode.isFixed = true
            }
        }
    }

    private linkRefNodes(nodeA: RefNode, nodeB: RefNode) {
        while (nodeA.link) {
            nodeA = nodeA.link
        }
        while (nodeB.link) {
            nodeB = nodeB.link
        }
        if (nodeA.key > nodeB.key) {
            nodeA.link = nodeB
            nodeB.isSignature ||= nodeA.isSignature
            nodeB.isJsxCom ||= nodeA.isJsxCom
        } else if (nodeA.key < nodeB.key) {
            nodeB.link = nodeA
            nodeA.isSignature ||= nodeB.isSignature
            nodeA.isJsxCom ||= nodeB.isJsxCom
        }
    }

    private traceExportedStatement(typeChecker: ts.TypeChecker, node: ts.Node, markNameExported = true) {
        if (ts.isVariableStatement(node)) {
            for (const declaration of node.declarationList.declarations) {
                if (ts.isObjectBindingPattern(declaration.name) || ts.isArrayBindingPattern(declaration.name)) {
                    for (const element of declaration.name.elements) {
                        if (ts.isBindingElement(element)) {
                            if (markNameExported) {
                                const refNode = this.getRefNodeOfDeclaration(element)
                                this.markRefNodeExported(refNode)
                            }
                            const type = typeChecker.getTypeAtLocation(element.name)
                            this.traceExportedType(typeChecker, type)
                        }
                    }
                } else if (ts.isVariableDeclaration(declaration)) {
                    if (markNameExported) {
                        const refNode = this.getRefNodeOfDeclaration(declaration)
                        this.markRefNodeExported(refNode)
                    }
                    const type = typeChecker.getTypeAtLocation(declaration.name)
                    this.traceExportedType(typeChecker, type)
                    const typeNode = declaration.type
                    if (typeNode && ts.isTypeReferenceNode(typeNode) && typeNode.typeArguments?.length) {
                        for (const argument of typeNode.typeArguments) {
                            this.traceExportedNode(typeChecker, argument)
                        }
                    }
                }
            }
        } else if (ts.isClassDeclaration(node) || ts.isModuleDeclaration(node) || ts.isEnumDeclaration(node)) {
            if (markNameExported) {
                const refNode = this.getRefNodeOfDeclaration(node)
                this.markRefNodeExported(refNode)
            }
            this.traceExportedNode(typeChecker, node, false)
        } else {
            const type = typeChecker.getTypeAtLocation(node)
            this.traceExportedType(typeChecker, type)
        }
    }

    private collectDeclarationsInBaseType(
        typeChecker: ts.TypeChecker,
        declaration: ts.MethodDeclaration | ts.PropertyDeclaration,
    ): ts.Declaration[] {
        const ret: ts.Declaration[] = []
        const typeDeclaration = declaration.parent
        const name = declaration.name.getText()
        const type = typeChecker.getTypeAtLocation(typeDeclaration)
        const baseTypes = type.getBaseTypes()
        if (baseTypes?.length) {
            for (const base of baseTypes) {
                const prop = base.getProperty(name)
                if (prop?.declarations?.length) {
                    for (const declaration of prop.declarations) {
                        ret.push(declaration)
                    }
                }
            }
        }
        if (ts.isClassDeclaration(typeDeclaration) && typeDeclaration.heritageClauses) {
            for (const clause of typeDeclaration.heritageClauses) {
                if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
                    for (const typeNode of clause.types) {
                        const interfaceType = typeChecker.getTypeAtLocation(typeNode.expression)
                        const prop = typeChecker.getPropertyOfType(interfaceType, name)
                        if (prop?.declarations) {
                            ret.push(...prop.declarations)
                        }
                    }
                }
            }
        }
        return ret
    }

    private traceExportedType(typeChecker: ts.TypeChecker, type: ts.Type) {
        if (type.flags & basicTypeFlags) {
            return
        }
        if (type.isUnionOrIntersection()) {
            for (const subType of type.types) {
                this.traceExportedType(typeChecker, subType)
            }
            return
        }
        const symbol = type.getSymbol()
        if (symbol?.declarations?.length) {
            for (const declarartion of symbol.declarations) {
                this.traceExportedNode(typeChecker, declarartion)
            }
        }
    }

    private traceExportedNode(typeChecker: ts.TypeChecker, node: ts.Node, markNameExported = true) {
        const { _exportNodeSet, _srcRoot } = this
        if (!node.getSourceFile().fileName.startsWith(_srcRoot)) {
            return
        }
        switch (node.kind) {
            case SyntaxKind.AnyKeyword:
            case SyntaxKind.BigIntKeyword:
            case SyntaxKind.BooleanKeyword:
            case SyntaxKind.LiteralType:
            case SyntaxKind.NeverKeyword:
            case SyntaxKind.NullKeyword:
            case SyntaxKind.NumberKeyword:
            case SyntaxKind.ObjectKeyword:
            case SyntaxKind.StringKeyword:
            case SyntaxKind.UndefinedKeyword: {
                return
            }
        }
        if (markNameExported) {
            if (_exportNodeSet.has(node)) {
                return
            }
            _exportNodeSet.add(node)
        }
        switch (node.kind) {
            case SyntaxKind.ArrayType: {
                this.traceExportedArrayType(typeChecker, node as ts.ArrayTypeNode)
                break
            }
            case SyntaxKind.ArrowFunction: {
                this.traceExportedArrowFunction(typeChecker, node as ts.ArrowFunction)
                break
            }
            case SyntaxKind.ClassDeclaration: {
                this.traceExportedClass(typeChecker, node as ts.ClassDeclaration, markNameExported)
                break
            }
            case SyntaxKind.ConditionalType: {
                this.traceExportedConditionalType(typeChecker, node as ts.ConditionalTypeNode)
                break
            }
            case SyntaxKind.ConstructorType: {
                this.traceExportedConstructorType(typeChecker, node as ts.ConstructorTypeNode)
                break
            }
            case SyntaxKind.EnumDeclaration: {
                this.traceExportedEnum(typeChecker, node as ts.EnumDeclaration, markNameExported)
                break
            }
            case SyntaxKind.FunctionDeclaration: {
                this.traceExportedFunction(typeChecker, node as ts.FunctionDeclaration, markNameExported)
                break
            }
            case SyntaxKind.FunctionExpression: {
                this.traceExportedFunction(typeChecker, node as ts.FunctionExpression, markNameExported)
                break
            }
            case SyntaxKind.FunctionType: {
                this.traceExportedFunctionType(typeChecker, node as ts.FunctionTypeNode)
                break
            }
            case SyntaxKind.IndexedAccessType: {
                this.traceExportedIndexedAccessType(typeChecker, node as ts.IndexedAccessTypeNode)
                break
            }
            case SyntaxKind.ImportSpecifier: {
                this.traceExportedImportSpecifier(typeChecker, node as ts.ImportSpecifier)
                break
            }
            case SyntaxKind.InterfaceDeclaration: {
                this.traceExportedInterface(typeChecker, node as ts.InterfaceDeclaration)
                break
            }
            case SyntaxKind.IntersectionType: {
                this.traceExportedIntersectionTypeNode(typeChecker, node as ts.IntersectionTypeNode)
                break
            }
            case SyntaxKind.MappedType: {
                this.traceExportedMappedType(typeChecker, node as ts.MappedTypeNode)
                break
            }
            case SyntaxKind.MethodDeclaration: {
                this.traceExportedMethod(typeChecker, node as ts.MethodDeclaration)
                break
            }
            case SyntaxKind.MethodSignature: {
                this.traceExportedMethod(typeChecker, node as ts.MethodSignature)
                break
            }
            case SyntaxKind.ModuleDeclaration: {
                this.traceExportedModuleDeclaration(typeChecker, node as ts.ModuleDeclaration, markNameExported)
                break
            }
            case SyntaxKind.ObjectLiteralExpression: {
                this.traceExportedObjectLiteralExpression(typeChecker, node as ts.ObjectLiteralExpression)
                break
            }
            case SyntaxKind.ParenthesizedType: {
                this.traceExportedParenthesizedType(typeChecker, node as ts.ParenthesizedTypeNode)
                break
            }
            case SyntaxKind.TupleType: {
                this.traceExportedTupleType(typeChecker, node as ts.TupleTypeNode)
                break
            }
            case SyntaxKind.TypeReference: {
                this.traceExportedTypeReferenceNode(typeChecker, node as ts.TypeReferenceNode)
                break
            }
            case SyntaxKind.TypeAliasDeclaration: {
                this.traceExportedTypeAlias(typeChecker, node as ts.TypeAliasDeclaration)
                break
            }
            case SyntaxKind.TypeLiteral: {
                this.traceExportedTypeLiteral(typeChecker, node as ts.TypeLiteralNode)
                break
            }
            case SyntaxKind.TypeOperator: {
                this.traceExportedTypeOperator(typeChecker, node as ts.TypeOperatorNode)
                break
            }
            case SyntaxKind.TypeParameter: {
                this.traceExportedTypeParameter(typeChecker, node as ts.TypeParameterDeclaration)
                break
            }
            case SyntaxKind.UnionType: {
                this.traceExportedUnionTypeNode(typeChecker, node as ts.UnionTypeNode)
                break
            }
            case SyntaxKind.VariableDeclaration: {
                this.traceExportedVariable(typeChecker, node as ts.VariableDeclaration, markNameExported)
                break
            }
            default: {
                throw new Error('Unknown node type: ' + SyntaxKind[node.kind])
            }
        }
    }

    private traceExportedInterface(typeChecker: ts.TypeChecker, node: ts.InterfaceDeclaration) {
        if (node.typeParameters?.length) {
            for (const parameter of node.typeParameters) {
                this.traceExportedNode(typeChecker, parameter)
            }
        }
        const interfaceType = typeChecker.getTypeAtLocation(node)
        const baseTypes = interfaceType.getBaseTypes()
        if (baseTypes?.length) {
            for (const base of baseTypes) {
                const symbol = base.getSymbol()
                if (symbol?.declarations?.length) {
                    for (const declaration of symbol.declarations) {
                        this.traceExportedNode(typeChecker, declaration)
                    }
                }
            }
        }
        const props = typeChecker.getPropertiesOfType(interfaceType)
        for (const prop of props) {
            if (prop.declarations?.length) {
                for (const declaration of prop.declarations) {
                    const refNode = this.getRefNodeOfDeclaration(declaration)
                    this.markRefNodeExported(refNode)
                    if (ts.isPropertySignature(declaration) || ts.isMethodSignature(declaration)) {
                        const type = typeChecker.getTypeAtLocation(declaration)
                        this.traceExportedType(typeChecker, type)
                    }
                }
            }
        }
    }

    private traceExportedTypeAlias(typeChecker: ts.TypeChecker, node: ts.TypeAliasDeclaration) {
        if (node.typeParameters?.length) {
            for (const parameter of node.typeParameters) {
                this.traceExportedNode(typeChecker, parameter)
            }
        }
        this.traceExportedNode(typeChecker, node.type)
    }

    private traceExportedImportSpecifier(typeChecker: ts.TypeChecker, node: ts.ImportSpecifier) {
        const refNode = this.getRefNodeOfDeclaration(node)
        this.markRefNodeExported(refNode)
        let symbol = typeChecker.getSymbolAtLocation(node.name)!
        symbol = typeChecker.getAliasedSymbol(symbol)!
        if (symbol.declarations?.length) {
            for (const declaration of symbol.declarations) {
                this.traceExportedNode(typeChecker, declaration)
            }
        }
    }

    private traceExportedIntersectionTypeNode(typeChecker: ts.TypeChecker, node: ts.IntersectionTypeNode) {
        for (const typeNode of node.types) {
            this.traceExportedNode(typeChecker, typeNode)
        }
    }

    private traceExportedUnionTypeNode(typeChecker: ts.TypeChecker, node: ts.UnionTypeNode) {
        for (const typeNode of node.types) {
            this.traceExportedNode(typeChecker, typeNode)
        }
    }

    private traceExportedTypeReferenceNode(typeChecker: ts.TypeChecker, node: ts.TypeReferenceNode) {
        if (node.typeArguments?.length) {
            for (const argument of node.typeArguments) {
                this.traceExportedNode(typeChecker, argument)
            }
        }
        const symbol = typeChecker.getSymbolAtLocation(node.typeName)
        if (symbol?.declarations?.length) {
            for (const declaration of symbol.declarations) {
                this.traceExportedNode(typeChecker, declaration)
            }
        }
    }

    private traceExportedMappedType(typeChecker: ts.TypeChecker, node: ts.MappedTypeNode) {
        this.traceExportedNode(typeChecker, node.typeParameter)
        if (node.type) {
            this.traceExportedNode(typeChecker, node.type)
        }
        if (node.members?.length) {
            for (const member of node.members) {
                this.traceExportedNode(typeChecker, member)
            }
        }
    }

    private traceExportedTypeLiteral(typeChecker: ts.TypeChecker, node: ts.TypeLiteralNode) {
        const type = typeChecker.getTypeAtLocation(node)
        const props = typeChecker.getPropertiesOfType(type)
        for (const prop of props) {
            if (prop.declarations?.length) {
                for (const declaration of prop.declarations) {
                    const refNode = this.getRefNodeOfDeclaration(declaration)
                    this.markRefNodeExported(refNode)
                    if (ts.isPropertySignature(declaration) || ts.isMethodDeclaration(declaration)) {
                        const type = typeChecker.getTypeAtLocation(declaration)
                        this.traceExportedType(typeChecker, type)
                    }
                }
            }
        }
    }

    private traceExportedArrayType(typeChecker: ts.TypeChecker, node: ts.ArrayTypeNode) {
        this.traceExportedNode(typeChecker, node.elementType)
    }

    private traceExportedIndexedAccessType(typeChecker: ts.TypeChecker, node: ts.IndexedAccessTypeNode) {
        this.traceExportedNode(typeChecker, node.objectType)
    }

    private traceExportedParenthesizedType(typeChecker: ts.TypeChecker, node: ts.ParenthesizedTypeNode) {
        this.traceExportedNode(typeChecker, node.type)
    }

    private traceExportedTupleType(typeChecker: ts.TypeChecker, node: ts.TupleTypeNode) {
        for (const element of node.elements) {
            this.traceExportedNode(typeChecker, element)
        }
    }

    private traceExportedTypeOperator(typeChecker: ts.TypeChecker, node: ts.TypeOperatorNode) {
        this.traceExportedNode(typeChecker, node.type)
    }

    private traceExportedTypeParameter(typeChecker: ts.TypeChecker, node: ts.TypeParameterDeclaration) {
        if (node.constraint) {
            this.traceExportedNode(typeChecker, node.constraint)
        }
    }

    private traceExportedModuleDeclaration(typeChecker: ts.TypeChecker, node: ts.ModuleDeclaration, markNameExported: boolean) {
        if (markNameExported) {
            const refNode = this.getRefNodeOfDeclaration(node)
            this.markRefNodeExported(refNode)
        }
        if (node.body) {
            if (ts.isModuleDeclaration(node.body)) {
                this.traceExportedModuleDeclaration(typeChecker, node.body, true)
            } else if (ts.isModuleBlock(node.body)) {
                for (const statement of node.body.statements) {
                    if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(mod => mod.kind === SyntaxKind.ExportKeyword)) {
                        this.traceExportedStatement(typeChecker, statement)
                    }
                }
            }
        }
    }

    private traceExportedClass(typeChecker: ts.TypeChecker, node: ts.ClassDeclaration, markNameExported: boolean) {
        if (markNameExported) {
            const refNode = this.getRefNodeOfDeclaration(node)
            this.markRefNodeExported(refNode)
        }
        if (node.typeParameters?.length) {
            for (const parameter of node.typeParameters) {
                this.traceExportedNode(typeChecker, parameter)
            }
        }
        const classType = typeChecker.getTypeAtLocation(node)
        const baseTypes = classType.getBaseTypes()
        if (baseTypes?.length) {
            for (const base of baseTypes) {
                const symbol = base.getSymbol()
                if (symbol?.declarations?.length) {
                    for (const declaration of symbol.declarations) {
                        this.traceExportedNode(typeChecker, declaration)
                    }
                }
            }
        }
        const props = typeChecker.getPropertiesOfType(classType)
        const classSymbol = typeChecker.getSymbolAtLocation(node.name!)!
        const constructorType = typeChecker.getTypeOfSymbolAtLocation(classSymbol, node)
        const staticProps = typeChecker.getPropertiesOfType(constructorType)
        const allProps = props.concat(staticProps)
        const constructorSignatures = constructorType.getConstructSignatures()
        for (const signature of constructorSignatures) {
            const declaration = signature.getDeclaration()
            if (declaration) {
                if (ts.canHaveModifiers(declaration)) {
                    const modifiers = ts.getModifiers(declaration)
                    if (modifiers?.some((modifier) => modifier.kind === SyntaxKind.PrivateKeyword)) {
                        continue
                    }
                }
                this.traceExportedFunctionParts(typeChecker, signature.getParameters(), undefined)
            }
        }
        for (const prop of allProps) {
            const { declarations } = prop
            if (declarations?.length) {
                for (const declaration of declarations) {
                    const { modifiers } = declaration as ts.PropertyDeclaration | ts.MethodDeclaration
                    if (!modifiers?.some((modifier) => modifier.kind === SyntaxKind.PrivateKeyword)) {
                        const refNode = this.getRefNodeOfDeclaration(declaration)
                        this.markRefNodeExported(refNode)
                        const type = typeChecker.getTypeAtLocation(declaration)
                        const symbol = type.getSymbol()
                        if (symbol?.declarations?.length) {
                            for (const declaration of symbol.declarations) {
                                this.traceExportedNode(typeChecker, declaration)
                            }
                        }
                    }
                }
            }
        }
    }

    private traceExportedObjectLiteralExpression(typeChecker: ts.TypeChecker, node: ts.ObjectLiteralExpression) {
        const classType = typeChecker.getTypeAtLocation(node)
        const props = typeChecker.getPropertiesOfType(classType)
        for (const prop of props) {
            if (prop.declarations?.length) {
                for (const declaration of prop.declarations) {
                    const refNode = this.getRefNodeOfDeclaration(declaration)
                    this.markRefNodeExported(refNode)
                }
            }
        }
    }

    private traceExportedArrowFunction(typeChecker: ts.TypeChecker, node: ts.ArrowFunction) {
        if (node.typeParameters?.length) {
            for (const parameter of node.typeParameters) {
                this.traceExportedNode(typeChecker, parameter)
            }
        }
        const signature = typeChecker.getSignatureFromDeclaration(node)
        if (signature) {
            this.traceExportedFunctionParts(typeChecker, signature.getParameters(), signature.getReturnType())
        }
    }

    private traceExportedConditionalType(typeChecker: ts.TypeChecker, node: ts.ConditionalTypeNode) {
        this.traceExportedNode(typeChecker, node.falseType)
        this.traceExportedNode(typeChecker, node.trueType)
    }

    private traceExportedConstructorType(typeChecker: ts.TypeChecker, node: ts.ConstructorTypeNode) {
        if (node.typeParameters?.length) {
            for (const parameter of node.typeParameters) {
                this.traceExportedNode(typeChecker, parameter)
            }
        }
        const parameters = node.parameters.map((param) => typeChecker.getSymbolAtLocation(param.name)!)
        this.traceExportedFunctionParts(typeChecker, parameters, typeChecker.getTypeAtLocation(node.type))
    }

    private traceExportedFunction(
        typeChecker: ts.TypeChecker,
        node: ts.FunctionDeclaration | ts.FunctionExpression,
        markNameExported: boolean,
    ) {
        if (markNameExported) {
            const refNode = this.getRefNodeOfDeclaration(node)
            this.markRefNodeExported(refNode)
        }
        const typeNode = node.type
        if (typeNode && ts.isTypeReferenceNode(typeNode) && typeNode.typeArguments?.length) {
            for (const argument of typeNode.typeArguments) {
                this.traceExportedNode(typeChecker, argument)
            }
        }
        if (node.parameters.length) {
            for (const parameter of node.parameters) {
                const paramTypeNode = parameter.type
                if (paramTypeNode && ts.isTypeReferenceNode(paramTypeNode) && paramTypeNode.typeArguments?.length) {
                    for (const argument of paramTypeNode.typeArguments) {
                        this.traceExportedNode(typeChecker, argument)
                    }
                }
            }
        }
        if (node.typeParameters?.length) {
            for (const parameter of node.typeParameters) {
                this.traceExportedNode(typeChecker, parameter)
            }
        }
        const signature = typeChecker.getSignatureFromDeclaration(node)
        if (signature) {
            this.traceExportedFunctionParts(typeChecker, signature.getParameters(), signature.getReturnType())
        }
    }

    private traceExportedFunctionType(typeChecker: ts.TypeChecker, node: ts.FunctionTypeNode) {
        if (node.typeParameters?.length) {
            for (const parameter of node.typeParameters) {
                this.traceExportedNode(typeChecker, parameter)
            }
        }
        const signature = typeChecker.getSignatureFromDeclaration(node)
        if (signature) {
            this.traceExportedFunctionParts(typeChecker, signature.getParameters(), signature.getReturnType())
        }
    }

    private traceExportedMethod(typeChecker: ts.TypeChecker, node: ts.MethodSignature | ts.MethodDeclaration) {
        if (node.typeParameters?.length) {
            for (const parameter of node.typeParameters) {
                this.traceExportedNode(typeChecker, parameter)
            }
        }
        const signature = typeChecker.getSignatureFromDeclaration(node)
        if (signature) {
            this.traceExportedFunctionParts(typeChecker, signature.getParameters(), signature.getReturnType())
        }
    }

    private traceExportedFunctionParts(typeChecker: ts.TypeChecker, parameters?: ts.Symbol[], returnType?: ts.Type) {
        if (parameters?.length) {
            for (const parameter of parameters) {
                if (parameter.declarations?.length) {
                    for (const declaration of parameter.declarations) {
                        const refNode = this.getRefNodeOfDeclaration(declaration)
                        this.markRefNodeExported(refNode)
                    }
                }
                const paramType = typeChecker.getTypeOfSymbol(parameter)
                const symbol = paramType.getSymbol()
                if (symbol?.declarations?.length) {
                    for (const declaration of symbol.declarations) {
                        this.traceExportedNode(typeChecker, declaration)
                    }
                }
            }
        }
        if (returnType) {
            const symbol = returnType.getSymbol()
            if (symbol?.declarations?.length) {
                for (const declaration of symbol.declarations) {
                    this.traceExportedNode(typeChecker, declaration)
                }
            }
        }
    }

    private traceExportedVariable(typeChecker: ts.TypeChecker, node: ts.VariableDeclaration, markNameExported: boolean) {
        if (markNameExported) {
            const refNode = this.getRefNodeOfDeclaration(node)
            this.markRefNodeExported(refNode)
        }
        const variableType = typeChecker.getTypeAtLocation(node)
        const symbol = variableType.getSymbol()
        if (symbol?.declarations?.length) {
            for (const declaration of symbol.declarations) {
                this.traceExportedNode(typeChecker, declaration)
            }
        }
    }

    private traceExportedEnum(typeChecker: ts.TypeChecker, node: ts.EnumDeclaration, markNameExported: boolean) {
        if (markNameExported) {
            const refNode = this.getRefNodeOfDeclaration(node)
            this.markRefNodeExported(refNode)
        }
        for (const member of node.members) {
            const refNode = this.getRefNodeOfDeclaration(member)
            this.markRefNodeExported(refNode)
        }
    }

    private getRefNodeOfDeclaration(declaration: ts.Declaration) {
        let node: ts.Node
        let isFixed = false
        switch (declaration.kind) {
            case SyntaxKind.TypeParameter:
            case SyntaxKind.InterfaceDeclaration:
            case SyntaxKind.TypeAliasDeclaration: {
                isFixed = true
                node = (declaration as ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.TypeParameterDeclaration).name
                break
            }
            case SyntaxKind.BindingElement: {
                node = (declaration as ts.BindingElement).name
                break
            }
            case SyntaxKind.ClassDeclaration: {
                node = (declaration as ts.ClassDeclaration).name!
                break
            }
            case SyntaxKind.EnumDeclaration: {
                node = (declaration as ts.EnumDeclaration).name
                break
            }
            case SyntaxKind.EnumMember: {
                node = (declaration as ts.EnumMember).name
                break
            }
            case SyntaxKind.ExportSpecifier: {
                node = (declaration as ts.ExportSpecifier).name
                break
            }
            case SyntaxKind.FunctionDeclaration: {
                node = (declaration as ts.FunctionDeclaration).name!
                break
            }
            case SyntaxKind.FunctionExpression: {
                node = (declaration as ts.FunctionExpression).name!
                break
            }
            case SyntaxKind.GetAccessor: {
                node = (declaration as ts.GetAccessorDeclaration).name
                break
            }
            case SyntaxKind.ImportClause: {
                node = (declaration as ts.ImportClause).name!
                break
            }
            case SyntaxKind.ImportSpecifier: {
                node = (declaration as ts.ImportSpecifier).name
                break
            }
            case SyntaxKind.JsxAttribute: {
                node = (declaration as ts.JsxAttribute).name
                break
            }
            case SyntaxKind.MethodDeclaration: {
                node = (declaration as ts.MethodDeclaration).name
                break
            }
            case SyntaxKind.MethodSignature: {
                node = (declaration as ts.MethodSignature).name
                break
            }
            case SyntaxKind.ModuleDeclaration: {
                node = (declaration as ts.ModuleDeclaration).name
                break
            }
            case SyntaxKind.NamespaceImport: {
                node = (declaration as ts.NamespaceImport).name
                break
            }
            case SyntaxKind.Parameter: {
                node = (declaration as ts.ParameterDeclaration).name
                break
            }
            case SyntaxKind.PropertyAssignment: {
                node = (declaration as ts.PropertyAssignment).name
                break
            }
            case SyntaxKind.PropertyDeclaration: {
                node = (declaration as ts.PropertyDeclaration).name
                break
            }
            case SyntaxKind.PropertySignature: {
                node = (declaration as ts.PropertySignature).name
                break
            }
            case SyntaxKind.SetAccessor: {
                node = (declaration as ts.SetAccessorDeclaration).name
                break
            }
            case SyntaxKind.ShorthandPropertyAssignment: {
                node = (declaration as ts.ShorthandPropertyAssignment).name
                break
            }
            case SyntaxKind.VariableDeclaration: {
                node = (declaration as ts.VariableDeclaration).name
                break
            }
            default:
                throw new Error('Unknown declaration type: ' + SyntaxKind[declaration.kind])
        }
        const { _fileMap, _identifierMap, _refMap } = this
        const { fileName } = declaration.getSourceFile()
        const fileIndex = _fileMap.get(fileName)!
        const key = this.getKeyFromNode(node, fileIndex)
        let refNode = _identifierMap.get(key) ?? _refMap.get(key)
        if (!refNode) {
            refNode = {
                key,
                refSet: new Set<string>(),
                name: node.getText(),
                link: undefined,
                isFixed: isFixed || fileIndex < 0 ? true : undefined,
            }
            _refMap.set(key, refNode)
            _identifierMap.set(key, refNode)
        }
        return refNode
    }

    private markRefNodeExported(refNode: RefNode) {
        if (refNode.key[0] !== '-') {
            this._exportedRefSet.add(refNode.key)
        }
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

    private getFileAndPosFromKey(key: string) {
        const [fileIndexStr, posStr] = key.split('_')
        const fileIndex = parseInt(fileIndexStr)
        const pos = parseInt(posStr)
        return { fileIndex, pos }
    }

    private buildRenameArr(obfuscate: boolean) {
        const fixedNodeArr: RefNode[] = []
        const refNodeArr: RefNode[] = []
        this.consolidateRefNodes(fixedNodeArr, refNodeArr, obfuscate)
        const renameSetArr: Set<string>[] = []
        for (let i = 0; i < this._fileArr.length; i++) {
            renameSetArr.push(new Set<string>())
        }
        const sigSet = new Set<string>()
        this.preFillFixedName(fixedNodeArr, renameSetArr, sigSet)
        return this.renameAllReferences(refNodeArr, renameSetArr, sigSet)
    }

    private consolidateRefNodes(fixedNodeArr: RefNode[], refNodeArr: RefNode[], obfuscate: boolean) {
        const { _exportedRefSet, _identifierMap, _refMap } = this
        const nameMap = new Map<string, RefNode>()
        for (const key of _exportedRefSet) {
            const node = _identifierMap.get(key)!
            if (node.link) {
                let { link } = node
                while (link.link) {
                    link = link.link
                }
                link.isFixed = true
            } else {
                node.isFixed = true
            }
        }
        for (let [, node] of _refMap) {
            if (!node.link) {
                if (obfuscate) {
                    if (node.isFixed) {
                        fixedNodeArr.push(node)
                    } else {
                        refNodeArr.push(node)
                    }
                    continue
                }
                const { name } = node
                let nameNode = nameMap.get(name)
                if (!nameNode) {
                    nameMap.set(name, node)
                    continue
                }
                if (nameNode.key > node.key) {
                    [nameNode, node] = [node, nameNode]
                    nameMap.set(name, nameNode)
                }
                node.link = nameNode
                nameNode.isFixed ||= node.isFixed
                nameNode.isSignature ||= node.isSignature
                nameNode.isJsxCom ||= node.isJsxCom
            }
            let { link } = node
            while (link.link) {
                link = link.link
            }
            for (const key of node.refSet) {
                link.refSet.add(key)
            }
        }
        if (nameMap.size) {
            for (const [name, node] of nameMap) {
                if (node.isFixed || name[0] === '$') {
                    fixedNodeArr.push(node)
                } else {
                    refNodeArr.push(node)
                }
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
            const startFrom = refNode.isJsxCom ? 38 : 10
            let nameIndex = startFrom
            let name = this.getNameFromIndex(nameIndex, startFrom)
            while (!this.tryOccupyName(renameSetArr, sigSet, refNode, name)) {
                name = this.getNameFromIndex(++nameIndex, startFrom)
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

    private getNameFromIndex(nameIndex: number, startFrom: number): string {
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
            index += startFrom - 1
        }
        if (index < 64) {
            return _nameTable[index] + name
        } else {
            index -= 64
            return _nameTable[startFrom] + _nameTable[index] + name
        }
    }

    private generateDestFiles(
        renameArr: RenameNode[][],
        contentArr: string[],
        program: ts.Program,
        fileCallback: FileCallback,
    ) {
        const encoder = new TextEncoder()
        const { _srcRoot, _destRoot, _fileArr, _decFileArr, _generateSourceMap } = this
        const srcDirNameLen = _srcRoot.length
        for (let i = 0; i < renameArr.length; i++) {
            const fileRenameArr = renameArr[i]
            const srcFile = _fileArr[i]
            const filePath = srcFile.slice(srcDirNameLen)
            const dirName = path.dirname(filePath)
            const destFileName = path.join(_destRoot, filePath)
            const destDir = path.join(_destRoot, dirName)
            const content = contentArr[i]
            const modified: Uint8Array[] = []
            const posArr: number[] = []
            let from = 0
            if (_generateSourceMap) {
                const fileName = path.basename(filePath)
                const sourceFile = program.getSourceFile(srcFile)!
                const relativeSourcePath = path.relative(destDir, srcFile)
                const sourceMapGen = new SourceMapGenerator({
                    file: fileName,
                    sourceRoot: '',
                })
                let recentLine = 0
                let lineOffset = 0
                for (const renameNode of fileRenameArr) {
                    const { pos, name, changed, changedBuffer } = renameNode
                    const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, pos)
                    if (line !== recentLine) {
                        recentLine = line
                        lineOffset = 0
                    }
                    const mapping: Mapping = {
                        generated: { line: line + 1, column: character - lineOffset },
                        original: { line: line + 1, column: character },
                        source: relativeSourcePath,
                        name: name,
                    }
                    lineOffset += name.length - changed.length
                    sourceMapGen.addMapping(mapping)
                    const buffer = encoder.encode(content.substring(from, pos))
                    modified.push(buffer, changedBuffer)
                    posArr.push(from, pos)
                    from = pos + name.length
                }
                if (from < content.length) {
                    const buffer = encoder.encode(content.substring(from))
                    modified.push(buffer)
                }
                const prefix = content.endsWith(ts.sys.newLine) ? '//# ' : `${ts.sys.newLine}//# `
                const sourceMapLink = `${prefix}sourceMappingURL=${fileName}.map`
                const sourceMapLinkBuffer = encoder.encode(sourceMapLink)
                modified.push(sourceMapLinkBuffer)
                const mapFileContent = sourceMapGen.toString()
                const renamedContent: RenamedContent = { bufferArr: modified, posArr }
                fileCallback(srcFile, destFileName, renamedContent, mapFileContent)
            } else {
                for (const renameNode of fileRenameArr) {
                    const { pos, name, changedBuffer } = renameNode
                    const buffer = encoder.encode(content.substring(from, pos))
                    modified.push(buffer, changedBuffer)
                    posArr.push(from, pos)
                    from = pos + name.length
                }
                if (from < content.length) {
                    const buffer = encoder.encode(content.substring(from))
                    modified.push(buffer)
                }
                const renamedContent: RenamedContent = { bufferArr: modified, posArr }
                fileCallback(srcFile, destFileName, renamedContent)
            }
        }
        for (const srcFileName of _decFileArr) {
            if (srcFileName.startsWith(_srcRoot)) {
                const destFileName = _destRoot + srcFileName.slice(srcDirNameLen)
                fileCallback(srcFileName, destFileName)
            }
        }
    }

    private _srcRoot: string
    private _destRoot: string
    private _interfaceFileArr: string[]
    private _interfaceFileSet: Set<number>
    private _generateSourceMap: boolean
    private _obfuscate: boolean
    private _exportNodeSet: Set<ts.Node>
    private _fileArr: string[]
    private _decFileArr: string[]
    private _fileMap: Map<string, number>
    private _exportedRefSet: Set<string>
    private _identifierMap: Map<string, RefNode>
    private _refMap: Map<string, RefNode>
    private _nameTable: string[]
    private _reservedWordSet: Set<string>
    private _compilerOptions: ts.CompilerOptions
}
