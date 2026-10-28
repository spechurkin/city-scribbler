import {generateCity as generateModel} from '../compatible/city.js';
import {structureGeometry, structureOptions} from '../compatible/structure.js';
import {COMPATIBLE_DEFAULTS} from '../compatible/terrain.js';
import {parseMfcgReference} from '../io/mfcg-reference.js';
import {bounds, centroid, distance, inset, inside, segmentDistance} from '../core/geometry.js';
import {anchorPiersToBanks, buildBridgeNetwork, dryFootprint} from '../roads/bridge-network.js';
import {fitsFootprint, footprintFrame, MIN_FOOTPRINT_SIZE} from '../buildings/footprint-size.js';
import {buildDistrictRegions} from '../districts/district-regions.js';
import {assignDistrictWealth} from '../districts/district-wealth.js';
import {districtNameContexts, generateCastleNames, generateCityName, generateDistrictNames} from './toponyms.js';
import {buildDistrictLandmarks, LANDMARK_COUNTS, landmarkLimit} from '../districts/district-landmarks.js';
import {connectedStreets} from '../roads/street-network.js';
import {polygonBoolean} from '../compatible/polygons.js';
import {mapDistricts} from '../map/map-selection.js';
import {attachCustomObjects, buildCustomObjects} from '../buildings/custom-objects.js';
import {CUSTOM_COUNT_DEFAULTS, normalizeCustomObjectCounts} from '../buildings/custom-object-settings.js';
import {additionalPorts, inhabitedBank} from '../water/ports.js';

export const LEGACY_OPTION_ALIASES = Object.freeze({
    castle: 'citadel',
    urbanCastle: 'urban_castle',
    market: 'plaza',
    shanty: 'shantytown',
    gardens: 'greens'
});
export const EXTRA_WATER_OPTIONS = Object.freeze({coastOffset: 0, riverWidthScale: 1, riverCurvature: 1});
export const DEFAULT_OPTIONS = Object.freeze({
    seed: '1931200012',
    size: 34,
    population: null,
    citadel: true,
    urban_castle: true,
    plaza: true,
    temple: true,
    marketCount: 1,
    templeCount: 1,
    walls: true,
    shantytown: false,
    river: true,
    coast: true,
    greens: false,
    hub: false,
    gates: -1,
    sea: 0, ...EXTRA_WATER_OPTIONS, ...CUSTOM_COUNT_DEFAULTS
});
const numeric = ['size', 'gates', 'sea', 'coastOffset', 'riverWidthScale', 'riverCurvature'];
const presets = {village: 16, town: 34, city: 60, capital: 92};
export const isReferenceInput = value => /^(?:https?:\/\/|watabou\.github\.io\/city-generator)/i.test(String(value).trim());

