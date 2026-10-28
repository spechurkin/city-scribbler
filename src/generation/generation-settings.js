import {
    DEFAULT_OPTIONS,
    EXTRA_WATER_OPTIONS,
    isReferenceInput,
    LEGACY_OPTION_ALIASES,
    normalizeOptions
} from './interactive-city.js';
import {LANDMARK_COUNTS, landmarkLimit} from '../districts/district-landmarks.js';
import {
    CUSTOM_COUNT_DEFAULTS,
    CUSTOM_OBJECT_COUNTS,
    customObjectCounts,
    customObjectLimit,
    LODGING_KINDS
} from '../buildings/custom-object-settings.js';

const numericKeys = Object.keys(DEFAULT_OPTIONS).filter(key => typeof DEFAULT_OPTIONS[key] === 'number');
const flagKeys = Object.keys(DEFAULT_OPTIONS).filter(key => typeof DEFAULT_OPTIONS[key] === 'boolean');
const control = (form, key) => form.elements.namedItem(key);

export function readGenerationForm(form, reference = null, overrides = {}) {
    const input = {seed: control(form, 'seed').value.trim()};
    for (const key of numericKeys) input[key] = Number(control(form, key).value);
    for (const key of flagKeys) input[key] = control(form, key).checked;
    input.population = control(form, 'population').value;
    for (const key of Object.values(CUSTOM_OBJECT_COUNTS)) {
        const field = control(form, key);
        input[key] = field.dataset?.auto === 'true' ? null : Number(field.value);
    }
    Object.assign(input, overrides);
    const parsed = normalizeOptions(input);
    const source = parsed.source || (reference?.seed === parsed.options.seed ? reference : null);
    return {...parsed.options, ...(source ? {name: source.name, referenceUrl: source.url} : {})};
}

export function writeGenerationForm(form, options) {
    for (const key of Object.keys(LANDMARK_COUNTS)) control(form, key).max = String(landmarkLimit(options.size));
    for (const key of Object.keys(DEFAULT_OPTIONS)) {
        const field = control(form, key);
        if (Object.hasOwn(CUSTOM_COUNT_DEFAULTS, key)) continue;
        if (typeof DEFAULT_OPTIONS[key] === 'boolean') field.checked = options[key];
        else field.value = options[key] === null ? '' : String(options[key]);
    }
    const counts = customObjectCounts(options);
    for (const [kind, key] of Object.entries(CUSTOM_OBJECT_COUNTS)) {
        const field = control(form, key);
        field.dataset ||= {};
        field.dataset.auto = String(options[key] === null || options[key] === undefined);
        field.max = String(customObjectLimit(kind, options.size));
        field.value = String(counts[kind]);
    }
}

export function syncCustomObjectControls(form, {reset = false} = {}) {
    const size = Math.max(6, Math.min(200, Number(control(form, 'size').value) || DEFAULT_OPTIONS.size));
    const options = {size};
    for (const [kind, key] of Object.entries(CUSTOM_OBJECT_COUNTS)) {
        const field = control(form, key);
        field.dataset ||= {};
        if (reset) field.dataset.auto = 'true';
        options[key] = field.dataset.auto === 'true' ? null : Math.min(customObjectLimit(kind, size), Math.max(0, Number(field.value) || 0));
    }
    if (LODGING_KINDS.every(kind => options[CUSTOM_OBJECT_COUNTS[kind]] === 0)) options.tavernCount = 1;
    const counts = customObjectCounts(options);
    for (const [kind, key] of Object.entries(CUSTOM_OBJECT_COUNTS)) {
        const field = control(form, key);
        field.max = String(customObjectLimit(kind, size));
        field.value = String(counts[kind]);
    }
    return counts;
}

export function syncLandmarkControls(form) {
    const max = landmarkLimit(control(form, 'size').value || DEFAULT_OPTIONS.size);
    for (const [key, flag] of Object.entries(LANDMARK_COUNTS)) {
        const field = control(form, key);
        field.max = String(max);
        field.value = String(Math.min(max, Math.max(0, Number(field.value))));
        field.disabled = !control(form, flag).checked;
    }
    return max;
}

function parametersFromLocation(location) {
    const hash = location.hash.replace(/^#/, '');
    if (isReferenceInput(hash)) return {seed: hash};
    const fragment = new URLSearchParams(hash), query = new URLSearchParams(location.search);
    const params = fragment.has('seed') ? fragment : query;
    const values = {};
    for (const [key, value] of params) {
        if (Object.hasOwn(DEFAULT_OPTIONS, key)) values[key] = typeof DEFAULT_OPTIONS[key] === 'boolean' ? (Number.isNaN(Number.parseInt(value)) || Number.parseInt(value) !== 0) : value;
        else if (Object.hasOwn(LEGACY_OPTION_ALIASES, key)) values[key] = value === '1' || value === 'true';
        else if (['port', 'fields', 'forest'].includes(key)) values[key] = value === '1' || value === 'true';
    }
    for (const key of ['name', 'geography', 'referenceUrl']) if (params.has(key)) values[key] = params.get(key);
    return values;
}

export function readGenerationLocation(location) {
    const values = parametersFromLocation(location), parsed = normalizeOptions(values);
    return {
        options: {...parsed.options, ...(parsed.name ? {name: parsed.name} : {}), ...(parsed.source || values.referenceUrl ? {referenceUrl: parsed.source?.url || values.referenceUrl} : {})},
        name: parsed.name,
        view: legacyLayerVisibility(values)
    };
}

export function legacyLayerVisibility(recipe, view = {}) {
    return {
        ...view,
        layers: {...view.layers, ...Object.fromEntries(['port', 'fields', 'forest'].filter(key => recipe[key] === false).map(key => [key, false]))}
    };
}

export function generationHash(city) {
    const params = new URLSearchParams();
    for (const key of Object.keys(DEFAULT_OPTIONS)) {
        const value = city.options[key];
        if (value === null || value === undefined || Object.hasOwn(EXTRA_WATER_OPTIONS, key) && value === EXTRA_WATER_OPTIONS[key]) continue;
        params.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
    }
    params.set('name', city.name);
    if (city.source?.referenceUrl) params.set('referenceUrl', city.source.referenceUrl);
    return `#${params}`;
}

export function mfcgReferenceUrl(city) {
    const {options} = normalizeOptions(city.options), url = new URL('https://watabou.github.io/city-generator/');
    for (const key of Object.keys(DEFAULT_OPTIONS)) {
        if (Object.hasOwn(EXTRA_WATER_OPTIONS, key) || Object.hasOwn(LANDMARK_COUNTS, key) || Object.hasOwn(CUSTOM_COUNT_DEFAULTS, key) || options[key] === null) continue;
        url.searchParams.set(key, typeof options[key] === 'boolean' ? (options[key] ? '1' : '0') : String(options[key]));
    }
    url.searchParams.set('name', city.name);
    return url.href;
}
