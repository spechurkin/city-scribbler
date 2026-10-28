import {SIZES} from '../generation/generator.js';

const booleanParameters = ['citadel', 'urban_castle', 'plaza', 'temple', 'walls', 'shantytown', 'coast', 'river', 'greens', 'hub'];

export function parseMfcgReference(value) {
    const url = new URL(value);
    if (url.origin !== 'https://watabou.github.io' || url.pathname.replace(/\/$/, '') !== '/city-generator') {
        throw new Error('Ожидается ссылка https://watabou.github.io/city-generator/.');
    }
    const p = url.searchParams, seed = p.get('seed');
    if (!seed || !/^\d+$/.test(seed)) throw new Error('В ссылке нужен числовой сид.');
    const size = Number(p.get('size'));
    if (!Number.isSafeInteger(size) || size < 1 || size > 1000) throw new Error('Размер города должен быть целым числом от 1 до 1000.');
    const reference = {url: url.href, name: p.get('name') || seed, seed, size, flags: {}, optional: {}};
    for (const key of booleanParameters) {
        if (!p.has(key)) continue;
        const value = p.get(key), integer = Number.parseInt(value);
        reference.flags[key] = Number.isNaN(integer) || integer !== 0;
        if (value !== '0' && value !== '1') {
            reference.nonCanonicalFlags ??= {};
            reference.nonCanonicalFlags[key] = {raw: value, resolved: reference.flags[key]};
        }
    }
    for (const key of ['population', 'gates', 'sea']) {
        if (!p.has(key)) continue;
        const value = Number(p.get(key));
        if (!Number.isFinite(value)) throw new Error(`Некорректное значение ${key}.`);
        if (key !== 'sea' && !Number.isSafeInteger(value)) throw new Error(`Параметр ${key} должен быть целым.`);
        reference.optional[key] = value;
    }
    reference.unrecognized = Object.fromEntries([...p].filter(([key]) => !['seed', 'size', 'name', ...booleanParameters, 'population', 'gates', 'sea'].includes(key)));
    return reference;
}

export function projectReferenceToPrototype(reference) {
    const {flags: f} = reference;
    const nearestSize = Object.entries(SIZES).reduce((best, item) => Math.abs(item[1] - reference.size) < Math.abs(best[1] - reference.size) ? item : best);
    const geography = f.coast === undefined || f.river === undefined ? 'auto' : f.coast ? (f.river ? 'estuary' : 'coast') : (f.river ? 'river' : 'inland');
    const options = {seed: reference.seed, size: nearestSize[0], geography};
    for (const [native, local] of [['citadel', 'castle'], ['plaza', 'market'], ['temple', 'temple'], ['walls', 'walls']]) {
        if (f[native] !== undefined) options[local] = f[native];
    }
    return {
        options,
        exact: false,
        approximations: [
            {
                parameter: 'seed',
                source: reference.seed,
                reason: 'Прототип использует FNV-1a и независимые PRNG-потоки. Совместимость случайной последовательности MFCG не реализована.'
            },
            ...(nearestSize[1] !== reference.size ? [{
                parameter: 'size',
                source: reference.size,
                projected: nearestSize[1],
                reason: 'Четыре размера прототипа не представляют точный размер MFCG.'
            }] : []),
            ...['urban_castle', 'shantytown', 'greens', 'hub'].filter(key => f[key] !== undefined).map(parameter => ({
                parameter,
                source: f[parameter],
                reason: 'Параметр сохранён в эталоне, но не имеет совместимой реализации в прототипе.'
            })),
            ...Object.entries(reference.optional).map(([parameter, source]) => ({
                parameter,
                source,
                reason: 'Параметр сохранён в эталоне, но не поддерживается генератором прототипа.'
            })),
            ...Object.entries(reference.unrecognized).map(([parameter, source]) => ({
                parameter,
                source,
                reason: 'Неизвестный параметр не был молча отброшен.'
            }))
        ]
    };
}
