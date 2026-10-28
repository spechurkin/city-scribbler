import {
    area,
    bounds,
    centroid,
    cross,
    dot,
    inside,
    segmentDistance,
    segmentSegmentDistance,
    segmentsIntersect,
    sub
} from '../core/geometry.js';
import {dryFootprint, riverRibbon} from '../roads/bridge-network.js';
import {EDITOR_HOUSE_SIZE} from '../buildings/footprint-size.js';
import {createArchitecture} from '../buildings/building-architecture.js';
import {ensureEditorWater, footprintDryInWater, waterGeometry} from '../water/water-geometry.js';
import {
    affectedPopulationQuarters,
    applyPopulation,
    protectedBuilding,
    repopulateQuarters
} from '../districts/quarter-population.js';
import {footprints as buildingFootprints} from '../buildings/building-spatial.js';
import {planBuildingStreets} from '../buildings/building-streets.js';
import {visibleCityBuildings, visibleCityTrees} from '../buildings/custom-objects.js';
import {restoreEditorMarkets} from '../buildings/market-building.js';
import {
    BUILDING_PLACEMENT_RULES,
    placementDescription,
    placementRuleError
} from '../buildings/building-placement-rules.js';

const allWealth = ['poor', 'mixed', 'rich'], educated = ['mixed', 'rich'];
const type = (label, group, width, height, wealth = allWealth, shape = 'rectangle', layer = 'buildings') => ({
    label,
    group,
    width,
    height,
    wealth,
    shape,
    layer
});
export const BUILDING_TYPES = Object.freeze(Object.fromEntries(Object.entries({
    house: type('Жилой дом', 'Город', EDITOR_HOUSE_SIZE.width, EDITOR_HOUSE_SIZE.depth),
    fort: type('Военный форт', 'Военное дело', 40, 32, allWealth, 'fort'),
    barracks: type('Казармы', 'Военное дело', 30, 14),
    guardhouse: type('Караульня', 'Военное дело', 14, 10),
    parish_school: type('Церковно-приходская школа', 'Образование', 16, 11, ['poor']),
    school: type('Школа', 'Образование', 20, 14),
    lyceum: type('Лицей', 'Образование', 26, 18, educated),
    gymnasium: type('Гимназия', 'Образование', 28, 20, educated),
    college: type('Колледж', 'Образование', 32, 24, educated, 'court'),
    institute: type('Институт', 'Образование', 64, 48, educated, 'court'),
    university: type('Университет', 'Образование', 80, 64, educated, 'court'),
    magic_school: type('Школа магии', 'Магия', 60, 52, educated, 'court'),
    magic_tower: type('Башня магии', 'Магия', 24, 24, allWealth, 'tower'),
    windmill: {
        ...type('Ветряная мельница', 'Сельское хозяйство', 12, 12, allWealth, 'mill', 'fields'),
        fieldOnly: true
    },
    farmhouse: type('Фермерский дом', 'Сельское хозяйство', 16, 10),
    barn: type('Амбар', 'Сельское хозяйство', 22, 14),
    tavern: type('Таверна', 'Постой и питание', 22, 16),
    inn: type('Постоялый двор', 'Постой и питание', 30, 24, allWealth, 'court'),
    hotel: type('Гостиница', 'Постой и питание', 32, 26),
    restaurant: type('Ресторан', 'Постой и питание', 28, 22, ['rich']),
    cafe: type('Кафе', 'Постой и питание', 18, 16, educated),
    korchma: type('Корчма', 'Постой и питание', 24, 16, ['poor']),
    smithy: type('Кузница', 'Торговля и ремёсла', 18, 12),
    workshop: type('Мастерская', 'Торговля и ремёсла', 18, 12),
    warehouse: type('Склад', 'Торговля и ремёсла', 28, 18),
    guildhall: type('Дом гильдии', 'Торговля и ремёсла', 28, 20),
    bathhouse: type('Баня', 'Город', 22, 16),
    hospital: type('Лечебница', 'Город', 28, 20),
    city_hospital: type('Больница', 'Город', 36, 28, ['rich']),
    chapel: type('Часовня', 'Религия', 14, 10),
    temple: type('Храм', 'Религия', 32, 24, allWealth, 'temple', 'temple'),
    monastery: type('Монастырь', 'Религия', 40, 32, allWealth, 'court'),
    castle: type('Замок', 'Военное дело', 42, 34, allWealth, 'fort', 'castle'),
    stall: type('Рыночная лавка', 'Торговля и ремёсла', 8, 5, allWealth, 'rectangle', 'market'),
    market: type('Рынок', 'Торговля и ремёсла', 36, 24, allWealth, 'rectangle', 'market'),
    special: type('Особое здание', 'Прочие здания', 20, 16)
}).map(([kind, rule]) => [kind, {
    ...rule, ...BUILDING_PLACEMENT_RULES[kind],
    avoidFields: rule.group !== 'Сельское хозяйство'
}])));

