import {area, bounds, centroid, distance} from '../core/geometry.js';
import {BUILDING_TYPES, containsFootprint, containsPoint, transformBuilding} from '../editor/building-editor.js';
import {footprintDryInWater, waterGeometry} from '../water/water-geometry.js';
import {boxesMeet, boxOf, buildingIndex, footprintIntersection, footprints, hitsRoad} from './building-spatial.js';
import {placementRuleError, regionMasks} from './building-placement-rules.js';

const important = b => b.custom || b.name || !['house', 'stall'].includes(b.kind);

function candidateCenters(quarter, preferred, building) {
    const [x0, y0, x1, y1] = bounds(quarter.polygon), box = boxOf(building);
    const step = Math.max(1, Math.min(box[2] - box[0], box[3] - box[1]) * .4, Math.sqrt((x1 - x0) * (y1 - y0) / 1600));
    const points = [preferred, centroid(quarter.polygon)];
    for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) {
        if (containsPoint(quarter, [x, y])) points.push([x, y]);
    }
    return points.sort((a, b) => distance(a, preferred) - distance(b, preferred));
}

export function rearrangeQuarterBuildings(city, next, {
    selected,
    changed,
    preferredCenter,
    carrySelected,
    carryAngle = 0
}) {
    const oldQuarters = city.editor.quarters, byId = new Map(next.editor.quarters.map(q => [q.id, q]));
    const ownerOf = b => {
        const center = centroid(b.polygon);
        return oldQuarters.find(q => q.id === b.quarter && containsPoint(q, center)) || oldQuarters.find(q => containsPoint(q, center));
    };
    const water = waterGeometry(next), index = buildingIndex(city.buildings), pending = [], result = new Map(),
        owners = new Map(), originalIntersections = new Map();
    const remember = (b, original = b) => {
        index.add({building: b, original, box: boxOf(b)});
        result.set(b.id, b);
    };
    const allowed = (b, q) => {
        const rule = BUILDING_TYPES[b.kind], solid = footprints(b);
        return solid.every(p => containsFootprint(q, p) && footprintDryInWater(p, water))
            && (rule.wealth.length === 3 || next.districts.some(d => rule.wealth.includes(d.wealth) && solid.every(p => containsFootprint(d, p))))
            && (!rule.fieldOnly || next.fields.some(f => containsFootprint(f, b.polygon)))
            && !placementRuleError(next, b, rule, {peers: [...result.values()]});
    };
    const blockingRoads = (b, q) => {
        const blockBox = bounds(q.polygon);
        return next.editor.water.source.roads.filter((r, i) => {
            const box = bounds(r.points), pad = r.width / 2;
            return boxesMeet(blockBox, [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad]) && !hitsRoad(b, city.editor.water.source.roads[i]);
        });
    };
    for (const b of city.buildings) {
        const owner = ownerOf(b);
        if (owner) owners.set(b.id, owner.id);
        if (!owner || !changed.has(owner.id)) {
            remember(b);
            continue;
        }
        const q = byId.get(owner.id), center = centroid(b.polygon), preferred = preferredCenter(center, owner.id);
        const roads = blockingRoads(b, q);
        const preferredBuilding = transformBuilding(b, {
            dx: preferred[0] - center[0],
            dy: preferred[1] - center[1],
            angle: owner.id === selected ? carryAngle : 0
        });
        if (carrySelected && owner.id === selected) pending.push({b, q, preferred, roads, first: preferredBuilding});
        else if (allowed(b, q) && !roads.some(r => hitsRoad(b, r))) remember(b);
        else pending.push({b, q, preferred, roads, first: preferredBuilding});
    }
    pending.sort((a, b) => Number(!!important(b.b)) - Number(!!important(a.b)) || area(b.b.polygon) - area(a.b.polygon));
    let removed = 0, moved = 0;
    for (const {b, q, preferred, roads, first} of pending) {
        const center = centroid(b.polygon);
        const fits = candidate => {
            const box = boxOf(candidate);
            if (index.near(box).some(p => {
                if (!boxesMeet(box, p.box)) return false;
                const pair = `${b.id}:${p.original.id}`;
                if (!originalIntersections.has(pair)) originalIntersections.set(pair, footprintIntersection(b, p.original));
                return footprintIntersection(candidate, p.building) > originalIntersections.get(pair) + 1e-5;
            })) return false;
            return allowed(candidate, q) && !roads.some(r => hitsRoad(candidate, r));
        };
        let candidate = [first, b].find(fits);
        if (!candidate) {
            for (const point of candidateCenters(q, preferred, b)) {
                for (const angle of [0, Math.PI / 2, -Math.PI / 12, Math.PI / 12]) {
                    const translated = transformBuilding(b, {
                        dx: point[0] - center[0],
                        dy: point[1] - center[1],
                        angle
                    });
                    if (fits(translated)) {
                        candidate = translated;
                        break;
                    }
                }
                if (candidate) break;
            }
        }
        if (!candidate) {
            if (important(b)) throw new Error(`${b.name || BUILDING_TYPES[b.kind].label}: в квартале не хватает места без изменения формы здания. Уменьшите перемещение границы.`);
            removed++;
            continue;
        }
        if (JSON.stringify(candidate.polygon) !== JSON.stringify(b.polygon)) moved++;
        remember(candidate, b);
    }
    const buildings = city.buildings.flatMap(b => {
        const placed = result.get(b.id);
        if (!placed) return [];
        const rule = BUILDING_TYPES[b.kind];
        const district = next.districts.find(d => containsPoint(d, centroid(placed.polygon)))?.id || null;
        if (rule.wealth.length < 3 && !next.districts.some(d => rule.wealth.includes(d.wealth) && footprints(placed).every(p => containsFootprint(d, p)))) throw new Error(`${rule.label}: выбранный район не соответствует ограничениям размещения.`);
        if (!changed.has(owners.get(b.id)) && district === b.district) return [placed];
        return [{...placed, ...(owners.has(b.id) ? {quarter: owners.get(b.id)} : {}), district}];
    });
    const context = {...next, buildings};
    const originalById = new Map(city.buildings.map(b => [b.id, b]));
    const changedFields = [];
    for (let i = 0; i < Math.max(city.fields.length, next.fields.length); i++) {
        if (JSON.stringify(city.fields[i]) !== JSON.stringify(next.fields[i])) {
            for (const field of [city.fields[i], next.fields[i]].filter(Boolean)) changedFields.push(bounds(regionMasks([field]).flatMap(r => r.polygon)));
        }
    }
    for (const b of buildings) {
        const original = originalById.get(b.id), rule = BUILDING_TYPES[b.kind],
            unchanged = original && JSON.stringify([original.polygon, original.parts]) === JSON.stringify([b.polygon, b.parts]),
            fieldChanged = changedFields.some(box => boxesMeet(bounds([...footprints(b), ...(b.parts?.court ? [b.parts.court] : [])].flat()), box));
        // Untouched imported geometry can already contain buildings over fields.
        const checkedRule = rule.avoidFields && unchanged && !fieldChanged ? {...rule, avoidFields: false} : rule;
        const error = placementRuleError(context, b, checkedRule);
        if (error) throw new Error(`${b.name || BUILDING_TYPES[b.kind].label}: ${error}`);
    }
    return {buildings, removed, moved};
}

