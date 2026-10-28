import {
    area,
    bounds,
    centroid,
    cross,
    distance,
    dot,
    inside,
    lerp,
    rectangle,
    segmentDistance,
    signedArea,
    sub
} from '../core/geometry.js';
import {polygonBoolean} from '../compatible/polygons.js';
import {containsPoint, isEditing, validPolygon} from './building-editor.js';
import {WEALTH_LABELS} from '../districts/district-wealth.js';
import {rearrangeQuarterBuildings} from '../buildings/quarter-building-layout.js';
import {ensureEditorWater} from '../water/water-geometry.js';
import {applyWaterChange, planWaterChange} from './water-editor.js';
import {
    affectedPopulationQuarters,
    applyPopulation,
    populationProfiles,
    repopulateQuarters
} from '../districts/quarter-population.js';
import {EDITOR_HOUSE_SIZE} from '../buildings/footprint-size.js';

const EPS = 1e-5;
const key = p => p.map(n => Math.round(n / EPS)).join(',');
const oriented = (points, positive) => {
    const p = points.length > 3 && distance(points[0], points.at(-1)) < EPS ? points.slice(0, -1) : points;
    return (signedArea(p) > 0) === positive ? p.map(p => [...p]) : p.slice().reverse().map(p => [...p]);
};
const ringsOf = q => q.rings || [q.polygon];
const metadata = ({polygon, rings, components, center, ...rest}) => rest;

export function ensureQuarterEditor(city) {
    if (city.editor.quarterEditing) {
        city.editor.quarterEditing.catalog = city.editor.quarterEditing.catalog.map(d => {
            const current = city.districts.find(c => c.id === d.id);
            return current ? structuredClone(metadata(current)) : d;
        });
        return city.editor.quarterEditing;
    }
    if (!city.editor.quarters?.length) city.editor.quarters = city.districts.flatMap((d, i) => (d.components || [d]).map((c, j) => ({
        id: `quarter-${i + 1}-${j + 1}`,
        district: d.id,
        polygon: structuredClone(c.polygon),
        rings: structuredClone(c.rings || [c.polygon])
    })));
    for (const q of city.editor.quarters) {
        if (!city.districts.some(d => d.id === q.district)) {
            const center = centroid(q.polygon);
            q.district = city.districts.find(d => containsPoint(d, center))?.id || city.districts.slice().sort((a, b) => distance(center, centroid(a.polygon)) - distance(center, centroid(b.polygon)))[0]?.id || null;
        }
        q.rings = ringsOf(q).map((p, i) => oriented(p, i === 0));
        q.polygon = q.rings[0];
    }
    // Split T-junctions so both sides of a shared boundary use the same vertices.
    const vertices = [...new Map(city.editor.quarters.flatMap(q => q.rings.flat()).map(p => [key(p), p])).values()];
    for (const q of city.editor.quarters) {
        q.rings = q.rings.map(ring => ring.flatMap((a, i) => {
            const b = ring[(i + 1) % ring.length], ab = sub(b, a), length = dot(ab, ab);
            return [a, ...vertices.filter(p => distance(p, a) > EPS && distance(p, b) > EPS && segmentDistance(p, a, b) < EPS).sort((p, r) => dot(sub(p, a), ab) / length - dot(sub(r, a), ab) / length)];
        }));
        q.polygon = q.rings[0];
    }
    city.editor.quarterEditing = {
        version: 1,
        dirty: false,
        catalog: city.districts.map(d => structuredClone(metadata(d)))
    };
    return city.editor.quarterEditing;
}

export function quarterBoundaryRings(quarters) {
    const edges = new Map();
    for (const q of quarters) for (const ring of ringsOf(q)) for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length], ak = key(a), bk = key(b);
        if (ak === bk) continue;
        const reverse = `${bk}>${ak}`;
        if (edges.has(reverse)) edges.delete(reverse);
        else edges.set(`${ak}>${bk}`, {a, b, ak, bk});
    }
    const rings = [];
    while (edges.size) {
        const first = edges.values().next().value, ring = [], start = first.ak;
        let current = first;
        while (current) {
            ring.push(current.a);
            edges.delete(`${current.ak}>${current.bk}`);
            if (current.bk === start) break;
            const incoming = sub(current.b, current.a),
                candidates = [...edges.values()].filter(e => e.ak === current.bk);
            if (!candidates.length) throw new Error('Граница района разомкнулась. Верните общую вершину на место.');
            const angle = e => {
                const v = sub(e.b, e.a);
                return Math.atan2(cross(incoming, v), dot(incoming, v));
            };
            current = candidates.reduce((best, e) => angle(e) > angle(best) ? e : best);
            if (ring.length > 100000) throw new Error('Слишком сложная граница района.');
        }
        if (ring.length >= 3 && area(ring) > EPS) rings.push(ring);
    }
    return rings.sort((a, b) => area(b) - area(a));
}

