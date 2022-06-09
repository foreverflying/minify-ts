
var foo = 0
const bar = 1
let some = 10, one = 2

function func() {
    console.log(some, one)
}

export interface ITry {
    print(age: number): void
}

export const sleep = (ms: number) => {
    return new Promise(resolve => setTimeout(resolve, ms))
}