export function buildingTypeGroups({editable = false} = {}) {
    const groups = Map.groupBy(Object.entries(BUILDING_TYPES).filter(([kind]) => !editable || kind !== 'guardhouse'), ([, value]) => value.group);
    return [...groups].sort(([a], [b]) => a.localeCompare(b, 'ru')).map(([label, entries]) => ({
        label, entries: entries.sort(([, a], [, b]) => a.label.localeCompare(b.label, 'ru'))
    }));
}

export const isEditing = city => city?.source?.format === 'edited';
export const buildingLabel = building => building.name || BUILDING_TYPES[building.kind]?.label || 'Здание';

export function placementHint(kind) {
    return placementDescription(BUILDING_TYPES[kind]);
}

export function enterEditor(original) {
    if (isEditing(original)) return structuredClone(original);
    const city = structuredClone(original), baseFormat = city.source?.format || 'legacy';
    const generated = city.customObjects;
    const extra = [...(city.special || []).filter(b => !generated || b.kind !== 'farmhouse'), ...(generated || [])];
    if (generated) {
        city.buildings = visibleCityBuildings(city);
        city.trees = visibleCityTrees(city);
        delete city.customObjects;
    }
    if (baseFormat === 'mfcg') extra.push(...city.imported.special.map(rings => ({
        kind: 'special',
        polygon: rings[0],
        rings
    })));
    if (baseFormat === 'legacy') {
        if (city.castle) extra.push({...city.castle, kind: 'castle'});
        if (city.temple) extra.push({...city.temple, polygon: city.temple.nave, kind: 'temple'});
    }
    const stalls = city.markets?.flatMap(m => m.stalls.map((polygon, i) => ({
        polygon,
        kind: 'stall',
        shade: i,
        nativeStallShade: i
    }))) || city.plaza?.stalls?.map(b => ({...b, kind: 'stall'})) || [];
    const openRing = p => p.length > 3 && p[0][0] === p.at(-1)[0] && p[0][1] === p.at(-1)[1] ? p.slice(0, -1) : p;
    city.buildings = [...city.buildings, ...extra, ...stalls].map((b, i) => ({
        id: `building-${i + 1}`, kind: b.kind === 'imported' ? 'house' : BUILDING_TYPES[b.kind] ? b.kind : 'special',
        name: b.name || '', polygon: openRing(b.polygon), rings: (b.rings || [b.polygon]).map(openRing),
        parts: {...b.parts, ...Object.fromEntries(['court', 'tower', 'keep', 'nave', 'transept'].filter(key => Array.isArray(b[key])).map(key => [key, b[key]]))},
        ...(b.custom ? {custom: true, layer: b.layer} : {}),
        ...(b.nativeStallShade !== undefined ? {nativeStallShade: b.nativeStallShade} : {}),
        ...(b.kind === 'castle' && Array.isArray(b.towers) ? {towerPoints: b.towers} : {}),
        ...(['castle', 'temple'].includes(b.kind) ? {nativeLandmark: true} : {}),
        ...(['castle', 'temple'].includes(b.kind) && Array.isArray(b.center) ? {detailCenter: b.center} : {}),
        district: b.district ?? city.districts.find(d => containsPoint(d, centroid(b.polygon)))?.id ?? null,
        shade: b.shade || 0
    }));
    city.special = [];
    city.castle = city.temple = null;
    if (city.imported) city.imported.special = [];
    const byCell = new Map((city.generatedGeometry?.experimental?.districtRegions || []).flatMap(d => (d.cellIds || []).map(id => [String(id), String(d.id)])));
    const quarters = baseFormat === 'compatible' ? (city.generatedGeometry?.cells || []).filter(c => c.urban && !c.water).map(c => ({
        id: `quarter-${c.id}`,
        district: byCell.get(String(c.id)) || null,
        polygon: c.polygon.map(([x, y]) => [x, -y])
    })) : [];
    delete city.generatedGeometry;
    city.source = {format: 'edited'};
    city.editor = {version: 1, baseFormat, nextId: city.buildings.length + 1, quarters};
    restoreEditorAppearance(city);
    restoreEditorMarkets(city);
    city.viewBox ||= {x: 0, y: 0, width: 1600, height: 1200};
    ensureEditorWater(city);
    refreshEditorStatistics(city);
    return city;
}

