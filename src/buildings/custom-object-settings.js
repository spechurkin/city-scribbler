export const CUSTOM_OBJECT_RULES = Object.freeze({
    tavern: 10, inn: 28, hotel: 40, restaurant: 50, cafe: 32, korchma: 30,
    fort: 80, barracks: 40,
    parish_school: 30, school: 28, lyceum: 60, gymnasium: 60, college: 70,
    institute: 90, university: 110, magic_school: 90, magic_tower: 45,
    smithy: 24, workshop: 20, warehouse: 28, guildhall: 50,
    bathhouse: 32, hospital: 40, city_hospital: 80, chapel: 30, monastery: 85,
    windmill: 24, farmhouse: 18, barn: 20
});
export const CUSTOM_OBJECT_COUNTS = Object.freeze(Object.fromEntries(Object.keys(CUSTOM_OBJECT_RULES).map(kind => [kind, `${kind}Count`])));
export const CUSTOM_COUNT_DEFAULTS = Object.freeze(Object.fromEntries(Object.values(CUSTOM_OBJECT_COUNTS).map(key => [key, null])));
export const LODGING_KINDS = Object.freeze(['tavern', 'inn', 'hotel', 'restaurant', 'cafe', 'korchma']);
export const FARM_KINDS = Object.freeze(['windmill', 'farmhouse', 'barn']);
export const LARGE_OBJECT_KINDS = Object.freeze(['university', 'institute', 'magic_school', 'fort', 'monastery', 'city_hospital']);

export const customObjectLimit = (kind, size) => LARGE_OBJECT_KINDS.includes(kind)
    ? Math.min(2, Math.max(1, Math.ceil(Number(size) / 100)))
    : Math.max(1, Math.ceil(Number(size) / (kind === 'tavern' ? 3 : 6)));

export function defaultCustomObjectCount(kind, size) {
    const count = Number(size) / CUSTOM_OBJECT_RULES[kind];
    const requested = kind === 'tavern' || kind === 'farmhouse' ? Math.max(1, Math.ceil(count)) : Math.floor(count);
    return Math.min(requested, customObjectLimit(kind, size));
}

export function customObjectCounts(options) {
    const counts = Object.fromEntries(Object.entries(CUSTOM_OBJECT_COUNTS).map(([kind, key]) => [kind,
        options[key] === null || options[key] === undefined
            ? defaultCustomObjectCount(kind, options.size)
            : Math.min(customObjectLimit(kind, options.size), Number(options[key]))
    ]));
    if (!LODGING_KINDS.some(kind => counts[kind] > 0)) counts.tavern = 1;
    return counts;
}

export function normalizeCustomObjectCounts(options) {
    for (const [kind, key] of Object.entries(CUSTOM_OBJECT_COUNTS)) {
        if (options[key] === null || options[key] === undefined) {
            options[key] = null;
            continue;
        }
        const count = Number(options[key]);
        if (!Number.isSafeInteger(count) || count < 0) throw new Error('Количество кастомных объектов должно быть неотрицательным целым числом.');
        options[key] = Math.min(count, customObjectLimit(kind, options.size));
    }
    if (LODGING_KINDS.every(kind => options[CUSTOM_OBJECT_COUNTS[kind]] === 0)) options.tavernCount = 1;
    return options;
}
