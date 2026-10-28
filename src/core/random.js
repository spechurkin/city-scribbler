export function hashSeed(value) {
    const text = String(value);
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h >>> 0;
}

export function random(seed, channel = '') {
    let state = hashSeed(`${seed}:${channel}`);
    const next = () => {
        state += 0x6d2b79f5;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (a, b) => a + (b - a) * next();
    next.int = (a, b) => Math.floor(next.range(a, b + 1));
    next.pick = values => values[Math.floor(next() * values.length)];
    return next;
}