export function rebuildQuarterDistricts(quarters, catalog) {
    return catalog.flatMap(d => {
        const members = quarters.filter(q => q.district === d.id);
        if (!members.length) return [];
        const rings = quarterBoundaryRings(members), outers = rings.filter(p => signedArea(p) > 0),
            holes = rings.filter(p => signedArea(p) < 0);
        const components = outers.map(p => ({polygon: p, rings: [p, ...holes.filter(h => inside(h[0], p))]}));
        if (!components.length) throw new Error('У района не осталось допустимого контура.');
        return [{
            ...structuredClone(d),
            polygon: components[0].polygon,
            rings: components.flatMap(c => c.rings),
            components
        }];
    });
}

export function deformQuarterPoint(point, before, after) {
    const vectors = before.map(p => sub(p, point)), lengths = vectors.map(v => Math.hypot(...v));
    const vertex = lengths.findIndex(r => r < EPS);
    if (vertex >= 0) return [...after[vertex]];
    for (let i = 0; i < before.length; i++) {
        const j = (i + 1) % before.length;
        if (segmentDistance(point, before[i], before[j]) < EPS) return lerp(after[i], after[j], distance(point, before[i]) / distance(before[i], before[j]));
    }
    const tangents = vectors.map((v, i) => {
        const next = vectors[(i + 1) % vectors.length], angle = Math.atan2(cross(v, next), dot(v, next));
        return Math.tan(angle / 2);
    });
    let weights = lengths.map((r, i) => (tangents[(i + lengths.length - 1) % lengths.length] + tangents[i]) / r),
        total = weights.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(total) || Math.abs(total) < EPS) {
        weights = lengths.map(r => 1 / r);
        total = weights.reduce((a, b) => a + b, 0);
    }
    return after.reduce((p, q, i) => [p[0] + q[0] * weights[i] / total, p[1] + q[1] * weights[i] / total], [0, 0]);
}

const project = (point, a, b) => {
    const ab = sub(b, a), length = dot(ab, ab);
    return lerp(a, b, length ? Math.max(0, Math.min(1, dot(sub(point, a), ab) / length)) : 0);
};

export function changeQuarterBoundary(city, id, change) {
    ensureQuarterEditor(city);
    const quarters = structuredClone(city.editor.quarters), source = city.editor.quarters.find(q => q.id === id),
        deformations = new Map();
    if (!source) throw new Error('Квартал не найден.');
    const ringIndex = change.ring || 0, ring = ringsOf(source)[ringIndex];
    if (!ring) throw new Error('Граница квартала не найдена.');
    let replacements = new Map();
    if (change.type === 'move') replacements.set(key(ring[change.index]), change.point);
    if (change.type === 'transform') {
        if (change.rings) ringsOf(source).forEach((r, ri) => r.forEach((p, i) => replacements.set(key(p), change.rings[ri][i])));
        else ring.forEach((p, i) => replacements.set(key(p), change.points[i]));
    }
    for (const q of quarters) {
        const before = structuredClone(ringsOf(q)), cages = before.map(p => p.map(p => [...p]));
        if (change.type === 'move' || change.type === 'transform') q.rings = before.map(p => p.map(p => replacements.has(key(p)) ? [...replacements.get(key(p))] : p));
        else if (change.type === 'insert') {
            const a = ring[change.index], b = ring[(change.index + 1) % ring.length],
                oldPoint = project(change.point, a, b);
            q.rings = before.map((p, ri) => p.flatMap((v, i) => {
                const next = p[(i + 1) % p.length];
                if (key(v) === key(a) && key(next) === key(b) || key(v) === key(b) && key(next) === key(a)) {
                    cages[ri].splice(i + 1, 0, oldPoint);
                    return [v, [...change.point]];
                }
                return [v];
            }));
        } else if (change.type === 'delete') {
            const target = ring[change.index];
            q.rings = before.map((p, ri) => {
                const at = p.findIndex(v => key(v) === key(target));
                if (at < 0) return p;
                if (p.length <= 3) throw new Error('Эта вершина удерживает треугольный квартал. Её можно передвинуть, но нельзя удалить.');
                const afterPoint = project(p[at], p[(at + p.length - 1) % p.length], p[(at + 1) % p.length]);
                const result = p.filter((_, i) => i !== at);
                // Collapsing the node onto the new edge keeps point interpolation continuous.
                const cageAfter = p.map((v, i) => i === at ? afterPoint : v);
                if (ri === 0) deformations.set(q.id, {before: cages[ri], after: cageAfter});
                return result;
            });
        } else q.rings = before;
        q.polygon = q.rings[0];
        if (change.type === 'district' && q.id === id) q.district = change.district;
        if (!deformations.has(q.id) && JSON.stringify(cages[0]) !== JSON.stringify(q.polygon)) deformations.set(q.id, {
            before: cages[0],
            after: q.polygon
        });
    }
    return {quarters, deformations};
}