export function normalizeOptions(input = {}) {
    let source = null, values = {...input};
    if (isReferenceInput(values.seed)) {
        const link = String(values.seed).trim();
        source = parseMfcgReference(/^https?:\/\//i.test(link) ? link : `https://${link}`);
        const native = {...COMPATIBLE_DEFAULTS, ...source.flags, ...source.optional};
        values = {...values, ...native, seed: source.seed, size: source.size, name: source.name};
        // A reference starts at neutral custom settings; sliders can then alter it explicitly.
        Object.assign(values, EXTRA_WATER_OPTIONS);
        for (const key of Object.keys(LANDMARK_COUNTS)) values[key] = DEFAULT_OPTIONS[key];
        Object.assign(values, CUSTOM_COUNT_DEFAULTS);
    }
    for (const [old, native] of Object.entries(LEGACY_OPTION_ALIASES)) if (Object.hasOwn(values, old) && !Object.hasOwn(values, native)) values[native] = values[old];
    const options = {...DEFAULT_OPTIONS, ...Object.fromEntries(Object.keys(DEFAULT_OPTIONS).filter(k => Object.hasOwn(values, k)).map(k => [k, values[k]]))};
    if (values.geography && values.geography !== 'auto' && !Object.hasOwn(values, 'coast')) {
        options.coast = ['coast', 'estuary'].includes(values.geography);
        options.river = ['river', 'estuary'].includes(values.geography);
    }
    options.size = Object.hasOwn(presets, options.size) ? presets[options.size] : options.size;
    for (const key of numeric) options[key] = Number(options[key]);
    options.population = options.population === null || options.population === '' ? null : Number(options.population);
    if (options.population !== null && (!Number.isSafeInteger(options.population) || options.population < 0)) throw new Error('Население должно быть неотрицательным целым числом.');
    options.seed = String(options.seed).trim();
    if (!/^\d+$/.test(options.seed) || !Number.isSafeInteger(Number(options.seed)) || Number(options.seed) <= 0) throw new Error('Нужен положительный числовой сид до 9007199254740991 или полная ссылка MFCG.');
    for (const [key, value] of Object.entries(DEFAULT_OPTIONS)) if (typeof value === 'boolean' && typeof options[key] !== 'boolean') throw new Error(`Некорректный переключатель ${key}.`);
    structureOptions(options);
    for (const [key, flag] of Object.entries(LANDMARK_COUNTS)) {
        const count = Number(options[key]);
        if (!Number.isSafeInteger(count) || count < 0) throw new Error('Количество рынков и храмов должно быть неотрицательным целым числом.');
        options[key] = options[flag] ? Math.min(count, landmarkLimit(options.size)) : 0;
    }
    normalizeCustomObjectCounts(options);
    return {options, source, name: values.name};
}

export function recipeFromOptions(o) {
    return {
        seed: Number(o.seed),
        size: o.size, ...(o.population === null ? {} : {population: o.population}),
        citadel: o.citadel,
        urban_castle: o.urban_castle,
        plaza: o.plaza,
        temple: o.temple,
        walls: o.walls,
        shantytown: o.shantytown,
        coast: o.coast,
        river: o.river,
        greens: o.greens,
        hub: o.hub,
        gates: o.gates,
        sea: o.sea, ...Object.fromEntries(Object.keys(EXTRA_WATER_OPTIONS).map(key => [key, o[key]])),
        housingDensity: 1
    };
}

const point = ([x, y]) => [x, -y], polygon = p => p.map(point);

export function cityFromGeometry(g, options, {name, referenceUrl} = {}) {
    const e = g.experimental;
    if (g.format !== 'gradopisets-structure' || !e) throw new Error('В проекте нет геометрии нового движка.');
    const districtNames = generateDistrictNames(options.seed, districtNameContexts(g));
    const generatedName = generateCityName(options.seed, options);
    const castleContexts = districtNameContexts({
        ...g, experimental: {
            ...e,
            districtRegions: e.specialBuildings.filter(b => b.kind === 'castle').map(b => ({
                id: String(b.cell), type: 'castle', polygon: b.polygon
            }))
        }
    });
    const castleNames = generateCastleNames(options.seed, castleContexts);
    const sites = e.districtLandmarks?.sites;
    const castleCells = g.cells.filter(c => c.ward === 'castle');
    const castleWalls = new Set(g.walls.filter(w => castleCells.some(c => c.polygon.length === w.polygon.length && c.polygon.every(p => w.polygon.some(q => distance(p, q) < 1e-6)))));
    const allowStreetTerminal = value => {
        const p = point(value);
        for (const wall of castleWalls) {
            if (wall.gates.some(g => distance(p, g) < 1e-6)) continue;
            if (wall.polygon.some((a, i) => wall.segments[i] && segmentDistance(p, a, wall.polygon[(i + 1) % wall.polygon.length]) < 1e-6)) return false;
        }
        return true;
    };
    const replaced = new Set(sites?.flatMap(site => site.housing) || []);
    const districts = (e.districtRegions || e.districts).map((d, i) => ({
        id: String(d.id),
        polygon: polygon(d.polygon),
        rings: (d.rings || [d.polygon]).map(polygon),
        kind: d.type,
        ...(d.cellIds?.length === 1 && castleCells.some(c => c.id === d.cellIds[0]) ? {castleCell: d.cellIds[0]} : {}),
        name: districtNames[d.id],
        shade: i % 6,
        features: sites?.filter(site => site.district === String(d.id)).map(site => site.kind) || []
    }));
    const sea = g.water.length ? [polygon(g.water)] : [],
        rivers = g.rivers.map((p, i) => ({points: polygon(p), width: g.riverWidths[i]}));
    const roads = [...g.roads.map((p, i) => ({id: `main-${i}`, points: polygon(p), width: 8, major: true})),
        ...(e.localStreets || []).map((p, i) => ({
            id: `local-${i}`,
            points: polygon(p),
            width: 4.8,
            major: false,
            landOnly: true
        })),
        ...(e.connectedAlleys || e.alleys).map((p, i) => ({
            id: `alley-${i}`,
            points: polygon(p),
            width: 4.8,
            major: false,
            landOnly: true
        })),
        ...(e.wallStreets || []).map((p, i) => ({
            id: `wall-${i}`,
            points: polygon(p),
            width: 4.8,
            major: false,
            landOnly: true
        })),
        ...(e.outerWallStreets || []).map((p, i) => ({
            id: `outer-wall-${i}`,
            points: polygon(p),
            width: 3.2,
            major: false,
            landOnly: true
        }))];
    const footbridges = g.planks.filter(p => !g.piers.some(pier => p.length === pier.length && (p.every((v, i) => distance(v, pier[i]) < 1e-6) || p.every((v, i) => distance(v, pier[pier.length - 1 - i]) < 1e-6)))).map(polygon);
    const network = buildBridgeNetwork({
        roads,
        rivers,
        sea,
        footbridges,
        urban: g.cells.filter(c => c.urban).map(c => polygon(c.polygon)),
        crossings: (g.riverCrossings || []).map(list => list.map(c => ({...c, point: point(c.point)})))
    });
    const water = [...network.ribbons, ...sea];
    const buildings = e.housing.flatMap((p, i) => {
        const poly = polygon(p);
        if (replaced.has(i) || !fitsFootprint(poly, 'house') || !dryFootprint(poly, water)) return [];
        const center = centroid(poly);
        return [{
            polygon: poly,
            district: districts.find(d => inside(center, d.polygon) && !d.rings.slice(1).some(hole => inside(center, hole)))?.id,
            kind: 'house',
            shade: i % 5
        }];
    });
    const urban = g.cells.filter(c => c.urban).flatMap(c => polygon(c.polygon)), [x0, y0, x1, y1] = bounds(urban.length ? urban : buildings.flatMap(b => b.polygon));
    const width = Math.max(x1 - x0, (y1 - y0) * 4 / 3, 100) * 1.55, height = width * .75;
    const viewBox = {x: (x0 + x1) / 2 - width / 2, y: (y0 + y1) / 2 - height * .44, width, height};
    const special = [...e.specialBuildings.flatMap(b => {
        if (sites && b.kind === 'temple') return [];
        let footprint = b.polygon;
        if (b.kind === 'castle' && (!fitsFootprint(footprint, b.kind) || !dryFootprint(polygon(footprint), water))) {
            const cell = g.cells.find(c => c.id === b.cell && c.ward === 'castle');
            const court = cell && inset(cell.polygon, 15.6);
            let parcels = court?.length >= 3 ? [court] : [];
            for (const wet of water) parcels = parcels.flatMap(parcel => polygonBoolean(parcel, polygon(wet), 'difference'));
            const frames = parcels.flatMap(parcel => {
                const frame = footprintFrame(parcel, MIN_FOOTPRINT_SIZE.castle);
                return frame && dryFootprint(polygon(frame.rect), water) ? [frame] : [];
            }).sort((a, b) => b.width * b.height - a.width * a.height);
            if (frames.length) footprint = frames[0].rect;
        }
        if (!fitsFootprint(footprint, b.kind) || !dryFootprint(polygon(footprint), water)) return [];
        return [{...b, polygon: footprint}];
    }).map(b => ({
        ...b,
        ...(b.kind === 'castle' ? {name: castleNames[b.cell]} : {}),
        polygon: polygon(b.polygon)
    })), ...(sites || []).filter(site => site.kind === 'temple').map(site => ({
        kind: 'temple',
        district: site.district,
        polygon: polygon(site.building),
        court: polygon(site.polygon),
        tower: polygon(site.tower)
    }))];
    const markets = sites?.filter(site => site.kind === 'market').map(site => ({
        ...site,
        polygon: polygon(site.polygon),
        stalls: site.stalls.map(polygon),
        center: point(site.center)
    }));
    const squares = markets ? markets.map(site => site.polygon) : e.squares.map(polygon);
    const trees = [...e.treeDrawings, ...e.forests.flatMap(f => f.trees)].filter(t => !sites?.some(site => inside(t.point, site.polygon))).map((t, i) => ({
        ...t,
        point: point(t.point),
        radius: 5,
        shade: i % 4
    }));
    const inhabited = inhabitedBank(buildings);
    const city = {
        version: '0.2.0',
        source: {format: 'compatible', version: g.version, referenceUrl},
        generatedGeometry: g,
        options: {...options},
        generatedName,
        name: name && name !== `Город ${options.seed}` ? name : generatedName,
        width: 1600,
        height: 1200,
        viewBox,
        center: [(x0 + x1) / 2, (y0 + y1) / 2],
        terrain: {
            kind: options.coast ? (options.river ? 'estuary' : 'coast') : (options.river ? 'river' : 'inland'),
            coast: !!sea.length,
            river: !!rivers.length,
            sea,
            earth: polygon(g.earth),
            rivers,
            ribbons: network.ribbons,
            mouths: network.mouths
        },
        districts,
        buildings,
        special,
        streets: connectedStreets(network.streets,
            [...network.quays.map(q => q.points), ...network.approaches.map(a => a.points), ...network.bridges.map(b => [b.a, b.b]), ...squares.map(p => [...p, p[0]])],
            g.walls.flatMap(w => castleWalls.has(w)
                ? w.gates.map(p => [point(p)])
                : w.polygon.flatMap((p, i) => w.segments[i] ? [[point(p), point(w.polygon[(i + 1) % w.polygon.length])]] : [])),
            {allowTerminal: allowStreetTerminal}),
        bridges: network.bridges,
        approaches: network.approaches,
        quays: network.quays,
        walls: g.walls.map(w => ({
            ...w,
            polygon: polygon(w.polygon),
            towers: polygon(w.towers),
            gates: polygon(w.gates)
        })),
        gates: polygon(g.gates),
        castle: special.find(b => b.kind === 'castle') || null,
        temple: special.find(b => b.kind === 'temple') || null,
        plaza: squares[0] ? {polygon: squares[0]} : null,
        squares,
        markets,
        monuments: sites ? [] : e.monuments.map(polygon),
        docks: [...anchorPiersToBanks(g.piers.map(polygon), water).filter(points => inhabited(points[0])).map(points => ({
            points,
            width: 4.8
        })), ...structuredClone(e.portLayout?.docks || [])],
        fields: e.fields.map(p => ({polygon: polygon(p)})),
        gardens: g.cells.filter(c => c.ward === 'park').map(c => ({polygon: polygon(c.polygon)})),
        trees,
        treeCrowns: e.treeCrowns.map(c => c ? polygon(c) : null)
    };
    city.statistics = {buildings: buildings.length, districts: mapDistricts(city).length, bridges: city.bridges.length};
    city.generationWarnings = [];
    for (const [label, requested, built] of [
        ['замков', Number(options.citadel), Number(!!city.castle)],
        ['рынков', options.marketCount, markets?.length ?? squares.length],
        ['храмов', options.templeCount, special.filter(b => b.kind === 'temple').length]
    ]) if (built < requested) city.generationWarnings.push(`Не хватило подходящих участков: ${label} ${built} из ${requested}.`);
    return attachCustomObjects(assignDistrictWealth(city), e.customObjects);
}

export function generateCity(input = {}) {
    const {options, source, name} = normalizeOptions(input),
        model = generateModel(recipeFromOptions(options), {forests: true});
    const geometry = structureGeometry(model);
    geometry.experimental.districtRegions = buildDistrictRegions(model);
    geometry.experimental.districtLandmarks = buildDistrictLandmarks(model, geometry, options);
    const city = cityFromGeometry(geometry, options, {name, referenceUrl: source?.url || input.referenceUrl});
    const ports = additionalPorts(city, geometry.cells.filter(c => c.urban && !c.water).map(c => c.polygon.map(([x, y]) => [x, -y])));
    city.docks.push(...ports);
    geometry.experimental.portLayout = {version: 1, coordinateSystem: 'svg', docks: ports};
    assignDistrictWealth(city);
    geometry.experimental.customObjects = buildCustomObjects(city);
    return attachCustomObjects(city, geometry.experimental.customObjects);
}