export function containsPoint(region, point) {
    if (Array.isArray(region.components)) return region.components.some(c => containsPoint(c, point));
    const rings = region.rings || [region.polygon];
    const inRing = ring => inside(point, ring) || ring.some((a, i) => segmentDistance(point, a, ring[(i + 1) % ring.length]) < 1e-6);
    return inRing(rings[0]) && !rings.slice(1).some(inRing);
}

export function restoreEditorAppearance(city) {
    for (const b of city.buildings.filter(b => ['castle', 'temple'].includes(b.kind))) {
        const keys = Object.keys(b.parts || {});
        if (!keys.some(key => /^(roof|spire)_/.test(key)) && (keys.some(key => ['court', 'tower', 'keep', 'nave', 'transept'].includes(key)) || city.editor.baseFormat === 'compatible' && b.kind === 'castle' && (!b.custom || b.name))) b.nativeLandmark = true;
    }
    if (city.editor.baseFormat !== 'compatible') return city;
    for (const b of city.buildings.filter(b => b.kind === 'castle' && b.nativeLandmark && !b.fortification)) {
        const candidates = city.walls.filter(w => containsFootprint(w, b.polygon)).sort((a, b) => area(a.polygon) - area(b.polygon));
        const wall = candidates.find(w => city.editor.quarters?.some(q => q.polygon.length === w.polygon.length && q.polygon.every(p => w.polygon.some(v => Math.hypot(p[0] - v[0], p[1] - v[1]) < 1e-6)))) || candidates.find(w => containsPoint(b, centroid(w.polygon)));
        if (!wall) continue;
        b.fortification = structuredClone(wall);
        city.walls = city.walls.filter(w => w !== wall);
    }
    const counts = new Map();
    for (const building of city.buildings.filter(b => b.kind === 'stall' && !b.custom)) {
        const market = city.markets?.find(m => containsPoint(m, centroid(building.polygon))),
            index = counts.get(market) || 0;
        building.nativeStallShade ??= index;
        counts.set(market, index + 1);
    }
    return city;
}

// Split each edge at boundary intersections, so concave districts and courtyards cannot be crossed.
export function containsFootprint(region, polygon) {
    if (Array.isArray(region.components)) return region.components.some(c => containsFootprint(c, polygon));
    if (!polygon.every(p => containsPoint(region, p))) return false;
    const rings = region.rings || [region.polygon];
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], d = sub(polygon[(i + 1) % polygon.length], a), ts = [0, 1];
        for (const ring of rings) for (let j = 0; j < ring.length; j++) {
            const c = ring[j], e = sub(ring[(j + 1) % ring.length], c), den = cross(d, e);
            if (Math.abs(den) < 1e-9) continue;
            const t = cross(sub(c, a), e) / den, u = cross(sub(c, a), d) / den;
            if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
        }
        ts.sort((x, y) => x - y);
        for (let j = 1; j < ts.length; j++) {
            const t = (ts[j - 1] + ts[j]) / 2;
            if (!containsPoint(region, [a[0] + d[0] * t, a[1] + d[1] * t])) return false;
        }
    }
    return !rings.slice(1).some(hole => hole.some(p => inside(p, polygon)));
}

