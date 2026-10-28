import {random} from '../core/random.js';
import {ensureStreetNames, restoreStreetNames} from '../roads/street-names.js';
import {assignDistrictWealth} from '../districts/district-wealth.js';
import {overlapsDecoration} from '../rendering/map-layout.js';
import {importMfcgGeoJson} from '../io/mfcg-geojson.js';
import {
    add,
    area,
    bounds,
    centroid,
    clip,
    distance,
    edgeKey,
    inset,
    inside,
    lerp,
    mul,
    pathDistance,
    pointKey,
    rectangle,
    segmentSegmentDistance,
    shortestPath,
    splitLots,
    sub,
    voronoi
} from '../core/geometry.js';

export const VERSION = 1;
export const WIDTH = 1600;
export const HEIGHT = 1200;
export const SIZES = {village: 16, town: 34, city: 60, capital: 92};
export const DEFAULT_OPTIONS = Object.freeze({
    seed: '1931200012',
    size: 'town',
    geography: 'estuary',
    density: 65,
    walls: true,
    castle: true,
    market: true,
    temple: true,
    fields: true,
    forest: true,
    port: true
});
const FRAME = [[24, 24], [1576, 24], [1576, 1176], [24, 1176]];

export function normalizeOptions(input = {}) {
    const o = {
        ...DEFAULT_OPTIONS,
        seed: typeof input.seed === 'string' || Number.isFinite(input.seed)
            ? String(input.seed).trim().slice(0, 80) || DEFAULT_OPTIONS.seed : DEFAULT_OPTIONS.seed,
        size: Object.hasOwn(SIZES, input.size) ? input.size : DEFAULT_OPTIONS.size,
        geography: ['auto', 'inland', 'river', 'coast', 'estuary'].includes(input.geography)
            ? input.geography : DEFAULT_OPTIONS.geography,
        density: Number.isFinite(Number(input.density))
            ? Math.max(25, Math.min(95, Math.round(Number(input.density)))) : DEFAULT_OPTIONS.density
    };
    for (const key of ['walls', 'castle', 'market', 'temple', 'fields', 'forest', 'port']) if (typeof input[key] === 'boolean') o[key] = input[key];
    return o;
}

function makeTerrain(options) {
    const rng = random(options.seed, 'terrain');
    const kind = options.geography === 'auto' ? rng.pick(['inland', 'river', 'coast', 'estuary']) : options.geography;
    const coast = ['coast', 'estuary'].includes(kind);
    const river = ['river', 'estuary'].includes(kind);
    const coastTarget = 770 + [218, 285, 344, 397][Object.keys(SIZES).indexOf(options.size)] * .82;
    const slope = rng.range(-0.23, 0.23), intercept = rng.range(coastTarget - 30, coastTarget + 35) - slope * 600;
    const curvature = rng.range(0.00018, 0.0006);
    const coastX = y => intercept + slope * y - curvature * (y - 600) ** 2;
    const shoreline = coast ? Array.from({length: 36}, (_, i) => {
        const y = -100 + i * 40;
        return [coastX(y), y];
    }) : [];
    const sea = coast ? [shoreline[0], [1800, -100], [1800, 1300], ...shoreline.slice(1).reverse()] : [];
    const phase = rng.range(0, Math.PI * 2), offset = rng.range(20, 115), amplitude = rng.range(45, 90);
    const riverPath = river ? Array.from({length: 101}, (_, i) => {
        const x = -100 + i * 18;
        return [x, 600 + offset + Math.sin(x / 190 + phase) * amplitude + (x - 800) * 0.085];
    }) : [];
    const riverWidth = rng.range(24, 37);
    const bank = (side) => riverPath.map((p, i) => {
        const d = sub(riverPath[Math.min(i + 1, riverPath.length - 1)], riverPath[Math.max(0, i - 1)]);
        const len = Math.hypot(...d);
        return add(p, mul([-d[1] / len, d[0] / len], riverWidth / 2 * side));
    });
    const riverPolygon = river ? [...bank(1), ...bank(-1).reverse()] : [];
    return {kind, coast, river, slope, intercept, curvature, shoreline, sea, riverPath, riverWidth, riverPolygon};
}

