import {parseProject as parseLegacy, serializeProject as serializeLegacy} from '../generation/generator.js';
import {cityFromGeometry, normalizeOptions} from '../generation/interactive-city.js';
import {legacyLayerVisibility} from '../generation/generation-settings.js';
import {
    BUILDING_TYPES,
    isEditing,
    refreshEditorStatistics,
    restoreEditorAppearance
} from '../editor/building-editor.js';
import {ensureEditorWater} from '../water/water-geometry.js';
import {validateEditorWater} from '../editor/water-editor.js';
import {validateStructureGeometry} from './project-geometry.js';
import {restoreEditorMarkets} from '../buildings/market-building.js';
import {ensureStreetNames, restoreStreetNames} from '../roads/street-names.js';

function validateGeometry(value, depth = 0, budget = {count: 0}) {
    if (depth > 35 || ++budget.count > 3000000) throw new Error('Слишком сложная геометрия проекта.');
    if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) throw new Error('Некорректные координаты проекта.');
    if (Array.isArray(value)) value.forEach(v => validateGeometry(v, depth + 1, budget));
    else if (value && typeof value === 'object') Object.values(value).forEach(v => validateGeometry(v, depth + 1, budget));
}

function parseEditedProject(data) {
    const city = data.city;
    if (data.version !== 1 || !isEditing(city) || city.editor?.version !== 1 || !['compatible', 'mfcg', 'legacy'].includes(city.editor.baseFormat)) throw new Error('Неизвестная версия редактируемого проекта.');
    validateGeometry(city);
    const point = p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e9);
    const polygon = p => Array.isArray(p) && p.length >= 3 && p.length <= 100000 && p.every(point);
    const region = r => r && polygon(r.polygon) && (!r.rings || Array.isArray(r.rings) && r.rings.length && r.rings.every(polygon));
    const lists = ['buildings', 'districts', 'fields', 'streets', 'walls', 'trees', 'gardens', 'bridges', 'approaches', 'gates', 'docks'];
    if (!city.terrain || !city.options || typeof city.name !== 'string' || lists.some(key => !Array.isArray(city[key])) || !city.viewBox || !['x', 'y', 'width', 'height'].every(key => typeof city.viewBox[key] === 'number' && Number.isFinite(city.viewBox[key])) || city.viewBox.width <= 0 || city.viewBox.height <= 0) throw new Error('В проекте отсутствует геометрия карты.');
    const ids = new Set();
    if (!Number.isSafeInteger(city.editor.nextId) || city.editor.nextId < 1 || city.buildings.some(b => {
        if (!region(b) || !Object.hasOwn(BUILDING_TYPES, b.kind) || typeof b.id !== 'string' || !/^building-[1-9]\d*$/.test(b.id) || Number(b.id.slice(9)) >= city.editor.nextId || ids.has(b.id) || typeof b.name !== 'string' || !Number.isInteger(b.shade) || b.shade < 0 || !b.parts || typeof b.parts !== 'object' || Object.values(b.parts).some(p => !polygon(p)) || b.layer !== undefined && !['buildings', 'fields', 'castle', 'temple', 'market'].includes(b.layer) || b.nativeStallShade !== undefined && (!Number.isSafeInteger(b.nativeStallShade) || b.nativeStallShade < 0) || b.towerPoints !== undefined && (!Array.isArray(b.towerPoints) || !b.towerPoints.every(point)) || b.detailCenter !== undefined && !point(b.detailCenter)) return true;
        ids.add(b.id);
        return false;
    }) || city.districts.some(d => !region(d) || typeof d.id !== 'string' || typeof d.name !== 'string' || !['poor', 'mixed', 'rich'].includes(d.wealth)) || city.fields.some(f => !region(f))) throw new Error('Некорректные здания или районы проекта.');
    if (city.buildings.some(b => b.nativeLandmark !== undefined && (typeof b.nativeLandmark !== 'boolean' || !['castle', 'temple'].includes(b.kind)) || b.fortification !== undefined && (city.editor.baseFormat !== 'compatible' || b.kind !== 'castle' || !region(b.fortification) || !Array.isArray(b.fortification.segments) || b.fortification.segments.length !== b.fortification.polygon.length || b.fortification.segments.some(s => typeof s !== 'boolean') || !Array.isArray(b.fortification.towers) || !b.fortification.towers.every(point) || !Array.isArray(b.fortification.gates) || !b.fortification.gates.every(point)))) throw new Error('Некорректные укрепления здания.');
    if (city.editor.quarters !== undefined && (!Array.isArray(city.editor.quarters) || city.editor.quarters.some(q => !q || typeof q.id !== 'string' || !region(q)))) throw new Error('Некорректные кварталы проекта.');
    for (const items of [city.districts, city.editor.quarters || []]) if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Повторяющиеся идентификаторы районов или кварталов.');
    if (city.editor.quarters?.some(q => q.population !== undefined && (!q.population || !Number.isFinite(q.population.houseArea) || q.population.houseArea < 0 || q.population.houseArea > 1e12 || !Number.isFinite(q.population.coverage) || q.population.coverage < .000001 || q.population.coverage > 1))) throw new Error('Некорректная плотность застройки квартала.');
    if (city.districts.some(d => d.components !== undefined && (!Array.isArray(d.components) || !d.components.length || d.components.some(c => !region(c))))) throw new Error('Некорректные части районов проекта.');
    if (city.editor.quarterEditing !== undefined) {
        const q = city.editor.quarterEditing;
        if (!q || q.version !== 1 || typeof q.dirty !== 'boolean' || !Array.isArray(city.editor.quarters) || !Array.isArray(q.catalog) || q.catalog.some(d => !d || typeof d.id !== 'string' || typeof d.name !== 'string' || !['poor', 'mixed', 'rich'].includes(d.wealth)) || new Set(q.catalog.map(d => d.id)).size !== q.catalog.length || city.editor.quarters.some(c => !q.catalog.some(d => d.id === c.district))) throw new Error('Некорректные связи кварталов и районов.');
    }
    if (city.editor.baseFormat === 'compatible' && (!Array.isArray(city.terrain.sea) || !Array.isArray(city.terrain.ribbons) || !Array.isArray(city.special) || !Array.isArray(city.treeCrowns))) throw new Error('Отсутствует ландшафт проекта.');
    if (city.editor.baseFormat === 'mfcg' && (!city.imported || ['earth', 'water', 'greens', 'special', 'squares', 'rivers', 'wallPolygons', 'planks'].some(key => !Array.isArray(city.imported[key])))) throw new Error('Отсутствует ландшафт проекта.');
    const fail = () => {
        throw new Error('Некорректная геометрия слоёв проекта.');
    };
    const pointList = p => Array.isArray(p) && p.every(point);
    const positive = n => typeof n === 'number' && Number.isFinite(n) && n > 0;
    if (city.buildings.some(b => b.marketStallShades !== undefined && (b.kind !== 'market' || !Array.isArray(b.marketStallShades) || b.marketStallShades.some(n => !Number.isSafeInteger(n) || n < 0)) || b.kind === 'market' && Object.entries(b.parts).some(([key, p]) => (key === 'fountain' || /^stall_\d+$/.test(key)) && p.length !== 4))) fail();
    if (city.markets !== undefined && (!Array.isArray(city.markets) || city.markets.some(m => !region(m) || !point(m.center) || !Array.isArray(m.stalls) || !m.stalls.every(polygon) || !positive(m.radius)))) fail();
    if (city.plaza && (!region(city.plaza) || !point(city.plaza.center) || !Array.isArray(city.plaza.stalls) || city.plaza.stalls.some(b => !region(b)))) fail();
    const line = p => pointList(p) && p.length >= 2;
    if (city.buildings.some(b => b.fortification?.gateOrigins !== undefined && (!pointList(b.fortification.gateOrigins) || b.fortification.gateOrigins.length !== b.fortification.gates.length))) throw new Error('Некорректные исходные ворота здания.');
    if (city.streets.some(r => r.originalPoints !== undefined && (!pointList(r.originalPoints) || r.originalPoints.length < 2))) throw new Error('Некорректная исходная геометрия дорог.');
    const coordinateKeys = new Set(['polygon', 'rings', 'points', 'originalPoints', 'gateOrigins', 'point', 'a', 'b', 'center', 'court', 'tower', 'keep', 'nave', 'transept', 'rails', 'ribbons', 'shoreline', 'riverPolygon', 'treeCrowns']);
    const numericKeys = new Set(['width', 'height', 'radius', 'shade', 'index', 'rows']);
    const coordinates = v => v === null || Array.isArray(v) && (point(v) || v.every(coordinates));
    const safeValues = v => {
        if (!v || typeof v !== 'object') return;
        for (const [key, value] of Object.entries(v)) {
            if (coordinateKeys.has(key) && !coordinates(value)) fail();
            if (numericKeys.has(key) && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) fail();
            if (key === 'id' && !(typeof value === 'number' || typeof value === 'string' && /^[\w.,|:-]+$/.test(value))) fail();
            if (key === 'pedestrian' && typeof value !== 'boolean') fail();
            safeValues(value);
        }
    };
    safeValues(city);
    if (!/^[\d][\w.-]*$/.test(String(city.version)) || city.streets.some(r => !r || typeof r.id !== 'string' || !(pointList(r.points) || point(r.a) && point(r.b))) || city.approaches.some(r => !r || !pointList(r.points)) || city.trees.some(t => !t || !point(t.point) || typeof t.radius !== 'number' || !Number.isInteger(t.shade) || t.shade > 3) || city.gardens.some(g => !region(g))) fail();
    if (city.editor.baseFormat === 'compatible') {
        if (!city.terrain.sea.every(polygon) || !city.terrain.ribbons.every(polygon) || !city.treeCrowns.every(p => p === null || polygon(p)) || city.walls.some(w => !region(w) || !pointList(w.towers) || !pointList(w.gates) || !Array.isArray(w.segments) || w.segments.length !== w.polygon.length || w.segments.some(s => typeof s !== 'boolean')) || city.bridges.some(b => !region(b) || !point(b.a) || !point(b.b) || !positive(b.width) || Math.hypot(b.a[0] - b.b[0], b.a[1] - b.b[1]) < 1e-7) || city.docks.some(d => !line(d?.points) || !positive(d.width) || Math.hypot(d.points[0][0] - d.points.at(-1)[0], d.points[0][1] - d.points.at(-1)[1]) < 1e-7) || city.quays !== undefined && (!Array.isArray(city.quays) || city.quays.some(q => !region(q)))) fail();
    } else if (city.editor.baseFormat === 'mfcg') {
        const i = city.imported;
        if (['earth', 'water', 'greens', 'squares'].some(key => !i[key].every(rings => Array.isArray(rings) && rings.every(polygon))) || ['rivers', 'planks'].some(key => i[key].some(r => !r || !pointList(r.points) || typeof r.width !== 'number')) || i.wallPolygons.some(w => !w || !Array.isArray(w.rings) || !w.rings.every(polygon) || typeof w.width !== 'number')) fail();
    } else if (!pointList(city.terrain.sea) || !pointList(city.terrain.riverPolygon) || !pointList(city.towers) || city.walls.some(w => !point(w.a) || !point(w.b)) || city.docks.some(d => !region(d))) fail();
    city.special = [];
    city.castle = city.temple = null;
    if (city.imported) city.imported.special = [];
    if (city.plaza) city.plaza.stalls = [];
    if (city.markets) for (const market of city.markets) market.stalls = [];
    // Edited projects carry only the current city, never a recipe presented as an exact restoration.
    city.source = {format: 'edited'};
    delete city.generatedGeometry;
    restoreEditorAppearance(city);
    restoreEditorMarkets(city);
    if (city.editor.water) validateEditorWater(city.editor.water);
    else ensureEditorWater(city);
    refreshEditorStatistics(city);
    return {city, view: data.view || {}};
}