export function validPolygon(polygon) {
    if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > 512 || !polygon.every(p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isFinite(n) && Math.abs(n) <= 1e9)) || area(polygon) < 4) return false;
    for (let i = 0; i < polygon.length; i++) {
        if (segmentDistance(polygon[i], polygon[(i + 1) % polygon.length], polygon[(i + 1) % polygon.length]) < 1e-6) return false;
        for (let j = i + 2; j < polygon.length; j++) {
            if (i === 0 && j === polygon.length - 1) continue;
            if (segmentsIntersect(polygon[i], polygon[(i + 1) % polygon.length], polygon[j], polygon[(j + 1) % polygon.length])) return false;
        }
    }
    return true;
}

function overlaps(a, b) {
    const ab = bounds(a), bb = bounds(b);
    if (ab[2] <= bb[0] || ab[0] >= bb[2] || ab[3] <= bb[1] || ab[1] >= bb[3]) return false;
    return a.some(p => inside(p, b)) || b.some(p => inside(p, a)) || a.some((p, i) => b.some((q, j) => segmentsIntersect(p, a[(i + 1) % a.length], q, b[(j + 1) % b.length])));
}

export const buildingsOverlap = (a, b) => buildingFootprints(a).some(p => buildingFootprints(b).some(q => overlaps(p, q)));

export function editorWater(city) {
    if (city.editor.water?.dirty) return waterGeometry(city).map(r => r.polygon);
    if (city.editor.baseFormat === 'mfcg') return [...city.imported.water.map(rings => rings[0]), ...city.imported.rivers.map(r => riverRibbon(r.points, r.width))];
    if (city.editor.baseFormat === 'legacy') return [city.terrain.sea, city.terrain.riverPolygon].filter(p => p?.length);
    return [...city.terrain.sea, ...city.terrain.ribbons];
}

export function validatePlacement(city, building) {
    const rule = BUILDING_TYPES[building.kind];
    if (!rule || !validPolygon(building.polygon)) return {
        ok: false,
        message: 'Контур должен быть простым многоугольником площадью от 4 м².'
    };
    const footprints = buildingFootprints(building);
    const district = city.districts.find(d => footprints.every(p => containsFootprint(d, p)));
    if (rule.fieldOnly && !city.fields.some(f => containsFootprint(f, building.polygon))) return {
        ok: false,
        message: 'Мельницу можно разместить только целиком на одном поле.'
    };
    const ruleError = placementRuleError(city, building, rule, {district});
    if (ruleError) return {ok: false, message: ruleError};
    const water = editorWater(city);
    if (footprints.some(p => city.editor.water?.dirty ? !footprintDryInWater(p, waterGeometry(city)) : !dryFootprint(p, water))) return {
        ok: false,
        message: 'Здание пересекает воду. Выберите сухой участок.'
    };
    if (city.buildings.some(b => b.id !== building.id && buildingsOverlap(building, b))) return {
        ok: false,
        message: 'Участок занят другим зданием.'
    };
    return {ok: true, district: district?.id ?? null};
}

export function createBuilding(city, kind, point) {
    const rule = BUILDING_TYPES[kind];
    if (!rule) throw new Error('Неизвестный тип здания.');
    return {
        id: `building-${city.editor.nextId}`,
        kind, ...createArchitecture(kind, point, rule.width, rule.height),
        name: '',
        shade: 0,
        custom: true
    };
}