export function coastAt(terrain, y) {
    const index = Math.max(0, Math.min(terrain.shoreline.length - 2, Math.floor((y + 100) / 40)));
    const a = terrain.shoreline[index], b = terrain.shoreline[index + 1];
    return a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]);
}

export function isWater(terrain, p, margin = 0) {
    if (terrain.coast && p[0] > coastAt(terrain, p[1]) - margin * Math.hypot(1, terrain.slope - 2 * terrain.curvature * (p[1] - 600))) return true;
    return terrain.river && pathDistance(p, terrain.riverPath) < terrain.riverWidth / 2 + margin;
}

export function polygonOnLand(terrain, polygon, margin = 0) {
    if (polygon.length < 3 || polygon.some(p => isWater(terrain, p, margin))) return false;
    if (!terrain.river) return true;
    for (let i = 0; i < polygon.length; i++) {
        for (let j = 1; j < terrain.riverPath.length; j++) {
            if (segmentSegmentDistance(polygon[i], polygon[(i + 1) % polygon.length], terrain.riverPath[j - 1], terrain.riverPath[j]) < terrain.riverWidth / 2 + margin) return false;
        }
    }
    return !terrain.riverPath.some(p => inside(p, polygon));
}

function polygonNearPath(polygon, path, margin) {
    if (path.some(p => inside(p, polygon))) return true;
    for (let i = 0; i < polygon.length; i++) for (let j = 1; j < path.length; j++) {
        if (segmentSegmentDistance(polygon[i], polygon[(i + 1) % polygon.length], path[j - 1], path[j]) < margin) return true;
    }
    return false;
}

function polygonsNear(a, b, margin) {
    return a.some(p => inside(p, b)) || b.some(p => inside(p, a)) || polygonNearPath(a, [...b, b[0]], margin);
}

function fitRectangle(polygon, center, width, height) {
    let scale = 1;
    for (let i = 0; i < 24; i++) {
        const result = rectangle(center, width * scale, height * scale);
        if (result.every(p => inside(p, polygon))) return result;
        scale *= .88;
    }
    return rectangle(centroid(polygon), 2, 2);
}

function segmentPieces(terrain, a, b, wet = false, margin = 0) {
    const count = Math.max(8, Math.ceil(distance(a, b) / 5)), results = [];
    let start = null;
    let prev = isWater(terrain, a, margin) === wet;
    if (prev) start = a;
    for (let i = 1; i <= count; i++) {
        const p = lerp(a, b, i / count), hit = isWater(terrain, p, margin) === wet;
        if (hit !== prev) {
            let lo = (i - 1) / count, hi = i / count;
            for (let j = 0; j < 14; j++) {
                const m = (lo + hi) / 2;
                if ((isWater(terrain, lerp(a, b, m), margin) === wet) === prev) lo = m; else hi = m;
            }
            const crossing = lerp(a, b, (lo + hi) / 2);
            if (hit) start = crossing;
            else {
                if (start && distance(start, crossing) > 1) results.push([start, crossing]);
                start = null;
            }
        }
        prev = hit;
    }
    if (start && distance(start, b) > 1) results.push([start, b]);
    return results;
}

function makeSites(options, center, radius) {
    const rng = random(options.seed, 'districts'), n = SIZES[options.size], sites = [center];
    const minDistance = radius / Math.sqrt(n) * 1.07;
    for (let attempt = 0; sites.length < n && attempt < 20000; attempt++) {
        const angle = rng.range(0, Math.PI * 2), r = radius * Math.sqrt(rng()) * (1 + Math.sin(angle * 3 + 1) * 0.12);
        const p = add(center, [Math.cos(angle) * r, Math.sin(angle) * r * 0.89]);
        if (sites.every(q => distance(p, q) >= minDistance)) sites.push(p);
    }
    const urbanCount = sites.length;
    for (let i = 0; i < 32; i++) {
        const a = i / 32 * Math.PI * 2, r = radius * (1.46 + 0.09 * Math.sin(a * 3 + 1));
        sites.push(add(center, [Math.cos(a) * r, Math.sin(a) * r * 0.89]));
    }
    return {sites, urbanCount};
}

