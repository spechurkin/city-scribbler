import {area, bounds, centroid, rectangle, segmentDistance} from '../core/geometry.js';
import {BUILDING_TYPES, buildingsOverlap, containsFootprint, containsPoint} from '../editor/building-editor.js';
import {architectureInFrame} from './building-architecture.js';
import {boxOf, buildingIndex, footprints, hitsRoad} from './building-spatial.js';
import {dryFootprint} from '../roads/bridge-network.js';
import {random} from '../core/random.js';
import {CUSTOM_OBJECT_COUNTS, customObjectCounts, FARM_KINDS, LODGING_KINDS} from './custom-object-settings.js';
import {placementRuleError, rankPlacementCandidates, urbanPlacementRegions} from './building-placement-rules.js';
import {exteriorBuildingSites} from './exterior-building-sites.js';

export const FARM_AREA_PER_OBJECT = 30000;

export function customObjectBudget(size, fieldArea) {
    const counts = customObjectCounts({size});
    return {
        lodging: LODGING_KINDS.reduce((n, kind) => n + counts[kind], 0),
        other: Object.keys(counts).filter(kind => !LODGING_KINDS.includes(kind) && !FARM_KINDS.includes(kind)).reduce((n, kind) => n + counts[kind], 0),
        farming: fieldArea > 0 ? Math.min(FARM_KINDS.reduce((n, kind) => n + counts[kind], 0), Math.max(1, Math.floor(fieldArea / FARM_AREA_PER_OBJECT))) : 0
    };
}

const shuffle = (items, rng) => {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
};

function pointsIn(region, rng, count) {
    const [x0, y0, x1, y1] = bounds(region.polygon), points = [centroid(region.polygon)];
    for (let i = 0; i < count; i++) {
        const p = [rng.range(x0, x1), rng.range(y0, y1)];
        if (containsPoint(region, p)) points.push(p);
    }
    return points;
}