export function snapBuildingToStreets(city, building, {distance = 12, gap = 1} = {}) {
    const unchanged = {building, snap: null};
    if (!(distance > 0)) return unchanged;
    const center = centroid(building.polygon), footprints = buildingFootprints(building);
    const radius = Math.max(...footprints.flat().map(p => Math.hypot(...sub(p, center))));
    const nearby = [];
    for (const road of city.streets || []) {
        const points = road.points || [road.a, road.b], halfWidth = road.width / 2;
        if (!Number.isFinite(halfWidth) || halfWidth < 0) continue;
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1], b = points[i];
            if (!a || !b) continue;
            const length = Math.hypot(...sub(b, a));
            if (length < 1e-6 || segmentDistance(center, a, b) > radius + halfWidth + gap + distance) continue;
            const tangent = sub(b, a).map(v => v / length);
            nearby.push({a, b, length, tangent, halfWidth});
        }
    }
    const candidates = [];
    for (const street of nearby) {
        const {a, b, tangent, length, halfWidth} = street, along = dot(sub(center, a), tangent);
        if (along < 0 || along > length) continue;
        let angle = null;
        for (let i = 0; i < building.polygon.length; i++) {
            const edge = sub(building.polygon[(i + 1) % building.polygon.length], building.polygon[i]);
            if (Math.hypot(...edge) < 1e-6) continue;
            const turn = Math.atan2(cross(edge, tangent), dot(edge, tangent));
            const nearest = Math.atan2(Math.sin(2 * turn), Math.cos(2 * turn)) / 2;
            if (angle === null || Math.abs(nearest) < Math.abs(angle)) angle = nearest;
        }
        if (angle === null) continue;
        const normal = [-tangent[1], tangent[0]], side = dot(sub(center, a), normal) < 0 ? -1 : 1;
        const outward = normal.map(v => v * side), rotated = transformBuilding(building, {angle});
        const nearest = Math.min(...buildingFootprints(rotated).flat().map(p => dot(sub(p, a), outward)));
        const shift = halfWidth + gap - nearest;
        if (Math.abs(shift) > distance) continue;
        const candidate = transformBuilding(rotated, {dx: outward[0] * shift, dy: outward[1] * shift});
        candidates.push({building: candidate, snap: {a, b}, distance: Math.abs(shift), angle: Math.abs(angle)});
    }
    candidates.sort((a, b) => a.distance - b.distance || a.angle - b.angle);
    for (const candidate of candidates) {
        const shapes = buildingFootprints(candidate.building);
        // Check neighbouring segments too, so a snap at a bend or junction cannot cover another street.
        if (nearby.some(({
                             a,
                             b,
                             halfWidth
                         }) => shapes.some(polygon => inside(a, polygon) || inside(b, polygon) || polygon.some((p, i) => segmentSegmentDistance(p, polygon[(i + 1) % polygon.length], a, b) < halfWidth + gap - 1e-6)))) continue;
        if (!validatePlacement({...city, buildings: []}, candidate.building).ok) continue;
        return {building: candidate.building, snap: candidate.snap};
    }
    return unchanged;
}

function guardhouseEditError(city, building) {
    if (building.kind !== 'guardhouse' && city.buildings.some(b => b.id === building.id && b.kind === 'guardhouse')) return 'Караульню нельзя заменить другим зданием.';
    if (building.kind !== 'guardhouse') return null;
    const original = city.buildings.find(b => b.id === building.id && b.kind === 'guardhouse');
    if (original) {
        const [dx, dy] = sub(building.polygon[0], original.polygon[0]),
            translated = transformBuilding(original, {dx, dy}),
            district = city.districts.find(d => d.id === original.district);
        const samePoints = (a, b) => a?.length === b?.length && a.every((p, i) => Math.hypot(...sub(p, b[i])) < 1e-6);
        if (district && building.name === original.name && samePoints(building.polygon, translated.polygon)
            && Object.keys(building.parts || {}).length === Object.keys(translated.parts || {}).length
            && Object.entries(translated.parts || {}).every(([key, polygon]) => samePoints(building.parts?.[key], polygon))
            && buildingFootprints(building).every(p => containsFootprint(district, p))) return null;
    }
    return 'Караульню можно только передвигать внутри её района.';
}

