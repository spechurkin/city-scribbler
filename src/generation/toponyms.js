import {TOPONYM_SOURCE} from '../data/russian-toponyms.js';
import {DISTRICT_TOPONYM_SOURCE} from '../data/district-toponyms.js';
import {random} from '../core/random.js';
import {bounds, centroid, inside, segmentDistance, segmentSegmentDistance} from '../core/geometry.js';

function parseLists(source) {
    const lists = {};
    let current;
    for (const line of source.split(/\r?\n/)) {
        if (!line.trim() || line.trimStart().startsWith('//') || line.includes(' = ')) continue;
        if (/^\w+$/.test(line)) {
            current = line;
            lists[current] = [];
            continue;
        }
        if (!current || current === 'output') continue;
        const match = line.trim().match(/^(.*?)(?:\s+\^(\d+))?$/);
        lists[current].push({text: match[1], weight: Number(match[2] || 1)});
    }
    return lists;
}

const lists = {...parseLists(TOPONYM_SOURCE), ...parseLists(DISTRICT_TOPONYM_SOURCE)};
const types = {
    city: 'cityName',
    ust: 'ustCityName',
    coast: 'coastCityName',
    town: 'townName',
    selo: 'seloName',
    village: 'villageName',
    poselok: 'poselokName',
    stanitsa: 'stanitsaName',
    sloboda: 'slobodaName',
    khutor: 'khutorName',
    fortress: 'fortressName',
    any: 'anyName',
    experimental: 'experimentalName'
};
const marine = /морск|моряк|примор|помор|мурман|балтий|гаван|порт|бухт|пролив|риф|шторм|парус|якор|кораб|маяк|чаек/i;
const freshwater = /реч|волг|амур|енисей|ангар|иркут|северодвин|^Том$|^Усть-|^Верх-|^Нижне-/i;
const lakes = /оз[её]р/i;

function allowed(entry, terrain) {
    if (!terrain) return true;
    if (Object.hasOwn(terrain, 'kind') && !districtNameFitsOccupation(entry.text, terrain)) return false;
    if (lakes.test(entry.text)) return false;
    if (!terrain.coast && (marine.test(entry.text) || /\[coast\w+\]/.test(entry.text))) return false;
    if (!terrain.river && (freshwater.test(entry.text) || /\[(?:cityHydro|ust\w+|river\w+)\]/.test(entry.text))) return false;
    return true;
}

function grammar(rng, terrain) {
    const expand = (template, depth = 0) => template.replace(/\[(\w+)(?:\.(lowerCase|titleCase))?\]/g, (_, key, transform) => {
        if (depth > 24 || !lists[key]) throw new Error(`Неизвестное или рекурсивное правило топонима: ${key}`);
        const candidates = lists[key].filter(entry => allowed(entry, terrain));
        if (!candidates.length) throw new Error(`Нет подходящих вариантов топонима: ${key}`);
        let roll = rng() * candidates.reduce((sum, entry) => sum + entry.weight, 0);
        const selected = candidates.find(entry => (roll -= entry.weight) < 0) || candidates.at(-1);
        const value = expand(selected.text, depth + 1);
        return transform === 'lowerCase' ? value.toLocaleLowerCase('ru') : transform === 'titleCase' ? value.replace(/(^|[\s-])\p{L}/gu, c => c.toLocaleUpperCase('ru')) : value;
    });
    return expand;
}

export function generateToponym(seed, {type = 'city', terrain = null, channel = 'toponym'} = {}) {
    if (!Object.hasOwn(types, type)) throw new Error(`Неизвестный тип топонима: ${type}`);
    return grammar(random(seed, channel), terrain)(`[${types[type]}]`);
}

const settlementSizes = [
    {type: 'city', population: 10000, size: 60},
    {type: 'town', population: 2000, size: 34},
    {type: 'poselok', population: 1000, size: 24},
    {type: 'selo', population: 500, size: 16},
    {type: 'village', population: 100, size: 10},
    {type: 'khutor', population: 0, size: 0}
];

export function settlementType({population = null, size = 60} = {}) {
    const metric = population === null ? 'size' : 'population';
    const value = population === null ? size : population;
    return settlementSizes.find(level => value >= level[metric]).type;
}

export function generateCityName(seed, terrain) {
    const settlement = settlementType(terrain);
    const type = settlement === 'city' && terrain.coast ? (terrain.river ? 'ust' : 'coast') : settlement;
    return generateToponym(seed, {type, terrain, channel: 'city-name'});
}

