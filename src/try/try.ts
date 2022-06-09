import fs from 'fs'
import { ITry, sleep as strange } from './tryLib'
import { open } from 'fs'
import { ITestD } from './testD'

const openFunc = open
const great = {
    // 给点中文注释
    openFunc,
    great: 1
}

export const cool = {
    yyy: 1,
    zzz: 2,
    xyz: {
        xyz1: 1,
        xyz2: 2,
    }
}

type Some = {
    aaa: string,
    bbb: number,
    someFunc(): void
} | {
    ccc: number,
    ddd: string,
    eee: string[][],
    fff?: {
        mmm: string
        nnn?: number
    }
}

export default interface ISome {
    foo: number
    bar: string
    thanks(): void
}

export const awsome: Some = {
    ccc: 1,
    ddd: 'ddd',
    eee: [],
    fff: {
        mmm: 'hello'
    }
}

// export const { ccc, ddd } = awsome

class TryClass implements ITry, ISome, ITestD {
    constructor(name: string) {
        this._name = name
    }

    stupid(num: number) {
        const file = fs.mkdirSync('/tmp', { recursive: true })
    }

    static async fxxk({ foo: p1, bar: p2 }: ISome) {
        const some1: Some = {
            ccc: 2,
            ddd: 'ddd',
            eee: [
                ['hello', 'world']
            ],
        }
        const { ccc, ddd: eee, eee: [[hello, world]] } = some1
        const some2: Some = {
            ccc,
            ddd: eee,
            eee: [[hello, world]]
        }
        const xxx = ccc
        const yyy = some2.ccc
        await strange(1000)
    }

    print(age: number) {
        console.log('name:', this._name)
        this.innerPrint(age)
    }

    thanks(): void {
        //    
    }

    private async innerPrint(age: number) {
        // await sleep(1000)
        console.log('age:', age)
        const b: typeof someFunc = 1
        if (true) {
        }
        let someFunc = 1
    }

    private static staticFunction() {
        const testMap = new Map<string, string>()
        for (const [key, val] of testMap) {
            console.log(key, val)
        }
    }

    public foo!: number
    public bar!: string
    private _name: string
}

export { TryClass as TryClass2 }