export function planBuildingReplacement(city, building, {
    replace = [],
    snapDistance = 0,
    regenerateStreets = true
} = {}) {
    const guardError = guardhouseEditError(city, building);
    if (guardError) return {ok: false, message: guardError};
    if (building.kind === 'guardhouse') {
        snapDistance = 0;
    }
    if (city.buildings.some(b => b.kind === 'guardhouse' && replace.includes(b.id))) return {
        ok: false, message: 'Караульня обязательна для района и не заменяется другим зданием.'
    };
    const snapped = snapDistance > 0 ? snapBuildingToStreets(city, building, {distance: snapDistance}) : {
        building,
        snap: null
    };
    building = snapped.building;
    const removed = new Set(replace);
    for (const existing of city.buildings) {
        if (existing.id === building.id) continue;
        if (buildingsOverlap(building, existing)) {
            if (protectedBuilding(existing) && !replace.includes(existing.id)) return {
                ok: false,
                message: `${buildingLabel(existing)}: установленное здание мешает размещению. Передвиньте его или удалите вручную.`,
                building,
                remove: [],
                snap: snapped.snap
            };
            removed.add(existing.id);
        }
    }
    const remaining = city.buildings.filter(b => !removed.has(b.id));
    const result = validatePlacement({...city, buildings: remaining}, building);
    let roads = null;
    if (result.ok && regenerateStreets) {
        try {
            roads = planBuildingStreets(city, [...remaining.filter(b => b.id !== building.id), {
                ...building,
                custom: true
            }]);
            roads.removed.forEach(id => removed.add(id));
        } catch (error) {
            return {ok: false, message: error.message, building, remove: [], snap: snapped.snap};
        }
    }
    return {
        ...result,
        building: {...building, district: result.district ?? null},
        remove: [...removed],
        roads,
        snap: snapped.snap
    };
}

export function planBuildingPlacement(city, kind, point, {
    targetId = null,
    snapDistance = 0,
    regenerateStreets = true
} = {}) {
    const rule = BUILDING_TYPES[kind];
    if (!rule) return {ok: false, message: 'Выберите тип здания.'};
    const target = city.buildings.find(b => b.id === targetId) || city.buildings.findLast(b => containsPoint(b, point));
    if (target) point = centroid(target.polygon);
    const district = city.districts.find(d => containsPoint(d, point));
    if (rule.wealth.length < 3 && (!district || !rule.wealth.includes(district.wealth))) return {
        ok: false,
        message: placementHint(kind)
    };
    const field = rule.fieldOnly ? city.fields.find(f => containsPoint(f, point)) : null;
    if (rule.fieldOnly && !field) return {ok: false, message: 'Мельницу можно разместить только на поле.'};
    let candidate = createBuilding(city, kind, point);
    const replace = target ? [target.id] : [];
    if (field && !containsFootprint(field, candidate.polygon)) {
        const center = centroid(field.polygon), origin = centroid(candidate.polygon);
        candidate = transformBuilding(candidate, {dx: center[0] - origin[0], dy: center[1] - origin[1]});
    }
    return planBuildingReplacement(city, candidate, {replace, snapDistance, regenerateStreets});
}

export function applyBuildingPlan(city, plan) {
    if (!isEditing(city) || !plan.ok) throw new Error(plan.message || 'Не удалось разместить здание.');
    const guardError = guardhouseEditError(city, plan.building);
    if (guardError) throw new Error(guardError);
    if (plan.remove.some(id => city.buildings.some(b => b.id === id && b.kind === 'guardhouse'))) throw new Error('Караульня обязательна для района и не удаляется.');
    const removed = new Set(plan.remove);
    const remaining = city.buildings.filter(b => !removed.has(b.id));
    const result = validatePlacement({...city, buildings: remaining}, plan.building);
    if (!result.ok) throw new Error(result.message);
    const original = city.buildings.find(b => b.id === plan.building.id);
    const changed = [...[plan.building, original, ...city.buildings.filter(b => removed.has(b.id))].filter(Boolean).flatMap(buildingFootprints), ...(plan.roads?.polygons || [])];
    const affected = affectedPopulationQuarters(city, changed);
    const index = remaining.findIndex(b => b.id === plan.building.id),
        building = {...plan.building, custom: true, district: result.district};
    const next = {...city, editor: {...city.editor}};
    if (index < 0) {
        remaining.push(building);
        next.editor.nextId++;
    } else remaining[index] = building;
    next.buildings = remaining;
    if (plan.roads) {
        next.streets = plan.roads.streets;
        next.editor.water = {
            ...city.editor.water,
            source: {...city.editor.water.source, roads: plan.roads.sourceRoads}
        };
    }
    const population = repopulateQuarters(next, city, affected, {polygons: changed});
    city.streets = next.streets;
    city.editor.water = next.editor.water;
    applyPopulation(city, population);
    refreshEditorStatistics(city);
    return building;
}

