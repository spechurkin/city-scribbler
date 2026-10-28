import {distance, rectangle} from '../core/geometry.js';
import {footprintFrame} from './footprint-size.js';
import {renderMarketBuilding, renderMarketStall} from './market-building.js';

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const circle = (x, y, r, count = 12) => Array.from({length: count}, (_, i) => [x + Math.cos(i * Math.PI * 2 / count) * r, y + Math.sin(i * Math.PI * 2 / count) * r]);
const full = rect(0, 0, 1, 1);
const ell = [[0, 0], [1, 0], [1, .4], [.4, .4], [.4, 1], [0, 1]];
const tee = [[0, 0], [1, 0], [1, .35], [.65, .35], [.65, 1], [.35, 1], [.35, .35], [0, .35]];
const cross = [[.33, 0], [.67, 0], [.67, .33], [1, .33], [1, .67], [.67, .67], [.67, 1], [.33, 1], [.33, .67], [0, .67], [0, .33], [.33, .33]];
const ushape = [[0, 0], [1, 0], [1, 1], [.75, 1], [.75, .3], [.25, .3], [.25, 1], [0, 1]];
const plan = (outline, parts) => ({outline, parts});
const wings = {roof_hall: rect(0, 0, 1, .3), roof_west: rect(0, .3, .25, .7), roof_east: rect(.75, .3, .25, .7)};
const cloister = {...wings, roof_south: rect(.25, .75, .5, .25), court: rect(.25, .3, .5, .45)};