function boundaryDistance(rings, path, closed = false) {
    if (path.length < 2) return Infinity;
    let minimum = Infinity;
    for (const ring of rings) for (let i = 0; i < ring.length; i++) for (let j = 0; j < path.length - (closed ? 0 : 1); j++) {
        minimum = Math.min(minimum, segmentSegmentDistance(ring[i], ring[(i + 1) % ring.length], path[j], path[(j + 1) % path.length]));
        if (minimum < 1e-4) return minimum;
    }
    return minimum;
}

const seaDistrictNames = /мор(?!оз)|мурман|балтий|пролив|риф|шторм/i;
const localFreshwaterNames = /родник|ключ|пруд|болот|(?:^|[\s-])томск(?:$|[\s-])/i;
const waterfrontDistrictNames = /рыб|береж|берег|прибреж|пристан|гаван|порт|бухт|залив|остров|завод[ьи]|парус|якор|кораб|мая[кч]|ча[йе]к|брод|мост|камыш|волн|(?:^|[\s-])мыс|(?:^|[\s-])коса(?:$|[\s-])/i;

export function districtNameFitsWater(name, {coast = false, river = false}) {
    if (lakes.test(name)) return false;
    if (seaDistrictNames.test(name) && !coast) return false;
    if ((freshwater.test(name) || localFreshwaterNames.test(name)) && !river) return false;
    return !waterfrontDistrictNames.test(name) || coast || river;
}

const outdoorOccupations = /рудокоп|рудн|рудозавод|шахт[её]р|шахтн|лесоруб|лесозавод|уголь|прииск|стрельц|стрелец|ямщик|ямск|солдат|пушкар|охотни|пастух|землепаш/i;

export function districtNameFitsOccupation(name, {landEdge = false, kind} = {}) {
    return !outdoorOccupations.test(name) || landEdge || kind === 'outskirts';
}

function landFrontier(geometry) {
    const edges = new Map(), key = (a, b) => [a.join(','), b.join(',')].sort().join(';');
    for (const cell of geometry.cells || []) for (let i = 0; i < cell.polygon.length; i++) {
        const a = cell.polygon[i], b = cell.polygon[(i + 1) % cell.polygon.length], id = key(a, b);
        if (!edges.has(id)) edges.set(id, {points: [a, b], cells: []});
        edges.get(id).cells.push(cell);
    }
    // Castle walls do not provide access to the countryside.
    const wall = geometry.recipe?.walls === false ? null : geometry.walls?.find(w =>
        !(geometry.cells || []).some(c => c.ward === 'castle' && c.polygon.length === w.polygon.length && c.polygon.every(p => w.polygon.some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-4))));
    if (wall) return wall.polygon.flatMap((a, i) => {
        const b = wall.polygon[(i + 1) % wall.polygon.length], cells = edges.get(key(a, b))?.cells || [];
        return wall.segments?.[i] !== false && cells.length === 2 && cells.every(c => !c.water) ? [[a, b]] : [];
    });
    return [...edges.values()].filter(({cells}) => cells.some(c => c.urban) && cells.some(c => !c.urban && !c.water) && cells.every(c => !c.water)).map(e => e.points);
}

function sharesFrontier(rings, frontier) {
    return rings.some(ring => ring.some((a, i) => {
        const b = ring[(i + 1) % ring.length], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length < 1e-4) return false;
        return frontier.some(([c, d]) => {
            // A shared corner alone does not make a district peripheral.
            if (segmentDistance(c, a, b) > 1e-4 && segmentDistance(a, c, d) > 1e-4) return false;
            const project = p => ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / length;
            const cross = p => Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / length;
            return cross(c) < 1e-4 && cross(d) < 1e-4 && Math.min(length, Math.max(project(c), project(d))) - Math.max(0, Math.min(project(c), project(d))) > 1e-4;
        });
    }));
}

