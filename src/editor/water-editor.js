import {area, distance, inside, segmentsIntersect} from '../core/geometry.js';
import {buildBridgeNetwork, dryPieces, riverRibbon} from '../roads/bridge-network.js';
import {
    ensureEditorWater,
    footprintDryInWater,
    pointInWater,
    waterBodyGeometry,
    waterPoint
} from '../water/water-geometry.js';
import {
    affectedPopulationQuarters,
    applyPopulation,
    protectedBuilding,
    repopulateQuarters
} from '../districts/quarter-population.js';
import {rerouteBuildingStreets} from '../buildings/building-streets.js';
import {footprints, hitsRoad} from '../buildings/building-spatial.js';

function simpleLine(points, closed) {
    if (points.length < (closed ? 3 : 2) || points.length > 4096 || !points.every(waterPoint)) return false;
    const count = closed ? points.length : points.length - 1;
    for (let i = 0; i < count; i++) {
        if (distance(points[i], points[(i + 1) % points.length]) < 1e-5) return false;
        for (let j = i + 2; j < count; j++) {
            if (closed && i === 0 && j === count - 1) continue;
            if (segmentsIntersect(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length])) return false;
        }
    }
    return !closed || area(points) >= 4;
}

export function validateEditorWater(water) {
    if (!water || water.version !== 1 || !Number.isSafeInteger(water.nextId) || water.nextId < 1 || typeof water.dirty !== 'boolean' || !Array.isArray(water.bodies) || water.bodies.length > 64) throw new Error('Некорректные водоёмы проекта.');
    const ids = new Set();
    for (const body of water.bodies) {
        if (!body || !/^water-[1-9]\d*$/.test(body.id) || Number(body.id.slice(6)) >= water.nextId || ids.has(body.id) || !['river', 'sea'].includes(body.kind) || typeof body.smooth !== 'boolean' || !Array.isArray(body.points) || body.points.length > 256 || !simpleLine(body.points, body.kind === 'sea') || body.kind === 'river' && (!Number.isFinite(body.width) || body.width < 2 || body.width > 10000) || body.outline !== undefined && !simpleLine(body.outline, true) || body.holes !== undefined && (!Array.isArray(body.holes) || body.holes.some(h => !simpleLine(h, true)))) throw new Error('Контур воды пересекает сам себя или содержит недопустимые точки.');
        ids.add(body.id);
        const shape = waterBodyGeometry(body);
        if (!simpleLine(shape.points, body.kind === 'sea') || !simpleLine(shape.polygon, true)) throw new Error('Изгибы воды образуют пересечение. Раздвиньте точки или уменьшите ширину реки.');
        if (shape.holes.some(h => !h.every(p => inside(p, shape.polygon)))) throw new Error('Остров должен оставаться внутри морского контура.');
    }
    const source = water.source;
    const path = points => Array.isArray(points) && points.length >= 2 && points.every(waterPoint);
    if (!source || !Array.isArray(source.roads) || source.roads.some(r => !r || typeof r.id !== 'string' || !/^[\w-]+$/.test(r.id) || !path(r.points) || r.originalPoints !== undefined && !path(r.originalPoints) || !Number.isFinite(r.width) || r.width <= 0) || !Array.isArray(source.footbridges) || source.footbridges.some(p => !path(p)) || !Array.isArray(source.docks) || source.docks.some(d => !d || !(path(d.points) || Array.isArray(d.polygon) && d.polygon.length >= 3 && d.polygon.every(waterPoint)) || d.width !== undefined && (!Number.isFinite(d.width) || d.width <= 0))) throw new Error('В проекте отсутствуют исходные дороги для редактирования воды.');
    return water;
}

export function editedWaterPoints(body, boundary = 'course') {
    if (boundary.startsWith('hole-')) return body.holes[Number(boundary.slice(5))];
    return body.kind === 'river' && boundary === 'banks' ? waterBodyGeometry(body).polygon : body.points;
}

export function withWaterPoints(body, points, boundary = 'course') {
    const next = structuredClone(body);
    if (boundary.startsWith('hole-')) next.holes[Number(boundary.slice(5))] = points;
    else if (body.kind === 'river' && boundary === 'banks') next.outline = points;
    else {
        next.points = points;
        delete next.outline;
    }
    return next;
}

export function insertWaterPoint(points, point, closed) {
    let nearest = 0, gap = Infinity, projection = 0;
    for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
        const a = points[i], b = points[(i + 1) % points.length], dx = b[0] - a[0], dy = b[1] - a[1],
            length = dx * dx + dy * dy;
        const t = length ? ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length : 0,
            s = Math.max(0, Math.min(1, t));
        const d = Math.hypot(point[0] - a[0] - s * dx, point[1] - a[1] - s * dy);
        if (d < gap) {
            nearest = i;
            gap = d;
            projection = t;
        }
    }
    const index = !closed && nearest === 0 && projection < 0 ? 0 : !closed && nearest === points.length - 2 && projection > 1 ? points.length : nearest + 1;
    const result = points.map(p => [...p]);
    result.splice(index, 0, point);
    return {points: result, index};
}

export function translateWaterBody(body, delta) {
    const move = points => points.map(p => [p[0] + delta[0], p[1] + delta[1]]);
    return {
        ...body,
        points: move(body.points), ...(body.outline ? {outline: move(body.outline)} : {}), ...(body.holes ? {holes: body.holes.map(move)} : {})
    };
}

