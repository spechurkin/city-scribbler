import {BUILDING_TYPES} from '../editor/building-editor.js';
import {CUSTOM_OBJECT_COUNTS} from '../buildings/custom-object-settings.js';

const point = p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e9);
const list = (values, valid) => Array.isArray(values) && values.every(valid);
const path = p => list(p, point) && p.length >= 2;
const polygon = p => list(p, point) && p.length >= 3;
const id = value => typeof value === 'string' || Number.isSafeInteger(value);
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const region = value => value && id(value.id) && polygon(value.polygon) &&
    (value.rings === undefined || list(value.rings, polygon) && value.rings.length > 0);

export function validateStructureGeometry(g) {
    const fail = () => {
        throw new Error('Некорректная геометрия слоёв проекта.');
    };
    if (!g || g.format !== 'gradopisets-structure' || typeof g.version !== 'string' || !g.experimental) fail();
    const e = g.experimental;
    if (!polygon(g.earth) || !(list(g.water, point) && (g.water.length === 0 || g.water.length >= 3)) ||
        !list(g.cells, region) || !g.cells.some(c => c.urban && !c.water) ||
        !list(g.gates, point) || !list(g.roads, path) || !list(g.rivers, path) ||
        !list(g.riverWidths, positive) || g.riverWidths.length !== g.rivers.length ||
        !list(g.walls, w => polygon(w?.polygon) && list(w.gates, point) && list(w.towers, point) && list(w.segments, v => typeof v === 'boolean') && w.segments.length === w.polygon.length) ||
        !['piers', 'planks'].every(key => list(g[key], p => path(p) && Math.hypot(p[0][0] - p.at(-1)[0], p[0][1] - p.at(-1)[1]) > 1e-7))) fail();
    if (!list(e.districts, region) || e.districtRegions !== undefined && !list(e.districtRegions, region) ||
        !['housing', 'fields', 'monuments', 'squares'].every(key => list(e[key], polygon)) ||
        !list(e.alleys, path) || !['connectedAlleys', 'localStreets', 'wallStreets', 'outerWallStreets'].every(key => e[key] === undefined || list(e[key], path)) ||
        !list(e.specialBuildings, b => b && ['castle', 'temple', 'farmhouse'].includes(b.kind) && polygon(b.polygon)) ||
        !list(e.treeCrowns, p => p === null || polygon(p))) fail();
    const tree = t => t && point(t.point) && Number.isSafeInteger(t.index) && t.index >= 0 && t.index < e.treeCrowns.length;
    if (!list(e.treeDrawings, tree) || !list(e.forests, f => f && list(f.polygons, polygon) && list(f.trees, tree)) ||
        g.riverCrossings !== undefined && (!list(g.riverCrossings, crossings => list(crossings, c => c && point(c.point) && typeof c.pedestrian === 'boolean')) || g.riverCrossings.length !== g.rivers.length)) fail();
    if (e.districtLandmarks !== undefined && (!e.districtLandmarks || !list(e.districtLandmarks.sites, s =>
        s && ['market', 'temple'].includes(s.kind) && id(s.district) && polygon(s.polygon) &&
        list(s.housing, i => Number.isSafeInteger(i) && i >= 0 && i < e.housing.length) &&
        (s.kind === 'market' ? list(s.stalls, polygon) && point(s.center) && positive(s.radius) : polygon(s.building) && polygon(s.tower))))) fail();
    if (e.customObjects !== undefined) {
        const overlay = e.customObjects, ids = new Set();
        if (!overlay || ![1, 2].includes(overlay.version) || overlay.coordinateSystem !== 'svg' || !Array.isArray(overlay.buildings) || overlay.buildings.length > 20000) fail();
        if ((overlay.version === 2 || overlay.requested !== undefined) && (!overlay.requested || typeof overlay.requested !== 'object' || Array.isArray(overlay.requested) ||
            Object.entries(overlay.requested).some(([kind, count]) => !Object.hasOwn(CUSTOM_OBJECT_COUNTS, kind) || !Number.isSafeInteger(count) || count < 0 || count > 20000))) fail();
        for (const b of overlay.buildings) {
            const rule = b && Object.hasOwn(BUILDING_TYPES, b.kind) && BUILDING_TYPES[b.kind];
            if (!rule || ['house', 'castle', 'temple', 'stall', 'special'].includes(b.kind) ||
                typeof b.id !== 'string' || !/^custom-[1-9]\d*$/.test(b.id) || ids.has(b.id) ||
                b.custom !== true || b.name !== '' || !Number.isSafeInteger(b.shade) || b.shade < 0 || b.shade > 4 ||
                !polygon(b.polygon) || !list(b.rings, polygon) || !b.parts || typeof b.parts !== 'object' || Array.isArray(b.parts) ||
                Object.entries(b.parts).some(([key, p]) => !/^[a-z_]+$/.test(key) || !polygon(p)) ||
                !(b.district === null || typeof b.district === 'string' && (e.districtRegions || e.districts).some(d => String(d.id) === b.district)) ||
                (rule.group === 'Сельское хозяйство'
                    ? b.layer !== 'fields' || !Number.isSafeInteger(b.field) || b.field < 0 || b.field >= e.fields.length
                    : b.layer !== 'buildings' || b.field !== undefined)) fail();
            ids.add(b.id);
        }
    }
    if (e.portLayout !== undefined && (!e.portLayout || e.portLayout.version !== 1 || e.portLayout.coordinateSystem !== 'svg' ||
        !list(e.portLayout.docks, d => d && path(d.points) && positive(d.width) &&
            Math.hypot(d.points[0][0] - d.points.at(-1)[0], d.points[0][1] - d.points.at(-1)[1]) > 1e-7))) fail();
}

