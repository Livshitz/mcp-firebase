export const users = {
    u1: { name: 'Alice', age: 30 },
    u2: { name: 'Bob', age: 25 },
    u3: { name: 'Carol', age: 35 },
};

export const nested = {
    level1: {
        level2: {
            level3: { value: 'deep' },
        },
    },
};

export const scalar = 'hello';

export const large: Record<string, number> = Object.fromEntries(
    Array.from({ length: 1000 }, (_, i) => [`key${i}`, i])
);