// Coordinates describe actual roof masses in a lot; names also select the roof treatment.
export const BUILDING_PLANS = Object.freeze({
    house: plan(full, {roof_house: full}),
    fort: plan(full, {
        court: rect(.12, .12, .76, .76),
        wall_north: rect(0, 0, 1, .12),
        wall_west: rect(0, .12, .12, .76),
        wall_east: rect(.88, .12, .12, .76),
        wall_south: rect(0, .88, 1, .12),
        battlement_nw: rect(0, 0, .2, .2),
        battlement_ne: rect(.8, 0, .2, .2),
        battlement_sw: rect(0, .8, .2, .2),
        battlement_se: rect(.8, .8, .2, .2),
        roof_barracks: rect(.22, .23, .56, .22),
        roof_armory: rect(.22, .55, .3, .2),
        gate: rect(.43, .88, .14, .12)
    }),
    barracks: plan(ushape, {...wings, porch: rect(.42, .3, .16, .12)}),
    guardhouse: plan([[0, .2], [.65, .2], [.65, 0], [1, 0], [1, 1], [0, 1]], {
        roof_guard: rect(0, .2, .65, .8),
        battlement_watch: rect(.65, 0, .35, .45),
        porch: rect(.35, .8, .22, .2)
    }),
    parish_school: plan(ell, {
        roof_class: rect(0, 0, 1, .4),
        roof_chapel: rect(0, .4, .4, .6),
        spire_bell: rect(.08, .7, .24, .24)
    }),
    school: plan(tee, {
        roof_class: rect(0, 0, 1, .35),
        roof_hall: rect(.35, .35, .3, .65),
        porch: rect(.38, .82, .24, .18)
    }),
    lyceum: plan(ushape, {...wings, colonnade: rect(.25, .3, .5, .15), garden: rect(.37, .58, .26, .23)}),
    gymnasium: plan([[0, 0], [.68, 0], [.68, .16], [1, .16], [1, .84], [.68, .84], [.68, 1], [0, 1]], {
        roof_class: rect(0, 0, .28, 1),
        roof_north: rect(.28, 0, .4, .22),
        roof_south: rect(.28, .78, .4, .22),
        roof_assembly: rect(.28, .22, .72, .56),
        lantern: rect(.55, .36, .3, .28)
    }),
    college: plan(full, {
        ...cloister,
        colonnade: rect(.25, .3, .5, .12),
        roof_gate: rect(.42, .75, .16, .25),
        garden: rect(.34, .49, .32, .15)
    }),
    institute: plan([[0, .15], [.7, .15], [.7, 0], [1, 0], [1, .55], [.7, .55], [.7, 1], [0, 1]], {
        roof_west: rect(0, .15, .22, .85),
        roof_lab: rect(.22, .15, .48, .28),
        roof_south: rect(.22, .72, .48, .28),
        dome_observatory: circle(.82, .27, .18),
        glasshouse: rect(.34, .5, .3, .16)
    }),
    university: plan(full, {
        ...cloister,
        roof_lecture: rect(.33, .3, .34, .18),
        dome_hall: circle(.5, .15, .13),
        spire_clock: rect(.43, .78, .14, .2),
        colonnade: rect(.25, .63, .5, .12)
    }),
    magic_school: plan(full, {
        ...cloister,
        spire_nw: circle(.12, .12, .12, 8),
        spire_ne: circle(.88, .12, .12, 8),
        spire_sw: circle(.12, .88, .12, 8),
        dome_orrery: circle(.52, .52, .15, 8),
        glasshouse: rect(.38, .03, .24, .2)
    }),
    magic_tower: plan(circle(.5, .5, .5, 8), {
        wall_tower: circle(.5, .5, .5, 8),
        spire_tower: circle(.5, .5, .4, 8),
        spire_turret: circle(.73, .35, .17, 8)
    }),
    windmill: plan(full, {
        roof_mill: circle(.5, .5, .22, 8),
        sail_ne: [[.52, .45], [.82, .04], [.96, .18], [.55, .48]],
        sail_se: [[.55, .52], [.96, .82], [.82, .96], [.52, .55]],
        sail_sw: [[.48, .55], [.18, .96], [.04, .82], [.45, .52]],
        sail_nw: [[.45, .48], [.04, .18], [.18, .04], [.48, .45]],
        dome_hub: circle(.5, .5, .06, 8)
    }),
    farmhouse: plan(ell, {
        roof_house: rect(0, 0, 1, .4),
        roof_shed: rect(0, .4, .4, .6),
        chimney: rect(.7, .1, .12, .18)
    }),
    barn: plan([[.12, 0], [.88, 0], [1, .18], [1, .82], [.88, 1], [.12, 1], [0, .82], [0, .18]], {
        roof_barn: [[.12, 0], [.88, 0], [1, .18], [1, .82], [.88, 1], [.12, 1], [0, .82], [0, .18]],
        lantern: rect(.28, .38, .44, .24),
        porch: rect(.85, .3, .15, .4)
    }),
    tavern: plan(ell, {
        roof_hall: rect(0, 0, 1, .4),
        roof_kitchen: rect(0, .4, .4, .6),
        awning: rect(.4, .4, .6, .25),
        chimney: rect(.08, .62, .16, .2),
        table_a: circle(.56, .83, .09, 8),
        table_b: circle(.84, .83, .09, 8)
    }),
    inn: plan(ushape, {
        roof_lodging: rect(0, 0, 1, .3),
        roof_stables: rect(0, .3, .25, .7),
        roof_rooms: rect(.75, .3, .25, .7),
        trough: rect(.28, .37, .1, .4),
        wagon: rect(.48, .55, .2, .3)
    }),
    hotel: plan([[0, 0], [.25, 0], [.25, .35], [.75, .35], [.75, 0], [1, 0], [1, 1], [.75, 1], [.75, .65], [.25, .65], [.25, 1], [0, 1]], {
        roof_rooms_west: rect(0, 0, .25, 1),
        roof_rooms_east: rect(.75, 0, .25, 1),
        roof_reception: rect(.25, .35, .5, .3),
        lantern_lobby: rect(.4, .41, .2, .18),
        porch_entrance: rect(.4, .65, .2, .15),
        garden_court: rect(.39, .08, .22, .17),
        roof_dormer_west: rect(.14, .16, .11, .16),
        roof_dormer_east: rect(.75, .16, .11, .16)
    }),
    restaurant: plan(full, {
        porch_terrace: rect(0, .65, 1, .35),
        roof_dining: rect(.08, 0, .84, .55),
        roof_kitchen: rect(.08, .55, .25, .2),
        glasshouse_winter_garden: rect(.45, .4, .47, .25),
        colonnade_entry: rect(.34, .55, .11, .2),
        garden_west: rect(0, .05, .08, .55),
        garden_east: rect(.92, .05, .08, .55),
        table_a: circle(.48, .83, .07, 12),
        table_b: circle(.7, .83, .07, 12),
        chimney: rect(.12, .55, .1, .13)
    }),
    cafe: plan([[0, 0], [.7, 0], [.7, .35], [1, .35], [1, .82], [.82, 1], [0, 1]], {
        roof_cafe: rect(0, 0, .7, .5),
        awning_front: rect(0, .5, .7, .17),
        porch_terrace: [[0, .67], [.7, .67], [.7, .35], [1, .35], [1, .82], [.82, 1], [0, 1]],
        table_a: circle(.2, .83, .08, 12),
        table_b: circle(.51, .83, .08, 12),
        canopy_parasol: circle(.84, .55, .14, 8)
    }),
    korchma: plan([[0, 0], [.8, 0], [.8, .18], [1, .18], [1, .7], [.8, .7], [.8, 1], [0, 1]], {
        roof_common_hall: rect(0, 0, .8, .7),
        roof_kitchen: rect(.8, .18, .2, .52),
        porch_benches: rect(.08, .7, .64, .3),
        table_long: rect(.17, .79, .46, .08),
        chimney: rect(.8, .22, .14, .2),
        crate_firewood: rect(.83, .76, .14, .18)
    }),
    smithy: plan(ell, {
        roof_forge: rect(0, 0, 1, .4),
        roof_store: rect(0, .4, .4, .6),
        awning: rect(.4, .4, .6, .4),
        furnace: circle(.2, .22, .15, 8),
        chimney: rect(.1, .07, .2, .23)
    }),
    workshop: plan([[0, 0], [1, 0], [1, .7], [.6, .7], [.6, 1], [0, 1]], {
        roof_shop: rect(0, 0, 1, .7),
        roof_store: rect(0, .7, .6, .3),
        lantern: rect(.2, .24, .6, .18),
        awning: rect(.6, .7, .4, .3)
    }),
    warehouse: plan([[.1, 0], [.9, 0], [1, .15], [1, .85], [.9, 1], [.1, 1], [0, .85], [0, .15]], {
        roof_store: rect(0, .06, 1, .7),
        loading: rect(.08, .76, .84, .24),
        roof_hoist: rect(.7, .42, .18, .34),
        crate_a: rect(.13, .8, .13, .15),
        crate_b: rect(.3, .8, .13, .15)
    }),
    guildhall: plan([[0, 0], [1, 0], [1, .7], [.65, .7], [.65, 1], [.35, 1], [.35, .7], [0, .7]], {
        roof_hall: rect(0, 0, 1, .7),
        roof_entry: rect(.35, .7, .3, .3),
        spire_council: rect(.72, .12, .2, .3),
        porch: rect(.4, .85, .2, .15)
    }),
    bathhouse: plan([[.15, 0], [.85, 0], [1, .2], [1, .8], [.85, 1], [.15, 1], [0, .8], [0, .2]], {
        roof_bath: full,
        dome_bath: circle(.62, .5, .28),
        dome_steam: circle(.2, .28, .12),
        pool: rect(.14, .57, .2, .22),
        chimney: rect(.13, .07, .13, .18)
    }),
    hospital: plan(cross, {
        roof_ward_north: rect(.33, 0, .34, 1),
        roof_ward_cross: rect(0, .33, 1, .34),
        lantern: rect(.38, .38, .24, .24),
        porch: rect(.38, .86, .24, .14)
    }),
    city_hospital: plan(full, {
        court: rect(.24, .28, .52, .44),
        roof_ward_north: rect(0, 0, 1, .28),
        roof_ward_west: rect(0, .28, .24, .72),
        roof_ward_east: rect(.76, .28, .24, .72),
        roof_entry: rect(.24, .72, .52, .28),
        roof_surgery: rect(.33, .28, .34, .17),
        lantern_surgery: rect(.41, .29, .18, .1),
        garden_healing: rect(.34, .5, .32, .13),
        colonnade_walk: rect(.24, .64, .52, .08),
        porch_entrance: rect(.42, .86, .16, .14)
    }),
    chapel: plan([[0, .22], [.12, .04], [.3, 0], [.48, .04], [.6, .22], [1, .22], [1, .78], [.6, .78], [.48, .96], [.3, 1], [.12, .96], [0, .78]], {
        roof_nave: rect(.2, .22, .8, .56),
        dome_apse: circle(.26, .5, .26),
        spire_bell: rect(.76, .3, .22, .4)
    }),
    temple: plan(cross, {
        roof_nave: rect(.33, 0, .34, 1),
        roof_transept: rect(0, .33, 1, .34),
        dome_crossing: circle(.5, .5, .2),
        spire_bell: rect(.4, .04, .2, .2)
    }),
    monastery: plan(full, {
        ...cloister,
        roof_church: rect(.64, .08, .29, .84),
        dome_apse: circle(.785, .17, .14),
        spire_bell: rect(.69, .69, .19, .2),
        garden: rect(.31, .37, .27, .3)
    }),
    castle: plan(full, {
        court: rect(.12, .12, .76, .76),
        wall_north: rect(0, 0, 1, .14),
        wall_west: rect(0, 0, .14, 1),
        wall_east: rect(.86, 0, .14, 1),
        wall_south: rect(0, .86, 1, .14),
        roof_keep: rect(.3, .25, .4, .44),
        spire_nw: circle(.13, .13, .13),
        spire_ne: circle(.87, .13, .13),
        spire_sw: circle(.13, .87, .13),
        spire_se: circle(.87, .87, .13),
        battlement_gate: rect(.39, .8, .22, .2)
    }),
    stall: plan(full, {awning: full}),
    market: plan(full, {
        stall_0: rect(.1, .15, .2, .15), stall_1: rect(.7, .15, .2, .15),
        stall_2: rect(.1, .7, .2, .15), stall_3: rect(.7, .7, .2, .15),
        fountain: rect(.45, .425, .1, .15)
    }),
    special: plan(tee, {
        roof_hall: rect(0, 0, 1, .35),
        roof_entry: rect(.35, .35, .3, .65),
        dome_hall: circle(.5, .18, .14)
    })
});

