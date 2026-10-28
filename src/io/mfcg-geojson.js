import {area, bounds, centroid, inside} from '../core/geometry.js';
import {assignDistrictWealth} from '../districts/district-wealth.js';

const MAX_POINTS = 1000000;
const coordinateDepth = {Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3};
const expectedLayers = {
    earth: 'Polygon',
    roads: 'GeometryCollection',
    walls: 'GeometryCollection',
    rivers: 'GeometryCollection',
    planks: 'GeometryCollection',
    buildings: 'MultiPolygon',
    prisms: 'MultiPolygon',
    squares: 'MultiPolygon',
    greens: 'MultiPolygon',
    fields: 'MultiPolygon',
    trees: 'MultiPoint',
    districts: 'GeometryCollection',
    water: 'MultiPolygon'
};

export function validateMfcgGeoJson(value) {
    if (!value || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) throw new Error('Ожидается FeatureCollection экспорта MFCG.');
    const metadata = value.features.find(f => f?.id === 'values');
    if (metadata?.generator !== 'mfcg') throw new Error('В файле не указан генератор MFCG.');
    let points = 0;

    function coordinates(v, depth) {
        if (depth === 0) {
            if (!Array.isArray(v) || v.length !== 2 || !v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e9)) throw new Error('Некорректные координаты MFCG.');
            if (++points > MAX_POINTS) throw new Error('В файле слишком много точек.');
            return;
        }
        if (!Array.isArray(v)) throw new Error('Некорректная вложенность координат MFCG.');
        for (const child of v) coordinates(child, depth - 1);
    }

    function geometry(g, depth = 0) {
        if (!g || depth > 8) throw new Error('Некорректная геометрия MFCG.');
        if (g.type === 'GeometryCollection') {
            if (!Array.isArray(g.geometries)) throw new Error('В GeometryCollection отсутствует список геометрий.');
            for (const child of g.geometries) geometry(child, depth + 1);
        } else if (Object.hasOwn(coordinateDepth, g.type)) coordinates(g.coordinates, coordinateDepth[g.type]);
        else throw new Error(`Неподдерживаемая геометрия ${String(g.type)}.`);
        if (g.width !== undefined && (typeof g.width !== 'number' || !Number.isFinite(g.width) || g.width < 0 || g.width > 10000)) throw new Error('Некорректная ширина линии MFCG.');
    }

    const ids = new Set();
    for (const feature of value.features) {
        if (!feature || typeof feature.id !== 'string' || ids.has(feature.id)) throw new Error('Слои MFCG должны иметь уникальные идентификаторы.');
        ids.add(feature.id);
        if (feature === metadata) continue;
        if (!Object.hasOwn(expectedLayers, feature.id)) throw new Error(`Слой ${feature.id} пока не поддерживается импортом MFCG.`);
        if (expectedLayers[feature.id] && feature.type !== expectedLayers[feature.id]) throw new Error(`Некорректный тип слоя ${feature.id}.`);
        geometry(feature);
        const childType = {
            roads: 'LineString',
            rivers: 'LineString',
            planks: 'LineString',
            walls: 'Polygon',
            districts: 'Polygon'
        }[feature.id];
        if (childType && feature.geometries.some(g => g.type !== childType)) throw new Error(`Некорректная геометрия внутри слоя ${feature.id}.`);
    }
    if (!ids.has('buildings')) throw new Error('В экспорте MFCG отсутствует слой buildings.');
    for (const key of ['roadWidth', 'towerRadius', 'wallThickness', 'riverWidth']) {
        if (metadata[key] !== undefined && (typeof metadata[key] !== 'number' || !Number.isFinite(metadata[key]) || metadata[key] < 0 || metadata[key] > 10000)) throw new Error(`Некорректный параметр ${key}.`);
    }
    return {metadata, points};
}

const flipPoint = p => [p[0], -p[1]];
const flipRing = ring => ring.map(flipPoint);

function polygons(feature) {
    return feature?.type === 'MultiPolygon' ? feature.coordinates.map(p => p.map(flipRing)) : feature?.type === 'Polygon' ? [feature.coordinates.map(flipRing)] : [];
}

function importedRecipe(metadata, provided, reference) {
    const validSeed = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
    const seed = [metadata.seed, provided.seed, reference?.seed].find(validSeed);
    const values = {
        ...(seed === undefined ? {} : {
            ...reference?.flags, ...reference?.optional,
            size: reference?.size, ...provided
        }), ...metadata
    };
    for (const [old, native] of [['castle', 'citadel'], ['urbanCastle', 'urban_castle'], ['market', 'plaza'], ['gardens', 'greens'], ['shanty', 'shantytown']]) if (values[native] === undefined && values[old] !== undefined) values[native] = values[old];
    const options = {seed: seed === undefined ? null : String(seed), size: null, population: null};
    for (const key of ['size', 'population', 'gates']) {
        const value = values[key];
        if (value !== null && value !== undefined && value !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= (key === 'gates' ? -1 : key === 'size' ? 1 : 0)) options[key] = Number(value);
    }
    for (const key of ['citadel', 'urban_castle', 'plaza', 'temple', 'walls', 'shantytown', 'river', 'coast', 'greens', 'hub']) {
        const value = values[key];
        if (typeof value === 'boolean') options[key] = value;
        else if (value === 0 || value === 1 || value === '0' || value === '1') options[key] = Number(value) !== 0;
    }
    if (typeof values.sea === 'number' && Number.isFinite(values.sea)) options.sea = values.sea;
    return options;
}