export function districtNameContexts(geometry) {
    const detail = geometry.experimental, regions = detail.districtRegions || detail.districts;
    const frontier = landFrontier(geometry);
    const urban = geometry.cells?.filter(cell => cell.urban).flatMap(cell => cell.polygon);
    const [x0, y0, x1, y1] = bounds(urban?.length ? urban : regions.flatMap(d => d.polygon));
    return regions.map(d => {
        const [x, y] = centroid(d.polygon), directions = [];
        const radius = x1 > x0 && y1 > y0 ? Math.hypot((2 * x - x0 - x1) / (x1 - x0), (2 * y - y0 - y1) / (y1 - y0)) : null;
        const proximity = radius === null ? null : radius <= 1 / 3 ? 'near' : radius >= 2 / 3 ? 'far' : null;
        // Geometry uses north-positive Y; the display flips Y for SVG coordinates.
        if (y1 > y0) {
            if (y > y0 + (y1 - y0) * 2 / 3) directions.push('north');
            if (y < y0 + (y1 - y0) / 3) directions.push('south');
        }
        if (x1 > x0) {
            if (x > x0 + (x1 - x0) * 2 / 3) directions.push('east');
            if (x < x0 + (x1 - x0) / 3) directions.push('west');
        }
        const rings = d.rings || [d.polygon];
        const coast = boundaryDistance(rings, geometry.water, true) < 1e-4;
        const river = geometry.rivers.some((path, i) => boundaryDistance(rings, path) <= (geometry.riverWidths?.[i] || 0) / 2 + 1e-4);
        const contains = p => inside(p, d.polygon) && !(d.rings || []).slice(1).some(hole => inside(p, hole));
        const sites = detail.districtLandmarks?.sites.filter(site => site.district === String(d.id));
        const market = sites ? sites.some(site => site.kind === 'market') : (detail.squares || []).some(p => contains(centroid(p)));
        const temple = sites ? sites.some(site => site.kind === 'temple') : detail.specialBuildings.some(b => b.kind === 'temple' && contains(centroid(b.polygon)));
        const castle = detail.specialBuildings.some(b => b.kind === 'castle' && contains(centroid(b.polygon)));
        return {
            id: String(d.id),
            kind: market && temple ? 'market-temple' : temple ? 'temple' : market ? 'market' : castle ? 'castle' : d.type,
            coast,
            river,
            landEdge: sharesFrontier(rings, frontier),
            directions,
            proximity
        };
    });
}

function districtTemplate(d, rng) {
    if (d.kind === 'market-temple') return rng() < .5 ? '[religiousSelo] торжище' : '[religiousSelo] торжище [slobodaGenitive]';
    if (d.kind === 'market') return '[marketDistrictName]';
    if (d.kind === 'temple') return rng() < .5 ? '[religiousSelo]' : '[religiousSelo] подворье [slobodaGenitive]';
    if (d.kind === 'park') return '[coastBayAdjective] роща';
    if (d.coast) return rng() < .25 ? 'Слобода [slobodaGenitive]' : '[coastBayName]';
    if (d.river) {
        const roll = rng();
        return roll < .25 ? 'Слобода [slobodaGenitive]' : roll < .625 ? '[coastBayAdjective] набережная' : '[coastShoreAdjective] берег';
    }
    if (d.kind === 'center') return 'Слобода [slobodaGenitive]';
    const roll = rng();
    return roll < .5 ? '[slobodaName]' : roll < .625 ? '[poselokAdj] район' : roll < .75 ? '[khutorAdj] район' : roll < .95 ? '[slobodaAdj] слобода [slobodaGenitive]' : '[marketDistrictName]';
}

const directionStems = [['north', /север/i], ['south', /южн/i], ['east', /восточ/i], ['west', /запад/i]];

function completeDistrictName(name) {
    if (!/^(?:верхн|нижн|ближн|дальн)(?:ий|яя|ее|ие)$/i.test(name)) return name;
    const noun = /ий$/i.test(name) ? 'район' : /яя$/i.test(name) ? 'слобода' : /ее$/i.test(name) ? 'предместье' : 'дворы';
    return `${name} ${noun}`;
}

function suitsDistrictPosition(name, {directions = [], proximity = null}) {
    if (/высок|низк/i.test(name)) return false;
    if (/верхн/i.test(name) && !directions.includes('north')) return false;
    if (/нижн/i.test(name) && !directions.includes('south')) return false;
    if (/ближн/i.test(name) && proximity !== 'near') return false;
    if (/дальн/i.test(name) && proximity !== 'far') return false;
    return directionStems.every(([direction, stem]) => !stem.test(name) || directions.includes(direction));
}

function generateNames(seed, districts, channel, template) {
    const used = new Set(), names = {};
    for (const d of [...districts].sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'))) {
        const rng = random(seed, `${channel}:${d.id}`), expand = grammar(rng, d);
        let name;
        for (let attempt = 0; attempt < 128; attempt++) {
            name = completeDistrictName(expand(template(d, rng)));
            if (!used.has(name) && suitsDistrictPosition(name, d) && districtNameFitsWater(name, d) && districtNameFitsOccupation(name, d)) break;
            name = null;
        }
        if (!name) throw new Error('Не удалось подобрать разные названия районов.');
        used.add(name);
        names[d.id] = name;
    }
    return names;
}

export function generateDistrictNames(seed, districts) {
    return generateNames(seed, districts, 'district-name', districtTemplate);
}

export function generateCastleNames(seed, castles) {
    return generateNames(seed, castles, 'castle-name', () => '[fortressName]');
}
