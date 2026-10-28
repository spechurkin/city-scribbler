import {area, bounds, centroid, distance, dot, lerp, rectangle, segmentSegmentDistance, sub} from '../core/geometry.js';
import {containsFootprint, containsPoint} from '../editor/building-editor.js';
import {boxesMeet, boxOf, buildingIndex, footprintIntersection, hitsRoad} from '../buildings/building-spatial.js';
import {footprintDryInWater, waterGeometry} from '../water/water-geometry.js';
import {hashSeed, random} from '../core/random.js';
import {MIN_REGENERATED_HOUSE_SIZE} from '../buildings/footprint-size.js';

export const proceduralHouse = b => b.kind === 'house' && !b.custom && !b.name;
export const protectedBuilding = b => !!(b.custom || b.name || !['house', 'stall'].includes(b.kind));
const ringsOf = q => q.rings || [q.polygon];
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];

export function populationQuarters(city) {
    return city.editor.quarters?.length ? city.editor.quarters : city.districts.flatMap((d, i) => (d.components || [d]).map((c, j) => ({
        id: `quarter-${i + 1}-${j + 1}`, district: d.id, polygon: c.polygon, rings: c.rings || [c.polygon]
    })));
}

export function buildingQuarter(quarters, building) {
    const center = centroid(building.polygon);
    return quarters.find(q => q.id === building.quarter && containsPoint(q, center)) || quarters.find(q => containsPoint(q, center));
}

function intersects(a, b) {
    const x = bounds(a), y = bounds(b);
    if (x[2] < y[0] - 1e-5 || y[2] < x[0] - 1e-5 || x[3] < y[1] - 1e-5 || y[3] < x[1] - 1e-5) return false;
    return a.some(p => containsPoint({polygon: b}, p)) || b.some(p => containsPoint({polygon: a}, p))
        || a.some((p, i) => b.some((q, j) => segmentSegmentDistance(p, a[(i + 1) % a.length], q, b[(j + 1) % b.length]) < 1e-5));
}

export function affectedPopulationQuarters(city, polygons) {
    return new Set(populationQuarters(city).filter(q => polygons.some(p => intersects(q.polygon, p))).map(q => q.id));
}

export function populationProfiles(city) {
    const quarters = populationQuarters(city), houses = new Map(quarters.map(q => [q.id, []]));
    for (const b of city.buildings.filter(proceduralHouse)) {
        const owner = buildingQuarter(quarters, b);
        if (owner) houses.get(owner.id).push(b);
    }
    return quarters.map(q => {
        if (q.population) return q;
        const members = houses.get(q.id), size = members.length ? median(members.map(b => area(b.polygon))) : 0;
        const coverage = members.reduce((n, b) => n + area(b.polygon), 0) / Math.max(1, area(q.polygon) - ringsOf(q).slice(1).reduce((n, p) => n + area(p), 0));
        return {...q, population: {houseArea: size, coverage: Math.max(.000001, Math.min(.7, coverage))}};
    });
}