export function importMfcgGeoJson(data, {name = 'Импортированный город', options = {}, reference = null} = {}) {
    const {metadata} = validateMfcgGeoJson(data), byId = new Map(data.features.map(f => [f.id, f]));
    const districts = (byId.get('districts')?.geometries || []).map((g, i) => {
        if (g.type !== 'Polygon' || !g.coordinates[0]?.length) throw new Error('Район MFCG должен содержать полигон.');
        const rings = g.coordinates.map(flipRing);
        return {
            id: `district-${i}`,
            polygon: rings[0],
            rings,
            center: centroid(rings[0]),
            kind: 'imported',
            name: typeof g.name === 'string' ? g.name : `Район ${i + 1}`,
            shade: i % 6
        };
    });
    const buildings = polygons(byId.get('buildings')).filter(p => p[0]?.length >= 3).map((rings, i) => {
        const point = centroid(rings[0]);
        return {
            id: `imported-building-${i}`,
            polygon: rings[0],
            rings,
            district: districts.find(d => inside(point, d.polygon) && !d.rings.slice(1).some(hole => inside(point, hole)))?.id || null,
            kind: 'imported',
            shade: i % 5
        };
    });
    const roads = (byId.get('roads')?.geometries || []).map((g, i) => {
        if (g.type !== 'LineString' || g.coordinates.length < 2) throw new Error('Дорога MFCG должна содержать полилинию.');
        const points = g.coordinates.map(flipPoint);
        return {
            id: `imported-road-${i}`,
            points,
            a: points[0],
            b: points.at(-1),
            width: g.width ?? metadata.roadWidth ?? 8
        };
    });
    const rivers = (byId.get('rivers')?.geometries || []).map((g, i) => ({
        id: `imported-river-${i}`,
        points: g.coordinates.map(flipPoint),
        width: g.width ?? metadata.riverWidth ?? 30
    }));
    const wallPolygons = (byId.get('walls')?.geometries || []).map((g, i) => ({
        id: `imported-wall-${i}`,
        rings: g.coordinates.map(flipRing),
        width: g.width ?? metadata.wallThickness ?? 7.6
    }));
    const water = polygons(byId.get('water')), earth = polygons(byId.get('earth')),
        greens = polygons(byId.get('greens')), special = polygons(byId.get('prisms')),
        squares = polygons(byId.get('squares'));
    const planks = (byId.get('planks')?.geometries || []).map((g, i) => ({
        id: `imported-plank-${i}`,
        points: g.coordinates.map(flipPoint),
        width: g.width ?? 4.8
    }));
    const fields = polygons(byId.get('fields')).map((rings, i) => ({
        id: `imported-field-${i}`,
        polygon: rings[0],
        rings,
        center: centroid(rings[0])
    }));
    const trees = (byId.get('trees')?.coordinates || []).map(p => ({
        point: flipPoint(p),
        radius: 3.5,
        kind: 'broadleaf',
        shade: 1
    }));
    const core = districts.length ? districts.flatMap(d => d.polygon) : buildings.flatMap(b => b.polygon);
    if (!core.length) throw new Error('Экспорт MFCG не содержит отображаемой геометрии.');
    const bb = bounds(core), cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    const width = Math.max(bb[2] - bb[0], (bb[3] - bb[1]) * 4 / 3, 100) * 1.3, height = width * .75;
    const viewBox = {x: cx - width / 2, y: cy - height / 2, width, height};
    const nameText = String(name).replace(/\.json$/i, '').slice(0, 80) || 'Импортированный город';
    return assignDistrictWealth({
        version: 1,
        name: nameText,
        width: 1600,
        height: 1200,
        center: [cx, cy],
        radius: Math.max(bb[2] - bb[0], bb[3] - bb[1]) / 2,
        viewBox,
        options: importedRecipe(metadata, options, reference),
        source: {format: 'mfcg', version: metadata.version || null, geojson: structuredClone(data), reference},
        imported: {earth, water, greens, special, squares, rivers, wallPolygons, planks},
        terrain: {
            kind: water.length ? (rivers.length ? 'estuary' : 'coast') : (rivers.length ? 'river' : 'inland'),
            coast: water.length > 0,
            river: rivers.length > 0
        },
        districts,
        buildings,
        streets: roads,
        fields,
        trees,
        gardens: [],
        bridges: [],
        approaches: [],
        gates: [],
        walls: wallPolygons,
        towers: [],
        plaza: null,
        castle: null,
        temple: null,
        docks: planks,
        routes: [],
        statistics: {
            buildings: buildings.length,
            special: special.length,
            districts: districts.length,
            bridges: null,
            trees: trees.length,
            area: Math.round(districts.reduce((s, d) => s + area(d.polygon), 0) / 100) / 100
        }
    });
}

export function geometryFingerprint(city) {
    if (city.source?.format !== 'mfcg') throw new Error('Ожидается импортированная геометрия MFCG.');
    return JSON.stringify(city.source.geojson.features.filter(f => f.id !== 'values'));
}

export function exportMfcgGeoJson(city) {
    if (city.source?.format !== 'mfcg') throw new Error('Карта не была импортирована из MFCG.');
    const data = structuredClone(city.source.geojson);
    const districts = data.features.find(f => f.id === 'districts')?.geometries || [];
    for (let i = 0; i < districts.length; i++) if (city.districts[i]) districts[i].name = city.districts[i].name;
    return data;
}