export function architectureInFrame(kind, frame) {
    const profile = BUILDING_PLANS[kind];
    const map = ([x, y]) => [frame[0][0] + (frame[1][0] - frame[0][0]) * x + (frame[3][0] - frame[0][0]) * y, frame[0][1] + (frame[1][1] - frame[0][1]) * x + (frame[3][1] - frame[0][1]) * y];
    const polygon = profile.outline.map(map),
        parts = Object.fromEntries(Object.entries(profile.parts).map(([key, p]) => [key, p.map(map)]));
    return {polygon, rings: [polygon], parts};
}

export function createArchitecture(kind, point, width, height) {
    const geometry = architectureInFrame(kind, rectangle(point, width, height));
    if (['house', 'stall'].includes(kind)) geometry.parts = {};
    return geometry;
}

const path = p => `M${p.map(p => p.join(',')).join('L')}Z`;
const xml = text => text.replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;'
}[c]));

export function renderBuildingArchitecture(building, view, theme) {
    if (building.kind === 'market') return renderMarketBuilding(Object.keys(building.parts || {}).length ? building : {
        ...building,
        parts: architectureInFrame('market', footprintFrame(building.polygon).rect).parts
    }, theme);
    if (!building.custom || building.nativeLandmark || building.kind === 'house' || building.kind === 'stall') return '';
    // Older projects have only a generic footprint. Fit their architecture without moving the lot.
    const parts = Object.keys(building.parts || {}).some(key => /^(roof|spire)_/.test(key)) ? building.parts : architectureInFrame(building.kind, footprintFrame(building.polygon).rect).parts;
    return renderArchitectureParts(building.kind, parts, view, theme);
}