function makeGraph(districts) {
    const edges = new Map(), nodes = new Map(), adjacency = new Map();
    for (const district of districts) {
        district.polygon.forEach((a, i) => {
            const b = district.polygon[(i + 1) % district.polygon.length];
            const id = edgeKey(a, b), from = pointKey(a), to = pointKey(b);
            if (!edges.has(id)) edges.set(id, {id, a, b, from, to, districts: []});
            edges.get(id).districts.push(district.id);
            nodes.set(from, a);
            nodes.set(to, b);
        });
    }
    for (const e of edges.values()) {
        const cost = distance(e.a, e.b);
        if (!adjacency.has(e.from)) adjacency.set(e.from, []);
        if (!adjacency.has(e.to)) adjacency.set(e.to, []);
        adjacency.get(e.from).push({to: e.to, cost, id: e.id});
        adjacency.get(e.to).push({to: e.from, cost, id: e.id});
    }
    return {edges, nodes, adjacency};
}

function nameTown(seed) {
    const rng = random(seed, 'names');
    return rng.pick(['Ворон', 'Бел', 'Ив', 'Ясен', 'Тих', 'Стар', 'Ольх', 'Сокол', 'Камен', 'Лис']) + rng.pick(['оград', 'обор', 'овец', 'оречье', 'одоль', 'овск']);
}

const districtNames = ['Гончарная слобода', 'Старый город', 'Ткацкий посад', 'Сенной квартал', 'Медный ряд', 'Нижний посад', 'Садовый квартал', 'Купеческий двор', 'Сапожный ряд', 'Верхний посад', 'Соляной квартал', 'Кожевенный ряд'];