// The completed city is read-only here; this stream never advances the MFCG model.
export function buildCustomObjects(city) {
    const rng = random(city.options.seed, 'custom-objects:v3'), buildings = [],
        requested = customObjectCounts(city.options), fieldArea = city.fields.reduce((n, f) => n + area(f.polygon), 0),
        farmCapacity = fieldArea > 0 ? Math.max(1, Math.floor(fieldArea / FARM_AREA_PER_OBJECT)) : 0,
        water = [...city.terrain.sea, ...city.terrain.ribbons],
        districts = city.districts.filter(d => d.kind !== 'park' && d.castleCell === undefined);
    if (!fieldArea) for (const kind of FARM_KINDS) if (city.options[CUSTOM_OBJECT_COUNTS[kind]] == null) requested[kind] = 0;
    const fixed = [...city.special.filter(b => b.kind !== 'farmhouse').flatMap(b => [
        {polygon: b.court || b.polygon, courtyard: !!b.court},
        ...(b.court ? [b.polygon, b.tower, b.keep, b.nave, b.transept].filter(p => p?.length >= 3).map(polygon => ({
            polygon,
            physical: true
        })) : [])
    ]),
        ...city.squares.map(polygon => ({polygon, square: true})), ...city.gardens,
        ...(city.markets || []).flatMap(m => m.stalls.map(polygon => ({polygon, stall: true})))];
    const obstacles = buildingIndex(fixed);
    for (const b of fixed) obstacles.add({building: b, box: boxOf(b)});
    const roads = [...city.streets, ...city.docks, ...(city.quays || []).map(q => ({points: q.points, width: 8}))]
        .filter(r => r.points?.length > 1);
    for (const wall of city.walls) wall.polygon.forEach((p, i) => {
        if (wall.segments[i]) roads.push({points: [p, wall.polygon[(i + 1) % wall.polygon.length]], width: 8});
    });
    const segments = roads.flatMap(r => r.points.slice(1).map((b, i) => ({points: [r.points[i], b], width: r.width})));
    const roadIndex = buildingIndex([]);
    for (const road of segments) {
        const [x0, y0, x1, y1] = bounds(road.points), margin = road.width / 2;
        roadIndex.add({road, box: [x0 - margin, y0 - margin, x1 + margin, y1 + margin]});
    }
    const candidates = shuffle(districts.flatMap(d => {
        const houses = shuffle(city.buildings.filter(b => b.district === d.id), rng).slice(0, 50).map(b => centroid(b.polygon));
        const cells = city.generatedGeometry.cells.filter(c => c.urban && !c.water)
            .map(c => centroid(c.polygon.map(([x, y]) => [x, -y]))).filter(p => containsPoint(d, p));
        return [...cells, ...houses, ...pointsIn(d, rng, 35)].map(point => ({point, district: d}));
    }), rng);
    const urban = urbanPlacementRegions(city), context = {...city, buildings};
    const exterior = exteriorBuildingSites(city, segments, rng, urban);
    const usage = new Map();
    const place = (kind, candidates, field = null, civicSquare = false, scale = 1) => {
        const rule = {
            ...BUILDING_TYPES[kind],
            width: BUILDING_TYPES[kind].width * scale,
            height: BUILDING_TYPES[kind].height * scale
        };
        const choices = field !== null ? candidates : rule.zone === 'outside' ? exterior : rule.zone === 'either' ? [...candidates, ...exterior] : candidates;
        const ranked = rankPlacementCandidates(choices, rule, rng, usage, city);
        for (const candidate of ranked) {
            const {point, district} = candidate;
            if (district && !rule.wealth.includes(district.wealth)) continue;
            if (rule.uniqueDistrict && buildings.some(b => b.kind === kind && b.district === district?.id)) continue;
            const region = field === null ? candidate.region || district : city.fields[field];
            const radius = Math.hypot(rule.width, rule.height),
                nearby = roadIndex.near([point[0] - radius, point[1] - radius, point[0] + radius, point[1] + radius])
                    .map(entry => entry.road).filter(r => segmentDistance(point, ...r.points) < radius + r.width);
            const nearest = [...nearby].sort((a, b) => segmentDistance(point, ...a.points) - segmentDistance(point, ...b.points))[0];
            const edge = region.polygon.reduce((best, p, i, poly) => {
                const q = poly[(i + 1) % poly.length], length = Math.hypot(q[0] - p[0], q[1] - p[1]);
                return length > best.length ? {length, a: p, b: q} : best;
            }, {length: 0});
            const axes = [nearest?.points, [edge.a, edge.b]].filter(Boolean);
            const angles = [...new Set([...axes.flatMap(([a, b]) => {
                const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
                return [angle, angle + Math.PI / 2];
            }), 0, ...(kind === 'guardhouse' && civicSquare ? Array.from({length: 12}, (_, i) => i * Math.PI / 12) : [])])];
            for (const angle of angles) {
                const lot = rectangle(point, rule.width, rule.height, angle);
                if (!containsFootprint(region, lot)) continue;
                if (!district && field === null && !dryFootprint(lot, urban)) continue;
                if (city.terrain.earth?.length && !containsFootprint({polygon: city.terrain.earth}, lot)) continue;
                const building = {
                    id: `custom-${buildings.length + 1}`, kind,
                    ...architectureInFrame(kind, lot), name: '', shade: rng.int(0, 4), custom: true,
                    district: district?.id || null, layer: field === null ? rule.layer : 'fields',
                    ...(field === null ? {} : {field})
                };
                if (placementRuleError(context, building, rule, {district, urban})) continue;
                if (nearby.some(r => hitsRoad(building, r))) continue;
                const box = boxOf(building);
                if (obstacles.near(box).some(({building: obstacle}) => {
                    if (civicSquare && (obstacle.square || obstacle.courtyard)) return false;
                    if (kind !== 'guardhouse' && (obstacle.stall || obstacle.physical)) return false;
                    return buildingsOverlap(building, obstacle);
                })) continue;
                if (!footprints(building).every(p => dryFootprint(p, water))) continue;
                buildings.push(building);
                obstacles.add({building, box});
                const id = district?.id || 'outside';
                usage.set(id, (usage.get(id) || 0) + 1);
                return true;
            }
        }
        return false;
    };
    for (const district of districts) {
        if (place('guardhouse', candidates.filter(c => c.district === district))) continue;
        const [x0, y0, x1, y1] = bounds(district.polygon), dense = candidates.filter(c => c.district === district);
        for (let x = x0 + 1; x < x1; x += 3) for (let y = y0 + 1; y < y1; y += 3) {
            if (containsPoint(district, [x, y])) dense.push({point: [x, y], district});
        }
        if (!place('guardhouse', dense) && ![1, .75, .5, .25].some(scale => place('guardhouse', dense, null, true, scale))) throw new Error(`Не удалось найти участок для обязательной караульни района «${district.name || district.id}».`);
    }
    for (const kind of ['tavern', ...shuffle(LODGING_KINDS.filter(kind => kind !== 'tavern'), rng)]) {
        for (let i = 0; i < requested[kind]; i++) if (!place(kind, candidates)) break;
    }
    if (!buildings.some(b => LODGING_KINDS.includes(b.kind))) {
        // Sparse candidate samples must not remove the one required lodging object.
        const dense = districts.flatMap(d => {
            const [x0, y0, x1, y1] = bounds(d.polygon), points = [];
            for (let x = x0 + 8; x < x1; x += 6) for (let y = y0 + 8; y < y1; y += 6) {
                if (containsPoint(d, [x, y])) points.push({point: [x, y], district: d});
            }
            return points;
        });
        const preferred = LODGING_KINDS.filter(kind => requested[kind] > 0),
            fallback = LODGING_KINDS.filter(kind => !preferred.includes(kind));
        if (![...preferred, ...fallback].some(kind => place(kind, dense))) throw new Error('Не удалось найти участок для обязательного объекта постоя.');
    }
    const others = shuffle(Object.keys(requested).filter(kind => !LODGING_KINDS.includes(kind) && !FARM_KINDS.includes(kind)), rng);
    for (const kind of others) for (let i = 0; i < requested[kind]; i++) if (!place(kind, candidates)) break;
    const fields = city.fields.map((f, index) => ({index, area: area(f.polygon)})), farms = [];
    // Interleave types so a small field budget is shared between the requested farm buildings.
    for (let i = 0; i < Math.max(...FARM_KINDS.map(kind => requested[kind])); i++) {
        farms.push(...shuffle(FARM_KINDS.filter(kind => requested[kind] > i), rng));
    }
    let farmCount = 0;
    for (const kind of farms) {
        if (farmCount >= farmCapacity || !fields.length) break;
        let pick = rng() * fieldArea, selected = fields.at(-1);
        for (const f of fields) if ((pick -= f.area) <= 0) {
            selected = f;
            break;
        }
        const ordered = [selected, ...shuffle(fields.filter(f => f !== selected), rng)];
        for (const f of ordered) {
            const points = pointsIn(city.fields[f.index], rng, 18).map(point => ({point}));
            if (place(kind, points, f.index)) {
                farmCount++;
                break;
            }
        }
    }
    return {version: 2, coordinateSystem: 'svg', requested, buildings};
}

