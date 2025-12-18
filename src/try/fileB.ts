import { funcA as funcABC, varA } from './fileA'
export { varA, testFunc, TemplateFuncType, TestType2, testFunc1 } from './fileA'

export const varB = 'world'

export const { age: myAge } = varA
export const [myBook1, myBook2] = varA.books

const yourAge = myAge

export type TestType1<T extends { fieldC: string, fieldD: number }> = {
    propA: T
    propB: string
}

const funcB = (word: string) => funcABC() + ' ' + varB + word

export {
    funcB as funcB1,
    myFunc1,
    ISome,
}

export enum ClientConnState {
    NotConnected = 0,
    Connecting = 1,
    Connected = 2,
}

type IHello = {
    readonly name: string
    readonly addr: string
}

type IWorld = {
    age: number
    hello?: IHello
}

const temp: IWorld[] = []

interface ISome extends IWorld {
    func1(p1: number, p2: string): void
}

class ClassA implements ISome {
    name: string = 'hi'
    age: number = 10
    hello?: IHello

    static staticFunc1(p3: number, p4: number) {
        this.some = p3 + p4
    }

    private static some?: number

    func1(p1: number, p2: string): void {
        this.func2(p1, p2)
        const age = p1
        const addr = p2
        temp.push({ age, hello: { name: p2, addr } })
    }

    funcOfClassA() {
        //
    }

    private func2(p1: number, p2: string): void {
        console.log('name is', this.name)
        const { name } = this
    }
}

/**
 * @param p3 some thing
 * @returns wrong
 */
function myFunc1(p3: number, p4: boolean): number {
    const ccc = funcB
    funcB('hi')
    return 0
}

export const myFunc2 = (p1: number, p2: boolean): number => {
    return myFunc1(p1, p2)
}

export function myFunc3(p3: number, p4: boolean): number {
    return myFunc2(p3, p4)
}

type MyType = {
    prop1: string
    method1: () => string
    method2(param1: string, param2: number): void
}

export interface IMyInterface extends MyType {
    some: ISome
}

export type Abc = ISome & {
    some1: number
}

type Abcd = Abc & {
    world: string
}

class What implements Abcd {
    some1: number = 1
    hello?: IHello
    name: string = 'hi'
    func1(p1: number, p2: string): void {
        throw new Error('Method not implemented.')
    }
    world: string = 'world'
    age: number = 11
}

class Where extends What {
    func2(p1: number, p2: string): void {
        throw new Error('Method not implemented.')
    }
}

export class Why extends What {
    newField?: Where

    func1(p1Some: number, p2Some: string): void {
        throw new Error('Method not implemented.')
    }

    func2(p1: string): ClassA {
        throw new Error('Method not implemented.')
    }
}