export function repopulateQuarters(city, before, affected, {polygons = null} = {}) {
    const profiles = new Map(populationProfiles(before).map(q => [q.id, q.population]));
    const quarters = populationQuarters(city).map(q => ({
        ...q,
        population: profiles.get(q.id) || q.population || {houseArea: 0, coverage: .5}
    }));
    const buildings = city.buildings.slice(), retained = new Set(buildings.map(b => b.id));
    const released = before.buildings.filter(b => proceduralHouse(b) && !retained.has(b.id));
    const index = buildingIndex(buildings), water = waterGeometry(city);
    for (const b of buildings) index.add({building: b, box: boxOf(b)});
    const roads = (city.streets || []).map(r => ({...r, points: r.points || [r.a, r.b]}));
    const vacant = [...buildings.filter(b => b.parts?.court).map(b => ({polygon: b.parts.court})), ...(city.gardens || []), ...(city.fields || []), ...(city.markets || []), ...(city.squares || []).map(polygon => ({polygon})),
        ...(city.imported?.greens || []).map(rings => ({
            polygon: rings[0],
            rings
        })), ...(city.imported?.squares || []).map(rings => ({polygon: rings[0], rings}))];
    if (city.plaza?.polygon) vacant.push(city.plaza);
    let nextId = city.editor.nextId, added = 0;
    for (const q of quarters.filter(q => affected.has(q.id) && q.population.houseArea > 0)) {
        const scale = Math.max(1, Math.sqrt(q.population.houseArea / MIN_REGENERATED_HOUSE_SIZE.area));
        const minimumWidth = MIN_REGENERATED_HOUSE_SIZE.width * scale,
            minimumDepth = MIN_REGENERATED_HOUSE_SIZE.depth * scale, gap = 1;
        const nearbyRoads = roads.filter(r => hitsRoad({polygon: q.polygon}, r));
        const nearbyVacant = vacant.filter(r => intersects(q.polygon, r.polygon));
        const fits = building => {
            const box = boxOf(building);
            return (!polygons || polygons.some(p => intersects(building.polygon, p)))
                && !index.near(box).some(entry => boxesMeet(box, entry.box) && footprintIntersection(building, entry.building) > 1e-5)
                && containsFootprint(q, building.polygon) && footprintDryInWater(building.polygon, water)
                && !nearbyRoads.some(r => hitsRoad(building, r))
                && !nearbyVacant.some(r => footprintIntersection(building, r) > 1e-5);
        };
        for (const road of nearbyRoads) for (let segment = 1; segment < road.points.length; segment++) {
            const a = road.points[segment - 1], z = road.points[segment], length = distance(a, z);
            if (length < minimumWidth + gap * 2) continue;
            const tangent = sub(z, a).map(n => n / length), normal = [-tangent[1], tangent[0]],
                angle = Math.atan2(tangent[1], tangent[0]);
            const projection = p => dot(sub(p, a), tangent), margin = (minimumWidth + minimumDepth) * .75;
            const qProjection = q.polygon.map(projection),
                qMin = Math.max(minimumWidth / 2 + gap, Math.min(...qProjection) - margin),
                qMax = Math.min(length - minimumWidth / 2 - gap, Math.max(...qProjection) + margin);
            const spans = (polygons || [q.polygon]).map(p => p.map(projection)).map(values => [Math.max(qMin, Math.min(...values) - margin), Math.min(qMax, Math.max(...values) + margin)]).filter(([lo, hi]) => hi >= lo);
            const preferred = released.map(b => centroid(b.polygon)).filter(p => {
                const t = projection(p), nearest = lerp(a, z, Math.max(0, Math.min(1, t / length)));
                return distance(p, nearest) < road.width / 2 + (minimumDepth + minimumWidth) * 1.5;
            }).map(projection).filter(t => spans.some(([lo, hi]) => t >= lo && t <= hi));
            const slots = new Set(preferred), start = minimumWidth / 2 + gap, step = minimumWidth + gap;
            for (const [lo, hi] of spans) for (let k = Math.max(0, Math.ceil((lo - start) / step)); k <= Math.floor((hi - start) / step); k++) slots.add(start + k * step);
            for (const t of slots) for (const side of [-1, 1]) {
                const seed = `${city.options.seed}:${q.id}:${road.id}:${segment}:${t}:${side}`,
                    rng = random(seed, 'house-size');
                const width = minimumWidth * rng.range(1, 1.5), depth = minimumDepth * rng.range(1, 1.5);
                if (t < width / 2 + gap || t > length - width / 2 - gap) continue;
                const frontage = lerp(a, z, t / length), offset = road.width / 2 + gap + depth / 2;
                const center = frontage.map((n, i) => n + normal[i] * offset * side),
                    shape = rectangle(center, width, depth, angle);
                const b = {
                    id: `building-${nextId}`,
                    kind: 'house',
                    name: '',
                    polygon: shape,
                    rings: [shape],
                    parts: {},
                    district: q.district ?? city.districts.find(d => containsPoint(d, center))?.id ?? null,
                    quarter: q.id,
                    shade: hashSeed(seed) % 5
                };
                if (fits(b)) {
                    buildings.push(b);
                    index.add({building: b, box: boxOf(b)});
                    nextId++;
                    added++;
                }
            }
        }
    }
    return {buildings, quarters, nextId, added};
}

export function applyPopulation(city, population) {
    city.buildings = population.buildings;
    city.editor.quarters = population.quarters;
    city.editor.nextId = population.nextId;
    city.statistics = {...city.statistics, buildings: city.buildings.length};
}