export function renderArchitectureParts(kind, parts, view, theme) {
    const drawPart = ([key, p], i) => {
        const material = key.split('_')[0];
        if (material === 'awning') return renderMarketStall(p, i, theme);
        const fill = ['court', 'colonnade', 'loading', 'porch'].includes(material) ? theme.street : ['wall', 'battlement', 'chimney', 'furnace', 'crate', 'wagon', 'table'].includes(material) ? theme.wall : ['pool', 'trough', 'glasshouse', 'lantern'].includes(material) ? theme.water : material === 'garden' ? theme.green[0] : theme.roof[i % theme.roof.length];
        let detail = '';
        const middle = p.reduce((s, v) => [s[0] + v[0] / p.length, s[1] + v[1] / p.length], [0, 0]);
        const join = points => `<path d="M${points.map(p => p.join(',')).join('L')}" fill="none"/>`;
        if (['spire', 'dome', 'canopy'].includes(material)) {
            detail = p.filter((_, i) => i % 2 === 0).map(v => join([v, middle])).join('');
        } else if (p.length === 4) {
            const at = (x, y) => [p[0][0] + (p[1][0] - p[0][0]) * x + (p[3][0] - p[0][0]) * y, p[0][1] + (p[1][1] - p[0][1]) * x + (p[3][1] - p[0][1]) * y];
            if (['roof', 'glasshouse', 'lantern'].includes(material)) {
                detail = distance(p[0], p[1]) >= distance(p[0], p[3]) ? join([at(0, 0), at(.15, .5), at(.85, .5), at(1, 0)]) + join([at(0, 1), at(.15, .5)]) + join([at(.85, .5), at(1, 1)]) : join([at(0, 0), at(.5, .15), at(.5, .85), at(0, 1)]) + join([at(1, 0), at(.5, .15)]) + join([at(.5, .85), at(1, 1)]);
            }
            if (['awning', 'sail', 'colonnade', 'loading', 'battlement'].includes(material)) detail = [.2, .4, .6, .8].map(x => join([at(x, 0), at(x, 1)])).join('');
            if (['chimney', 'furnace'].includes(material)) detail = `<path d="${path([at(.25, .25), at(.75, .25), at(.75, .75), at(.25, .75)])}" fill="${theme.ink}"/>`;
            if (['crate', 'wagon'].includes(material)) detail = join([at(0, 0), at(1, 1)]) + join([at(1, 0), at(0, 1)]);
        }
        const structural = !['roof', 'glasshouse', 'lantern'].includes(material);
        return `<g data-building-part="${xml(key)}"><path d="${path(p)}" fill="${fill}"/>${structural || view.roofs ? `<g stroke-width=".45">${detail}</g>` : ''}</g>`;
    };
    return `<g data-building-architecture="${kind}" stroke="${theme.roofLine}" stroke-width=".7" stroke-linejoin="round">${Object.entries(parts).sort(([a], [b]) => Number(b === 'court') - Number(a === 'court')).map(drawPart).join('')}</g>`;
}