export function planWaterChange(city, bodies, {repopulate = true} = {}) {
    try {
        if (city.source?.format !== 'edited') throw new Error('Сначала включите режим редактирования.');
        const current = ensureEditorWater(city), water = {...current, bodies: structuredClone(bodies), dirty: true};
        water.nextId = Math.max(current.nextId, ...bodies.map(b => Number(b.id.slice(6)) + 1));
        validateEditorWater(water);
        const regions = bodies.map(waterBodyGeometry), sea = regions.filter(r => r.kind === 'sea'),
            rivers = regions.filter(r => r.kind === 'river');
        const seaPolygons = sea.map(r => r.polygon);
        const roads = water.source.roads.flatMap(({
                                                      originalPoints,
                                                      ...r
                                                  }) => dryPieces(originalPoints || r.points, sea).map((points, i) => ({
            ...r,
            id: `${r.id}-sea-${i}`,
            points
        })));
        const footbridges = water.source.footbridges.flatMap(points => dryPieces(points, sea));
        const network = buildBridgeNetwork({
            roads,
            footbridges,
            rivers: rivers.map(r => ({points: r.points, width: r.width})),
            ribbons: rivers.map(r => r.polygon),
            sea: seaPolygons,
            urban: city.districts.map(d => d.polygon),
            excludeSeaBridges: true,
            waterRegions: regions
        });
        let buildings = city.buildings.filter(b => footprints(b).every(p => footprintDryInWater(p, regions)));
        if (city.buildings.some(b => protectedBuilding(b) && !buildings.includes(b))) throw new Error('Вода пересекает установленное или особое здание. Передвиньте здание или измените берег.');
        network.streets = rerouteBuildingStreets(network.streets, buildings, regions);
        const detours = network.streets.filter(r => r.originalPoints);
        buildings = buildings.filter(b => protectedBuilding(b) || !detours.some(r => hitsRoad(b, r)));
        const trees = city.trees.filter(t => !pointInWater(t.point, regions));
        const previous = new Map(current.bodies.map(b => [b.id, b]));
        const nextBodies = new Map(bodies.map(b => [b.id, b]));
        const changed = [...current.bodies.filter(b => JSON.stringify(b) !== JSON.stringify(nextBodies.get(b.id))), ...bodies.filter(b => JSON.stringify(b) !== JSON.stringify(previous.get(b.id)))];
        const draft = {...city, editor: {...city.editor, water}, buildings, streets: network.streets};
        const polygons = [...changed.map(b => waterBodyGeometry(b).polygon), ...detours.flatMap(r => [riverRibbon(r.points, r.width), riverRibbon(r.originalPoints, r.width)])];
        const population = repopulate ? repopulateQuarters(draft, city, affectedPopulationQuarters(city, polygons), {polygons}) : null;
        return {
            ok: true,
            water,
            regions,
            sea,
            rivers,
            network,
            buildings,
            trees,
            population,
            removed: city.buildings.length - buildings.length
        };
    } catch (error) {
        return {ok: false, message: error.message};
    }
}

export function applyWaterChange(city, plan) {
    if (!plan.ok) throw new Error(plan.message);
    const {water, regions, sea, rivers, network} = plan;
    city.editor.water = water;
    city.buildings = plan.buildings;
    if (plan.population) applyPopulation(city, plan.population);
    city.trees = plan.trees;
    const kind = sea.length ? rivers.length ? 'estuary' : 'coast' : rivers.length ? 'river' : 'inland';
    city.terrain = {
        ...city.terrain,
        kind,
        coast: !!sea.length,
        river: !!rivers.length,
        rivers: rivers.map(r => ({points: r.points, width: r.width})),
        ribbons: rivers.map(r => r.polygon),
        mouths: network.mouths
    };
    city.options = {...city.options, coast: !!sea.length, river: !!rivers.length};
    city.bridges = network.bridges;
    city.approaches = network.approaches;
    city.quays = network.quays;
    city.docks = structuredClone(water.source.docks);
    const roads = network.streets.flatMap((r, ri) => r.originalPoints ? [{
        ...r,
        a: r.points[0],
        b: r.points.at(-1)
    }] : r.points.slice(1).map((b, i) => ({
        ...r,
        id: `${r.id}-dry-${ri}-part-${i}`,
        a: r.points[i],
        b,
        points: [r.points[i], b]
    })));
    city.streets = roads;
    if (city.editor.baseFormat === 'legacy') {
        city.terrain.sea = sea[0]?.polygon || [];
        city.terrain.riverPolygon = rivers[0]?.polygon || [];
        city.terrain.riverPath = rivers[0]?.points || [];
        city.terrain.riverWidth = rivers[0]?.width || 0;
        city.terrain.shoreline = sea[0]?.polygon || [];
    } else city.terrain.sea = sea.map(r => r.polygon);
    if (city.editor.baseFormat === 'mfcg') {
        city.imported.water = sea.map(r => [r.polygon, ...r.holes]);
        city.imported.rivers = rivers.map(r => ({points: r.points, width: r.width}));
        city.imported.planks = structuredClone(water.source.docks);
    }
    city.statistics = {
        ...city.statistics,
        buildings: city.buildings.length,
        bridges: city.bridges.length,
        trees: city.trees.length
    };
    return {removed: plan.removed, waterBodies: regions.length};
}
