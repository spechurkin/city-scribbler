import {bounds, inside, segmentDistance} from '../core/geometry.js';
import {containsFootprint} from '../editor/building-editor.js';
import {boxesMeet, footprints} from './building-spatial.js';
import {dryFootprint} from '../roads/bridge-network.js';

export const BUILDING_PLACEMENT_RULES = Object.freeze({
    hotel: {wealth: ['mixed', 'rich']},
    bathhouse: {wealthPreference: {poor: 6, mixed: 1, rich: 1}, preferenceHint: 'Преимущественно в бедных районах.'},
    school: {preferredWealth: 'mixed', preferenceHint: 'В первую очередь в смешанных районах.'},
    lyceum: {preferredWealth: 'rich', preferenceHint: 'В первую очередь в богатых районах.'},
    gymnasium: {preferredWealth: 'rich', preferenceHint: 'В первую очередь в богатых районах.'},
    magic_school: {
        wealth: ['mixed', 'rich'],
        wealthPreference: {mixed: 1, rich: 5},
        preferenceHint: 'Преимущественно в богатых районах.'
    },
    magic_tower: {
        wealth: ['mixed', 'rich'],
        wealthPreference: {mixed: 1, rich: 5},
        preferenceHint: 'Преимущественно в богатых районах.'
    },
    korchma: {
        wealth: ['poor', 'mixed'],
        wealthPreference: {poor: 5, mixed: 1},
        preferenceHint: 'Преимущественно в бедных районах.'
    },
    tavern: {
        wealth: ['poor', 'mixed'],
        wealthPreference: {poor: .08, mixed: 1},
        preferenceHint: 'Преимущественно в смешанных районах, редко в бедных.'
    },
    inn: {
        zone: 'either',
        exteriorWeight: .35,
        preferenceHint: 'В любом районе или за городом, в том числе у окраинных дорог.'
    },
    hospital: {wealth: ['poor', 'mixed']},
    warehouse: {wealth: ['poor']},
    monastery: {zone: 'outside'},
    chapel: {zone: 'either', exteriorWeight: .1},
    temple: {zone: 'either'},
    guardhouse: {cityOnly: true, uniqueDistrict: true, avoidGardens: true},
    barracks: {nearWalls: true, preferenceHint: 'Предпочтительно у городских стен.'},
    fort: {zone: 'outside'}
});

export function placementDescription(rule) {
    if (!rule) return '';
    const parts = [];
    if (rule.fieldOnly) parts.push('Только на полях. Весь контур должен оставаться внутри одного поля.');
    if (rule.zone === 'outside') parts.push('Только за городом. Весь контур должен находиться вне городских районов и стен.');
    if (rule.avoidFields) parts.push('Не на полях.');
    if (rule.avoidGardens) parts.push('Не в садах и парках.');
    if (rule.uniqueDistrict) parts.push('В городском районе, не более одной караульни на район.');
    if (rule.wealth.length < 3) {
        const names = {poor: 'бедных', mixed: 'смешанных', rich: 'богатых'};
        parts.push(`Только в ${['rich', 'mixed', 'poor'].filter(w => rule.wealth.includes(w)).map(w => names[w]).join(' или ')} районах.`);
    }
    if (rule.preferenceHint) parts.push(rule.preferenceHint);
    return parts.join(' ') || 'Заменяет только застройку под контуром здания.';
}

export function regionMasks(regions) {
    return regions.flatMap(r => r.components || [r]).map(r => ({
        polygon: r.polygon,
        holes: (r.rings || [r.polygon]).slice(1)
    }));
}

export function urbanPlacementRegions(city) {
    return [...regionMasks(city.districts), ...(city.walls || []).filter(w => w.polygon?.length >= 3 && (!w.segments || w.segments.some(Boolean))).map(w => ({polygon: w.polygon}))];
}

export function placementRuleError(city, building, rule, {district, urban, peers = city.buildings || []} = {}) {
    const solid = footprints(building);
    district ??= city.districts.find(d => solid.every(p => containsFootprint(d, p)));
    if (rule.wealth.length < 3 && (!district || !rule.wealth.includes(district.wealth))) return placementDescription(rule);
    if (rule.zone === 'outside' && solid.some(p => !dryFootprint(p, urban || urbanPlacementRegions(city)))) return placementDescription(rule);
    if (rule.avoidFields) {
        const shapes = building.parts?.court ? [...solid, building.parts.court] : solid, box = bounds(shapes.flat()),
            fields = regionMasks(city.fields).filter(f => boxesMeet(box, bounds(f.polygon)));
        if (fields.length && shapes.some(p => !dryFootprint(p, fields))) return 'На полях можно размещать только сельскохозяйственные здания.';
    }
    if (rule.cityOnly && !district) return 'Караульня должна целиком находиться в городском районе.';
    if (rule.avoidGardens && solid.some(p => !dryFootprint(p, regionMasks([
        ...(city.gardens || []), ...city.districts.filter(d => d.kind === 'park')
    ])))) return 'Караульню нельзя размещать в садах и парках.';
    if (rule.uniqueDistrict && district && peers.some(b => b.id !== building.id && b.kind === building.kind && footprints(b).every(p => containsFootprint(district, p)))) return 'В этом районе уже есть караульня. Выберите другой район.';
    return null;
}

export function pointInRegions(point, regions) {
    return regions.some(r => inside(point, r.polygon) && !(r.holes || []).some(h => inside(point, h)));
}

export function wallDistance(city, point) {
    let nearest = Infinity;
    for (const wall of city.walls || []) if (wall.polygon) wall.polygon.forEach((a, i, polygon) => {
        if (!wall.segments || wall.segments[i]) nearest = Math.min(nearest, segmentDistance(point, a, polygon[(i + 1) % polygon.length]));
    });
    return nearest;
}

export function rankPlacementCandidates(candidates, rule, rng, usage, city) {
    const ranks = new Map(), districtCount = city.districts.length;
    return candidates.filter(c => !c.district || rule.wealth.includes(c.district.wealth)).map(candidate => {
        const id = candidate.district?.id || 'outside';
        if (!ranks.has(id)) {
            const weight = candidate.district ? rule.wealthPreference?.[candidate.district.wealth] ?? 1 : Math.max(1, districtCount * (rule.exteriorWeight || .1));
            ranks.set(id, -Math.log(Math.max(Number.MIN_VALUE, rng())) * (1 + (usage.get(id) || 0) * .1) / weight);
        }
        return {
            candidate,
            rank: ranks.get(id),
            priority: rule.preferredWealth && candidate.district?.wealth !== rule.preferredWealth ? 1 : 0,
            distance: rule.nearWalls ? wallDistance(city, candidate.point) : Infinity
        };
    }).sort((a, b) => a.priority - b.priority || (Number.isFinite(a.distance) || Number.isFinite(b.distance) ? a.distance - b.distance : 0) || a.rank - b.rank).map(r => r.candidate);
}
