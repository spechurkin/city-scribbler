import {area, centroid, inside} from '../core/geometry.js';
import {fitsFootprint, footprintFrame, MIN_FOOTPRINT_SIZE} from '../buildings/footprint-size.js';
import {metricPoint} from '../compatible/terrain.js';
import {random} from '../core/random.js';
import {dryFootprint, riverRibbon} from '../roads/bridge-network.js';
import {availableForCell} from '../compatible/available.js';
import {Sequence} from '../compatible/sequence.js';

export const LANDMARK_COUNTS = Object.freeze({marketCount: 'plaza', templeCount: 'temple'});
export const landmarkLimit = size => Math.max(1, Math.ceil(Number(size) / 10));

function frame(polygon, kind) {
    const {rect, width, height} = footprintFrame(polygon, MIN_FOOTPRINT_SIZE[kind]);
    const at = (u, v) => [rect[0][0] + (rect[1][0] - rect[0][0]) * u + (rect[3][0] - rect[0][0]) * v, rect[0][1] + (rect[1][1] - rect[0][1]) * u + (rect[3][1] - rect[0][1]) * v];
    return {at, width, height};
}

export function drawLandmark(kind, polygon) {
    const {at, width, height} = frame(polygon, kind);
    if (kind === 'temple') {
        const outline = [[.36, .12], [.64, .12], [.64, .4], [.84, .4], [.84, .6], [.64, .6], [.64, .88], [.36, .88], [.36, .6], [.16, .6], [.16, .4], [.36, .4]];
        return {
            building: outline.map(([u, v]) => at(u, v)),
            tower: [[.4, .7], [.6, .7], [.6, .85], [.4, .85]].map(([u, v]) => at(u, v))
        };
    }
    const count = Math.max(2, Math.min(8, Math.floor(width / 9))), stalls = [];
    for (const v of [.16, .7]) for (let index = 0; index < count; index++) {
        const u = .12 + .76 * index / count, w = .76 / count * .7, h = Math.min(.14, 7 / height);
        stalls.push([[u, v], [u + w, v], [u + w, v + h], [u, v + h]].map(([x, y]) => at(x, y)));
    }
    return {stalls, center: at(.5, .5), radius: Math.min(3, width * .045, height * .07)};
}

// This pass only reads the completed model and uses a separate seeded stream.
export function buildDistrictLandmarks(terrain, geometry, options) {
    const detail = geometry.experimental, regions = detail.districtRegions || detail.districts, sites = [];
    const water = [...(geometry.water.length ? [geometry.water] : []), ...geometry.rivers.map((points, i) => riverRibbon(points, geometry.riverWidths[i]))];
    const contains = (region, p) => inside(p, region.polygon) && !(region.rings || []).slice(1).some(hole => inside(p, hole));
    const regionFor = p => regions.find(region => contains(region, p));
    const add = (kind, polygon, housing, extra = {}) => {
        if (!fitsFootprint(polygon, kind) || !dryFootprint(polygon, water)) return;
        const region = regionFor(centroid(polygon));
        if (!region || !dryFootprint(polygon, sites.map(site => site.polygon))) return;
        const drawing = drawLandmark(kind, polygon);
        sites.push({kind, district: String(region.id), polygon, housing, ...drawing, ...extra});
    };
    if (options.marketCount > 0) for (const polygon of detail.squares) add('market', polygon, [], {native: true});
    if (options.templeCount > 0) for (const building of detail.specialBuildings.filter(b => b.kind === 'temple')) {
        const cell = terrain.cells.find(c => c.id === building.cell);
        const court = cell && availableForCell(terrain, cell, new Sequence(cell.seed));
        add('temple', court ? court.map(metricPoint) : building.polygon, [], {native: true, cell: building.cell});
    }

    const blocks = [];
    let house = 0;
    for (const district of terrain.districts) for (const group of district.groups) for (const [index, block] of (group.blocks || []).entries()) {
        const housing = block.lots.map(() => house++), polygon = block.polygon.map(metricPoint),
            region = regionFor(centroid(polygon));
        if (!housing.length || !region || area(polygon) < 100) continue;
        blocks.push({
            id: `${district.id}:${group.core.id}:${index}`,
            district: String(region.id),
            polygon,
            housing,
            fallback: ['castle', 'park'].includes(region.type)
        });
    }
    const used = new Set();
    for (const [kind, count] of [['market', options.marketCount], ['temple', options.templeCount]]) {
        const rng = random(options.seed, `district-landmarks:${kind}`),
            ranked = blocks.map(block => ({block, rank: rng()})).sort((a, b) => a.rank - b.rank);
        while (sites.filter(site => site.kind === kind).length < count) {
            const unused = ranked.filter(({block}) => !used.has(block.id));
            const preferred = unused.filter(({block}) => !block.fallback);
            const available = preferred.length ? preferred : unused;
            const choice = available.find(({block}) => !sites.some(site => site.kind === kind && site.district === block.district)) || available[0];
            if (!choice) break;
            const block = choice.block;
            used.add(block.id);
            add(kind, block.polygon, block.housing, {block: block.id});
        }
    }
    return {version: 1, sites};
}