export function generateCity(input = {}) {
    const options = normalizeOptions(input), terrain = makeTerrain(options);
    const rng = random(options.seed, 'layout'), sizeIndex = Object.keys(SIZES).indexOf(options.size);
    const center = [terrain.coast ? 770 : 800, 590], radius = [218, 285, 344, 397][sizeIndex];
    const {sites, urbanCount} = makeSites(options, center, radius);
    const cells = voronoi(sites, FRAME);
    const districts = [];
    for (let i = 0; i < urbanCount; i++) {
        let polygon = cells[i];
        if (terrain.coast) {
            for (let j = 1; j < terrain.shoreline.length && polygon.length > 2; j++) {
                const a = terrain.shoreline[j - 1], b = terrain.shoreline[j], s = (b[0] - a[0]) / (b[1] - a[1]);
                polygon = clip(polygon, [1, -s], a[0] - s * a[1] - 5);
            }
        }
        if (polygon.length < 3 || area(polygon) < 320) continue;
        const c = centroid(polygon);
        if (isWater(terrain, c, 6) && polygon.every(p => isWater(terrain, p, 8))) continue;
        districts.push({
            id: `district-${i}`,
            polygon,
            center: c,
            kind: 'residential',
            name: districtNames[i % districtNames.length],
            shade: rng.int(0, 5)
        });
    }
    const landDistricts = districts.filter(d => {
        const core = inset(d.polygon, 14);
        return core.length > 2 && area(core) > 200 && polygonOnLand(terrain, core, 9);
    });
    const byCenter = [...landDistricts].sort((a, b) => distance(a.center, center) - distance(b.center, center));
    const market = options.market ? byCenter[0] : null;
    if (market) {
        market.kind = 'market';
        market.name = 'Торговая площадь';
    }
    const outer = landDistricts.filter(d => d !== market).sort((a, b) => (distance(b.center, center) - b.center[1] * 0.3) - (distance(a.center, center) - a.center[1] * 0.3));
    const castleDistrict = options.castle ? outer[0] : null;
    if (castleDistrict) {
        castleDistrict.kind = 'castle';
        castleDistrict.name = 'Замковый холм';
    }
    const templeDistrict = options.temple ? byCenter.find(d => d !== market && d !== castleDistrict) : null;
    if (templeDistrict) {
        templeDistrict.kind = 'temple';
        templeDistrict.name = 'Соборный двор';
    }

    const graph = makeGraph(districts), boundary = [...graph.edges.values()].filter(e => e.districts.length === 1);
    const boundaryNodes = [...new Set(boundary.flatMap(e => [e.from, e.to]))];
    const gates = [], gateCount = [3, 4, 5, 6][sizeIndex], angleOffset = rng.range(0, 1);
    for (let i = 0; i < gateCount; i++) {
        const angle = angleOffset + i / gateCount * Math.PI * 2;
        const candidates = boundaryNodes.filter(id => !isWater(terrain, graph.nodes.get(id), 27) && gates.every(g => distance(g.point, graph.nodes.get(id)) > 85));
        const target = add(center, [Math.cos(angle) * radius * 1.3, Math.sin(angle) * radius * 1.2]);
        candidates.sort((a, b) => distance(graph.nodes.get(a), target) - distance(graph.nodes.get(b), target));
        if (candidates.length) gates.push({
            id: `gate-${i}`,
            node: candidates[0],
            point: graph.nodes.get(candidates[0]),
            name: ['Восточные ворота', 'Южные ворота', 'Западные ворота', 'Северные ворота', 'Лесные ворота', 'Речные ворота'][i]
        });
    }
    const sourceDistrict = market || byCenter[0] || districts[0];
    const source = sourceDistrict.polygon.map(pointKey).find(id => graph.nodes.has(id));
    const arterialEdges = new Set();
    for (const gate of gates) shortestPath(graph.nodes, graph.adjacency, source, gate.node).forEach(id => arterialEdges.add(id));
    if (castleDistrict) {
        const target = pointKey(castleDistrict.polygon[0]);
        shortestPath(graph.nodes, graph.adjacency, source, target).forEach(id => arterialEdges.add(id));
    }
    const streets = [], bridges = [];
    for (const e of graph.edges.values()) {
        const arterial = arterialEdges.has(e.id);
        const road = {id: e.id, a: e.a, b: e.b, width: arterial ? 10 : 5.5, arterial, districts: e.districts};
        for (const [a, b] of segmentPieces(terrain, e.a, e.b, false, 0.8)) streets.push({...road, a, b});
        if (arterial) {
            for (const [a, b] of segmentPieces(terrain, e.a, e.b, true, 3)) {
                if (terrain.coast && isWater({...terrain, river: false}, lerp(a, b, 0.5))) continue;
                bridges.push({id: `bridge-${bridges.length}`, a, b, width: 12});
            }
        }
    }
    const approaches = gates.map((gate, i) => {
        const direction = sub(gate.point, center), n = Math.hypot(...direction),
            end = add(center, mul(direction, Math.max(900 / n, 2.2)));
        const bend = lerp(gate.point, end, 0.48);
        bend[0] += Math.sin(i * 3 + angleOffset) * 45;
        return {id: `approach-${i}`, points: [gate.point, bend, end]};
    });
    const walls = options.walls ? boundary.flatMap(e => segmentPieces(terrain, e.a, e.b, false, 5).map(([a, b]) => ({
        a,
        b
    }))) : [];
    const towers = options.walls ? boundaryNodes.map(id => graph.nodes.get(id)).filter(p => !isWater(terrain, p, 9) && gates.every(g => distance(g.point, p) > 18)) : [];

    const buildings = [], gardens = [];
    for (const district of districts) {
        if (['castle', 'market', 'temple'].includes(district.kind)) continue;
        const r = random(options.seed, district.id), block = inset(district.polygon, 8);
        if (block.length < 3) continue;
        const target = 370 - options.density * 2.75;
        const bb = bounds(block), courtyardRadius = r() < .38 ? Math.min(bb[2] - bb[0], bb[3] - bb[1]) * .17 : 0;
        const lots = splitLots(block, r, target);
        for (let j = 0; j < lots.length; j++) {
            const polygon = inset(lots[j], r.range(0.9, 1.7));
            if (polygon.length < 3 || area(polygon) < 32 || !polygonOnLand(terrain, polygon, 4)) continue;
            const b = bounds(polygon), slim = Math.min(b[2] - b[0], b[3] - b[1]);
            if (slim < 4.5) continue;
            if (r() < 0.08 || distance(centroid(polygon), district.center) < courtyardRadius) {
                gardens.push({polygon, district: district.id});
                continue;
            }
            buildings.push({
                id: `house-${district.id}-${j}`,
                polygon,
                district: district.id,
                shade: r.int(0, 4),
                kind: 'house'
            });
        }
    }

    const plaza = market ? {polygon: inset(market.polygon, 9), center: market.center, stalls: []} : null;
    if (plaza) {
        const r = random(options.seed, 'market');
        const inner = inset(plaza.polygon, 10);
        for (let i = 0; i < inner.length; i++) {
            const a = inner[i], b = inner[(i + 1) % inner.length], len = distance(a, b),
                angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
            for (let t = 8; t < len - 6; t += 12) {
                const polygon = rectangle(lerp(a, b, t / len), 8, 5, angle);
                if (polygonOnLand(terrain, polygon, 4)) plaza.stalls.push({polygon, shade: r.int(0, 2)});
            }
        }
    }
    let castle = null;
    if (castleDistrict) {
        const polygon = inset(castleDistrict.polygon, 10), court = inset(polygon, 13);
        const c = centroid(polygon), b = bounds(court.length ? court : polygon);
        const keep = fitRectangle(court.length ? court : polygon, c, Math.min(34, (b[2] - b[0]) * .42), Math.min(43, (b[3] - b[1]) * .48));
        castle = {
            polygon,
            court,
            keep,
            center: c,
            towers: polygon.filter(p => polygonOnLand(terrain, rectangle(p, 11, 11), 2))
        };
    }
    let temple = null;
    if (templeDistrict) {
        const c = templeDistrict.center, court = inset(templeDistrict.polygon, 10), bb = bounds(court);
        const w = Math.min(26, (bb[2] - bb[0]) * 0.35), h = Math.min(52, (bb[3] - bb[1]) * 0.6);
        const nave = fitRectangle(court, c, w, h),
            transept = fitRectangle(court, [c[0], c[1] - h * .08], w * 1.65, h * .27);
        temple = {center: c, court, nave, transept, tower: fitRectangle(court, [c[0], c[1] + h * .36], w * .7, w * .7)};
    }

    const docks = [];
    if (options.port && terrain.coast) {
        const rr = random(options.seed, 'port'),
            coastCells = districts.filter(d => d.polygon.some(p => Math.abs(p[0] - coastAt(terrain, p[1]) + 5) < 1));
        if (coastCells.length) {
            const ys = coastCells.flatMap(d => d.polygon.map(p => p[1]));
            for (let y = Math.min(...ys) + 18; y < Math.max(...ys) - 15; y += rr.range(25, 40)) {
                const x = coastAt(terrain, y);
                if (terrain.river && pathDistance([x, y], terrain.riverPath) < terrain.riverWidth / 2 + 28) continue;
                const len = rr.range(30, 67),
                    angle = Math.atan2(-(terrain.slope - 2 * terrain.curvature * (y - 600)), 1), origin = [x - 5, y];
                const polygon = rectangle(add(origin, [Math.cos(angle) * len / 2, Math.sin(angle) * len / 2]), len, 7, angle);
                docks.push({polygon, origin, tip: add(origin, [Math.cos(angle) * len, Math.sin(angle) * len]), angle});
            }
        }
    }

    const cityContains = (p, padding = 0) => districts.some(d => inside(p, d.polygon) || (padding > 0 && d.polygon.some((a, i) => pathDistance(p, [a, d.polygon[(i + 1) % d.polygon.length]]) < padding)));
    const approachDistance = p => Math.min(...approaches.map(a => pathDistance(p, a.points)));
    const fields = [], trees = [], forestPatches = [];
    const vegetation = random(options.seed, 'vegetation');
    if (options.fields) {
        for (let i = 0; i < 150; i++) {
            const c = [vegetation.range(180, 1380), vegetation.range(190, 1030)];
            const polygon = rectangle(c, vegetation.range(44, 100), vegetation.range(28, 68), vegetation.range(-0.65, 0.65));
            if (!polygonOnLand(terrain, polygon, 18) || polygon.some(p => cityContains(p, 48) || approachDistance(p) < 23) || cityContains(c, 48)) continue;
            if (approaches.some(a => polygonNearPath(polygon, a.points, 16))) continue;
            if (fields.some(f => polygonsNear(f.polygon, polygon, 12))) continue;
            fields.push({id: `field-${fields.length}`, polygon, center: c, rows: vegetation.int(5, 9)});
            if (fields.length >= 14 + sizeIndex * 3) break;
        }
    }
    if (options.forest) {
        for (const garden of gardens) {
            if (vegetation() > .65) continue;
            const point = centroid(garden.polygon);
            const radius = Math.min(4.5, pathDistance(point, [...garden.polygon, garden.polygon[0]]) * .7);
            if (radius < 1.8 || !polygonOnLand(terrain, rectangle(point, radius * 2, radius * 2), 8)) continue;
            trees.push({point, radius, kind: 'broadleaf', shade: vegetation.int(0, 3), urban: true});
        }
        for (let i = 0; i < 80 && forestPatches.length < 8; i++) {
            const angle = vegetation.range(0, Math.PI * 2), r = vegetation.range(radius + 120, radius + 300);
            const c = add(center, [Math.cos(angle) * r, Math.sin(angle) * r * 0.78]);
            if (c[0] < 95 || c[0] > 1500 || c[1] < 110 || c[1] > 1070 || isWater(terrain, c, 70)) continue;
            if (forestPatches.some(p => distance(p.center, c) < 95)) continue;
            forestPatches.push({center: c, radius: vegetation.range(65, 122)});
        }
        for (let i = 0; i < 4500; i++) {
            if (!forestPatches.length) break;
            const patch = vegetation.pick(forestPatches), a = vegetation.range(0, Math.PI * 2),
                r = Math.sqrt(vegetation()) * patch.radius;
            const p = add(patch.center, [Math.cos(a) * r, Math.sin(a) * r * 0.8]), size = vegetation.range(4.5, 8.5);
            if (p[0] < 60 || p[0] > 1540 || p[1] < 95 || p[1] > 1100 || overlapsDecoration(p, size * 1.3) || isWater(terrain, p, size + 8) || cityContains(p, 28) || approachDistance(p) < size + 9) continue;
            if (fields.some(f => inside(p, f.polygon) || distance(p, f.center) < 55) || trees.some(t => distance(t.point, p) < (t.radius + size) * 0.72)) continue;
            trees.push({
                point: p,
                radius: size,
                kind: vegetation() < 0.27 ? 'conifer' : 'broadleaf',
                shade: vegetation.int(0, 3)
            });
            if (trees.length >= 650) break;
        }
    }
    const usableArea = districts.reduce((sum, d) => sum + area(d.polygon), 0);
    const city = {
        version: VERSION,
        options,
        name: nameTown(options.seed),
        width: WIDTH,
        height: HEIGHT,
        center,
        radius,
        terrain,
        districts,
        buildings,
        gardens,
        streets,
        bridges,
        approaches,
        gates,
        walls,
        towers,
        plaza,
        castle,
        temple,
        docks,
        fields,
        trees,
        routes: gates.map(g => ({gate: g.id, edges: shortestPath(graph.nodes, graph.adjacency, source, g.node)})),
        statistics: {
            buildings: buildings.length + (castle ? 1 : 0) + (temple ? 1 : 0),
            districts: districts.length,
            bridges: bridges.length,
            trees: trees.length,
            area: Math.round(usableArea / 10000 * 100) / 100
        }
    };
    return assignDistrictWealth(city);
}

