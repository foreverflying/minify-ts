
export {
    varAB as varA,
    funcA,
    funcA as funcA1,
}

export type TemplateFuncType<T> = (p1: T, p2: string) => T[]

export const testFunc: TemplateFuncType<{ fieldA: string, fieldB: number }> = (p1, p2) => {
    return [p1]
}

export type TestType2 = TemplateFuncType<{ fieldC: string, fieldD: number }>

export function testFunc1(
    p1: TemplateFuncType<{ fieldE: string, fieldF: number }>,
): TemplateFuncType<{ fieldG: string, fieldH: number }> {
    throw null
}

const varAB = {
    name: 'hello',
    age: 10,
    books: [1, 2],
}

const funcA = () => varAB