export function removeEditorBuilding(city, id) {
    const building = city.buildings.find(b => b.id === id);
    if (!isEditing(city) || !building) return;
    if (building.kind === 'guardhouse') throw new Error('Караульня обязательна для района и не удаляется.');
    const remaining = city.buildings.filter(b => b.id !== id), roads = planBuildingStreets(city, remaining),
        removed = new Set(roads.removed);
    const changed = [...buildingFootprints(building), ...roads.polygons],
        affected = affectedPopulationQuarters(city, changed);
    const next = {...city, buildings: remaining.filter(b => !removed.has(b.id)), streets: roads.streets};
    const population = repopulateQuarters(next, city, affected, {polygons: changed});
    city.streets = roads.streets;
    city.editor.water = {...city.editor.water, source: {...city.editor.water.source, roads: roads.sourceRoads}};
    applyPopulation(city, population);
    refreshEditorStatistics(city);
}

export function transformBuilding(building, {
    dx = 0,
    dy = 0,
    scaleX = 1,
    scaleY = 1,
    angle = 0,
    origin = centroid(building.polygon)
} = {}) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const transform = polygon => polygon.map(([x, y]) => {
        const px = (x - origin[0]) * scaleX, py = (y - origin[1]) * scaleY;
        return [origin[0] + dx + px * cos - py * sin, origin[1] + dy + px * sin + py * cos];
    });
    return {
        ...building,
        polygon: transform(building.polygon),
        rings: (building.rings || [building.polygon]).map(transform),
        parts: Object.fromEntries(Object.entries(building.parts || {}).map(([key, poly]) => [key, transform(poly)])),
        ...(building.fortification ? {
            fortification: {
                ...building.fortification,
                polygon: transform(building.fortification.polygon),
                towers: transform(building.fortification.towers),
                gates: transform(building.fortification.gates),
                gateOrigins: building.fortification.gateOrigins || building.fortification.gates.map(p => [...p])
            }
        } : {}),
        ...(building.towerPoints ? {towerPoints: transform(building.towerPoints)} : {}),
        ...(building.detailCenter ? {detailCenter: transform([building.detailCenter])[0]} : {})
    };
}

export function refreshEditorStatistics(city) {
    city.statistics = {...city.statistics, buildings: city.buildings.length, districts: city.districts.length};
}

export function commitBuilding(city, building) {
    if (!isEditing(city)) throw new Error('Сначала включите режим редактирования.');
    const result = validatePlacement(city, building);
    if (!result.ok) throw new Error(result.message);
    const index = city.buildings.findIndex(b => b.id === building.id);
    const next = {...building, district: result.district};
    if (index < 0) {
        city.buildings.push(next);
        city.editor.nextId++;
    } else city.buildings[index] = next;
    refreshEditorStatistics(city);
    return next;
}

export function createEditorHistory(limit = 60) {
    const undo = [], redo = [];
    const snapshot = city => structuredClone(city);
    const restore = (city, state) => {
        for (const key of Object.keys(city)) if (!Object.hasOwn(state, key)) delete city[key];
        Object.assign(city, state);
    };
    return {
        get canUndo() {
            return undo.length > 0;
        }, get canRedo() {
            return redo.length > 0;
        },
        record(city) {
            undo.push(snapshot(city));
            if (undo.length > limit) undo.shift();
            redo.length = 0;
        },
        undo(city) {
            if (!undo.length) return;
            redo.push(snapshot(city));
            restore(city, undo.pop());
        },
        redo(city) {
            if (!redo.length) return;
            undo.push(snapshot(city));
            restore(city, redo.pop());
        }
    };
}