export function serializeProject(city, view = {}) {
    ensureStreetNames(city);
    return JSON.stringify({
        format: 'gradopisets',
        version: VERSION,
        options: city.options,
        name: city.name,
        districtNames: Object.fromEntries(city.districts.map(d => [d.id, d.name])),
        streetNames: Object.fromEntries(city.streets.filter(r => r.name).map(r => [r.id, r.name])),
        view, ...(city.source?.format === 'mfcg' ? {source: city.source} : {})
    }, null, 2);
}

export function parseProject(text, {name} = {}) {
    const data = JSON.parse(text);
    if (data?.type === 'FeatureCollection') return {city: importMfcgGeoJson(data, {name}), view: {}};
    if (!data || data.format !== 'gradopisets' || data.version !== VERSION || !data.options || typeof data.options !== 'object') throw new Error('Этот файл не является проектом Градописаря версии 1.');
    const city = data.source?.format === 'mfcg' ? importMfcgGeoJson(data.source.geojson, {
        name: data.name,
        options: data.options,
        reference: data.source.reference
    }) : generateCity(data.options);
    if (typeof data.name === 'string') city.name = data.name.slice(0, 80);
    for (const district of city.districts) if (typeof data.districtNames?.[district.id] === 'string') district.name = city.source?.format === 'mfcg' ? data.districtNames[district.id] : data.districtNames[district.id].slice(0, 80);
    restoreStreetNames(city, data.streetNames);
    return {city, view: data.view && typeof data.view === 'object' ? data.view : {}};
}