function ringOverlap(a, b) {
    const x = bounds(a), y = bounds(b);
    if (Math.min(x[2], y[2]) - Math.max(x[0], y[0]) < EPS || Math.min(x[3], y[3]) - Math.max(x[1], y[1]) < EPS) return 0;
    return polygonBoolean(a, b, 'intersection').reduce((sum, p) => sum + signedArea(p), 0);
}

function overlap(a, b) {
    return ringsOf(a).reduce((sum, left, i) => sum + ringsOf(b).reduce((n, right, j) => n + (i ? -1 : 1) * (j ? -1 : 1) * ringOverlap(left, right), 0), 0);
}

export function planQuarterChange(city, id, change) {
    try {
        const state = ensureQuarterEditor(city), {quarters, deformations} = changeQuarterBoundary(city, id, change);
        const districtIds = new Set(state.catalog.map(d => d.id));
        for (const q of quarters) if (!districtIds.has(q.district) || ringsOf(q).some(p => !validPolygon(p))) throw new Error('Границы квартала пересекаются или площадь слишком мала.');
        for (let i = 0; i < quarters.length; i++) for (let j = i + 1; j < quarters.length; j++) if ((deformations.has(quarters[i].id) || deformations.has(quarters[j].id)) && overlap(quarters[i], quarters[j]) - overlap(city.editor.quarters[i], city.editor.quarters[j]) > .01) throw new Error('Кварталы пересекаются. Передвиньте границу ближе к исходному положению.');
        const next = structuredClone(city);
        next.editor.quarters = quarters;
        next.editor.quarterEditing.dirty = true;
        next.districts = rebuildQuarterDistricts(quarters, state.catalog);
        const oldById = new Map(city.editor.quarters.map(q => [q.id, q]));
        const deform = (point, owner = null) => {
            const old = owner ? oldById.get(owner) : city.editor.quarters.find(q => deformations.has(q.id) && containsPoint(q, point));
            const cage = old && deformations.get(old.id);
            return cage ? deformQuarterPoint(point, cage.before, cage.after) : [...point];
        };
        const shape = (object, owner = null) => ({
            ...object,
            ...(object.polygon ? {polygon: object.polygon.map(p => deform(p, owner))} : {}),
            ...(object.rings ? {rings: object.rings.map(r => r.map(p => deform(p, owner)))} : {}),
            ...(object.points ? {points: object.points.map(p => deform(p, owner))} : {}),
            ...(object.originalPoints ? {originalPoints: object.originalPoints.map(p => deform(p, owner))} : {}),
            ...Object.fromEntries(['a', 'b', 'center', 'origin', 'tip', 'point', 'detailCenter'].filter(key => Array.isArray(object[key])).map(key => [key, deform(object[key], owner)]))
        });
        next.fields = city.fields.map(f => shape(f));
        next.gardens = city.gardens.map(g => shape(g));
        next.trees = city.trees.map(t => shape(t));
        next.walls = city.walls.map(w => ({...shape(w), ...(w.towers ? {towers: w.towers.map(p => deform(p))} : {}), ...(w.gates ? {gates: w.gates.map(p => deform(p))} : {})}));
        next.gates = city.gates.map(g => Array.isArray(g) ? deform(g) : shape(g));
        if (city.towers) next.towers = city.towers.map(p => deform(p));
        if (city.markets) next.markets = city.markets.map(m => shape(m));
        if (city.squares) next.squares = city.squares.map(p => p.map(p => deform(p)));
        if (city.monuments) next.monuments = city.monuments.map(p => p.map(p => deform(p)));
        if (city.plaza) next.plaza = shape(city.plaza);
        if (city.imported) {
            for (const key of ['greens', 'squares', 'wallPolygons']) next.imported[key] = key === 'wallPolygons' ? city.imported[key].map(w => shape(w)) : city.imported[key].map(rings => rings.map(r => r.map(p => deform(p))));
        }
        const water = ensureEditorWater(next);
        water.source.roads = water.source.roads.map(r => shape(r));
        water.source.footbridges = water.source.footbridges.map(p => p.map(p => deform(p)));
        water.source.docks = water.source.docks.map(d => shape(d));
        const changed = new Set(quarters.filter(q => JSON.stringify(q.rings) !== JSON.stringify(oldById.get(q.id).rings)).map(q => q.id));
        const changedPolygons = [];
        if (change.type === 'insert' || change.type === 'delete') {
            const ring = ringsOf(oldById.get(id))[change.ring || 0], i = change.index;
            changedPolygons.push(change.type === 'insert' ? [ring[i], ring[(i + 1) % ring.length], change.point] : [ring[(i + ring.length - 1) % ring.length], ring[i], ring[(i + 1) % ring.length]]);
        } else for (const q of quarters.filter(q => changed.has(q.id))) ringsOf(q).forEach((ring, ri) => {
            const old = ringsOf(oldById.get(q.id))[ri];
            ring.forEach((p, i) => {
                const j = (i + 1) % ring.length;
                changedPolygons.push([old[i], old[j], ring[j]], [old[i], ring[j], p]);
            });
        });
        for (let ri = 0; ri < water.source.roads.length; ri++) {
            const road = water.source.roads[ri], old = city.editor.water.source.roads[ri];
            for (let i = 1; i < road.points.length; i++) if (distance(road.points[i - 1], old.points[i - 1]) > EPS || distance(road.points[i], old.points[i]) > EPS) {
                for (const points of [road.points, old.points]) {
                    const a = points[i - 1], b = points[i], d = sub(b, a);
                    changedPolygons.push(rectangle(lerp(a, b, .5), distance(a, b), road.width + EDITOR_HOUSE_SIZE.depth * 2, Math.atan2(d[1], d[0])));
                }
            }
        }
        const refill = changedPolygons.filter(p => area(p) > EPS);
        const affected = new Set([...affectedPopulationQuarters(city, refill), ...affectedPopulationQuarters(next, refill)]);
        const profiles = populationProfiles(city);
        next.editor.quarters = quarters.map(q => ({...q, population: profiles.find(p => p.id === q.id).population}));
        let carryAngle = 0;
        const cage = deformations.get(id);
        const carrySelected = change.type === 'transform' && cage && cage.before.every((p, i) => Math.abs(distance(p, cage.before[0]) - distance(cage.after[i], cage.after[0])) < EPS && Math.abs(distance(p, cage.before[(i + 1) % cage.before.length]) - distance(cage.after[i], cage.after[(i + 1) % cage.after.length])) < EPS);
        if (carrySelected) {
            const i = cage.before.reduce((best, p, j) => distance(p, cage.before[(j + 1) % cage.before.length]) > distance(cage.before[best], cage.before[(best + 1) % cage.before.length]) ? j : best, 0);
            const before = sub(cage.before[(i + 1) % cage.before.length], cage.before[i]),
                after = sub(cage.after[(i + 1) % cage.after.length], cage.after[i]);
            carryAngle = Math.atan2(cross(before, after), dot(before, after));
        }
        const layout = rearrangeQuarterBuildings(city, next, {
            selected: id,
            changed,
            preferredCenter: deform,
            carrySelected,
            carryAngle
        });
        next.buildings = layout.buildings.map(b => b.fortification?.gateOrigins ? {
            ...b,
            fortification: {...b.fortification, gateOrigins: b.fortification.gateOrigins.map(p => deform(p))}
        } : b);
        for (const district of city.districts) {
            const previous = city.buildings.filter(b => b.kind === 'guardhouse' && b.district === district.id).length;
            const current = next.buildings.filter(b => b.kind === 'guardhouse' && b.district === district.id).length;
            if (previous !== current) throw new Error('В каждом районе должна оставаться своя караульня. Сначала передвиньте её в другой квартал этого района.');
        }
        const waterPlan = planWaterChange(next, water.bodies, {repopulate: false});
        if (!waterPlan.ok) throw new Error(waterPlan.message);
        applyWaterChange(next, waterPlan);
        const population = repopulateQuarters(next, city, affected, {polygons: refill});
        applyPopulation(next, population);
        next.statistics = {...next.statistics, districts: next.districts.length};
        return {
            ok: true,
            city: next,
            removed: waterPlan.removed,
            rearranged: layout.moved,
            removedHouses: layout.removed,
            populated: population.added,
            affected: deformations.size
        };
    } catch (error) {
        return {ok: false, message: error.message};
    }
}

export function planDistrictWealthChange(city, id, wealth) {
    if (!isEditing(city)) return {ok: false, message: 'Тип района можно менять только в режиме редактирования.'};
    if (!Object.hasOwn(WEALTH_LABELS, wealth)) return {ok: false, message: 'Неизвестный тип района.'};
    const district = city.districts.find(d => d.id === id);
    if (!district) return {ok: false, message: 'Район не найден.'};
    const next = structuredClone(city);
    next.districts.find(d => d.id === id).wealth = wealth;
    if (next.editor.quarterEditing) {
        const entry = next.editor.quarterEditing.catalog.find(d => d.id === id);
        if (entry) entry.wealth = wealth;
    }
    return {ok: true, city: next};
}

export function applyQuarterChange(city, plan) {
    if (!plan.ok) throw new Error(plan.message);
    Object.assign(city, plan.city);
}