export function serializeProject(city, view) {
    ensureStreetNames(city);
    if (isEditing(city)) return JSON.stringify({format: 'gradopisets-edited-project', version: 1, city, view}, null, 2);
    if (city.source?.format !== 'compatible') return serializeLegacy(city, view);
    return JSON.stringify({
        format: 'gradopisets-compatible-project',
        version: 1,
        namesVersion: 1,
        recipe: city.options,
        name: city.name,
        districtNames: Object.fromEntries(city.districts.map(d => [d.id, d.name])),
        streetNames: Object.fromEntries(city.streets.filter(r => r.name).map(r => [r.id, r.name])),
        castleNames: Object.fromEntries((city.special || []).filter(b => b.kind === 'castle').map(b => [b.cell, b.name])),
        geometry: city.generatedGeometry,
        referenceUrl: city.source.referenceUrl,
        view
    }, null, 2);
}

export function parseProject(text, context = {}) {
    const data = JSON.parse(text);
    if (data?.format === 'gradopisets-edited-project') return parseEditedProject(data);
    if (data?.format !== 'gradopisets-compatible-project') return parseLegacy(text, context);
    if (data.version !== 1 || typeof data.name !== 'string' || !data.geometry || !data.recipe) throw new Error('Неизвестная версия проекта.');
    validateGeometry(data.geometry);
    validateStructureGeometry(data.geometry);
    const {options} = normalizeOptions(data.recipe), city = cityFromGeometry(data.geometry, options, {
        name: data.name.slice(0, 80),
        referenceUrl: typeof data.referenceUrl === 'string' ? data.referenceUrl : undefined
    });
    if (data.namesVersion === 1) city.name = data.name.slice(0, 80);
    for (const d of city.districts) if (typeof data.districtNames?.[d.id] === 'string' && (data.namesVersion === 1 || !/^Квартал \d+$/.test(data.districtNames[d.id]))) d.name = data.districtNames[d.id].slice(0, 80);
    for (const castle of city.special.filter(b => b.kind === 'castle')) if (typeof data.castleNames?.[castle.cell] === 'string') castle.name = data.castleNames[castle.cell].slice(0, 80);
    restoreStreetNames(city, data.streetNames);
    return {city, view: legacyLayerVisibility(data.recipe, data.view)};
}