export function visibleCityBuildings(city) {
    if (!city.customObjects) return city.buildings;
    const index = objectIndex(city.customObjects);
    return city.buildings.filter(b => !index.near(boxOf(b)).some(({building}) => buildingsOverlap(b, building)));
}

function objectIndex(objects) {
    const index = buildingIndex(objects);
    for (const building of objects) index.add({building, box: boxOf(building)});
    return index;
}

export function visibleCityTrees(city) {
    if (!city.customObjects) return city.trees;
    const index = objectIndex(city.customObjects);
    return city.trees.filter(t => {
        const crown = city.treeCrowns[t.index], polygon = crown
            ? crown.map(([x, y]) => [x + t.point[0], y + t.point[1]])
            : rectangle(t.point, t.radius * 2, t.radius * 2);
        const tree = {polygon};
        return !index.near(boxOf(tree)).some(({building}) => buildingsOverlap(building, tree));
    });
}

export function attachCustomObjects(city, overlay) {
    if (!overlay) return city;
    city.customObjects = structuredClone(overlay.buildings);
    city.statistics.buildings = visibleCityBuildings(city).length + city.customObjects.length;
    const exterior = city.customObjects.filter(b => b.district === null && !FARM_KINDS.includes(b.kind));
    if (exterior.length && city.viewBox) {
        const box = city.viewBox, [x0, y0, x1, y1] = bounds(exterior.flatMap(b => footprints(b).flat())),
            left = Math.min(box.x, x0 - 35), top = Math.min(box.y, y0 - 35),
            right = Math.max(box.x + box.width, x1 + 35), bottom = Math.max(box.y + box.height, y1 + 35),
            width = Math.max(right - left, (bottom - top) * 4 / 3);
        city.viewBox = {x: (left + right - width) / 2, y: (top + bottom - width * .75) / 2, width, height: width * .75};
    }
    if (overlay.requested) {
        const warnings = Object.entries(overlay.requested).flatMap(([kind, requested]) => {
            const count = city.customObjects.filter(b => b.kind === kind).length;
            return count < requested ? [`Не хватило подходящих участков: ${BUILDING_TYPES[kind].label.toLocaleLowerCase('ru')} ${count} из ${requested}.`] : [];
        });
        city.generationWarnings = [...new Set([...(city.generationWarnings || []), ...warnings])];
    }
    return city;
}