export function renderLandmarkArchitecture(building, view, theme) {
    const polygon = building.polygon;
    let edge = 0;
    for (let i = 1; i < polygon.length; i++) if (distance(polygon[i], polygon[(i + 1) % polygon.length]) > distance(polygon[edge], polygon[(edge + 1) % polygon.length])) edge = i;
    const a = polygon[edge], b = polygon[(edge + 1) % polygon.length], length = distance(a, b),
        axis = [(b[0] - a[0]) / length, (b[1] - a[1]) / length], normal = [-axis[1], axis[0]],
        project = vector => polygon.map(p => p[0] * vector[0] + p[1] * vector[1]),
        along = project(axis), across = project(normal),
        at = (x, y) => [x * axis[0] + y * normal[0], x * axis[1] + y * normal[1]],
        frame = [at(Math.min(...along), Math.min(...across)), at(Math.max(...along), Math.min(...across)), at(Math.max(...along), Math.max(...across)), at(Math.min(...along), Math.max(...across))];
    const parts = architectureInFrame(building.kind, building.kind === 'castle' ? footprintFrame(polygon).rect : frame).parts;
    if (building.kind === 'temple' && building.tower && polygon.length === 12) {
        parts.roof_nave = [polygon[0], polygon[1], polygon[6], polygon[7]];
        parts.roof_transept = [polygon[11], polygon[3], polygon[4], polygon[8]];
    }
    if (building.tower) parts.spire_bell = building.tower;
    // Fit paint to the existing silhouette without changing lots or collision geometry.
    let hash = 2166136261;
    for (const c of path(polygon)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
    const id = `landmark-paint-${building.kind}-${hash >>> 0}`;
    return `<defs><clipPath id="${id}"><path d="${path(polygon)}"/></clipPath></defs><g clip-path="url(#${id})">${renderArchitectureParts(building.kind, parts, view, theme)}</g>`;
}
