import {add, centroid, distance, dot, mul, sub} from '../core/geometry.js';
import {DECORATION} from './map-layout.js';
import {renderMfcgSvg} from './render-mfcg.js';
import {renderBridgeDeck, renderCompatibleSvg} from './render-compatible.js';
import {mapTextBox, renderDistrictLabels} from './label-layout.js';
import {assignDistrictWealth, buildingAppearance} from '../districts/district-wealth.js';
import {renderEditedSvg} from './render-edited.js';
import {renderEditedWater, waterLandMask} from './render-water.js';
import {waterGeometry} from '../water/water-geometry.js';
import {ensureStreetNames} from '../roads/street-names.js';
import {renderStreetSelection} from './render-street-selection.js';

export const LAYERS = {
    sea: 'Море', river: 'Река', streets: 'Улицы и мосты', buildings: 'Дома',
    port: 'Порт и причалы', castle: 'Замок', market: 'Рынок', temple: 'Храм', walls: 'Стены и башни',
    fields: 'Поля', greens: 'Сады и парки', forest: 'Леса и деревья', labels: 'Подписи'
};
export const DEFAULT_VIEW = Object.freeze({
    theme: 'atlas',
    roofs: true,
    labels: true,
    legend: true,
    layers: Object.fromEntries(Object.keys(LAYERS).map(k => [k, true]))
});
export const THEMES = {
    atlas: {
        paper: '#eee6d2',
        ink: '#4b4a3d',
        muted: '#7b7563',
        water: '#afc5c3',
        wave: '#819e9e',
        bank: '#677f7b',
        land: '#ddd7bf',
        street: '#f5efdf',
        roof: ['#c9b391', '#beaa87', '#d3bea1', '#b6a88c', '#d3c5aa'],
        roofLine: '#756b56',
        green: ['#a6b092', '#b1b99b', '#99a78b', '#bac1a3'],
        field: '#ded0a6',
        fieldLine: '#b7a779',
        wall: '#d6ceb8',
        accent: '#9e5b43',
        wealth: {rich: '#a7ad6e', mixed: '#c8af70', poor: '#c58f72'},
        wealthRoof: {
            rich: ['#a7ad6e', '#b1b777', '#9ba265', '#b8bd81', '#a3a971'],
            mixed: ['#c8af70', '#d1b97e', '#bca265', '#b1b777', '#c58f72'],
            poor: ['#c58f72', '#d19c7c', '#b58168', '#d7a587', '#be886e']
        }
    },
    ink: {
        paper: '#f8f5ed',
        ink: '#323630',
        muted: '#666b60',
        water: '#d8dfdb',
        wave: '#9caea5',
        bank: '#6f7c73',
        land: '#ecebe1',
        street: '#f8f5ed',
        roof: ['#e0ddd1', '#e8e5da', '#dad7cb', '#eeece4', '#d2d2c4'],
        roofLine: '#606254',
        green: ['#d6ddcb', '#dfe5d6', '#cdd6c0', '#e7eadd'],
        field: '#eae7d8',
        fieldLine: '#bdbca5',
        wall: '#e3e1d6',
        accent: '#775c41',
        wealth: {rich: '#979d88', mixed: '#b8b5a0', poor: '#d4c9bc'},
        wealthRoof: {
            rich: ['#979d88', '#a2a792', '#8b927e', '#a9ae99', '#939a84'],
            mixed: ['#b8b5a0', '#c3bfae', '#afac98', '#a2a792', '#d4c9bc'],
            poor: ['#d4c9bc', '#ded4c8', '#c8bcad', '#e3dacf', '#cfc3b5']
        }
    }
};
const f = n => Number(n.toFixed(2));
export const escapeXml = value => String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;'
}[c]));
export const points = polygon => polygon.map(p => p.map(f).join(',')).join(' ');
const path = poly => poly.length ? `M${poly.map(p => p.map(f).join(',')).join('L')}` : '';
const polygon = (poly, attrs = '') => `<polygon points="${points(poly)}" ${attrs}/>`;
const line = (a, b, attrs = '') => `<path d="M${a.map(f)}L${b.map(f)}" ${attrs}/>`;
const circle = (p, r, attrs = '') => `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(r)}" ${attrs}/>`;
const group = (id, content, visible, attrs = '') => `<g id="layer-${id}" data-layer="${id}" ${visible === false ? 'style="display:none"' : ''} ${attrs}>${content}</g>`;

function roofRidge(poly) {
    const c = centroid(poly);
    let longest = [poly[0], poly[1]];
    for (let i = 0; i < poly.length; i++) if (distance(poly[i], poly[(i + 1) % poly.length]) > distance(...longest)) longest = [poly[i], poly[(i + 1) % poly.length]];
    const axis = mul(sub(longest[1], longest[0]), 1 / distance(...longest));
    const normal = [-axis[1], axis[0]], offset = dot(c, normal);
    const intersections = [];
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length], da = dot(a, normal) - offset, db = dot(b, normal) - offset;
        if (da * db < 0) intersections.push(add(a, mul(sub(b, a), da / (da - db))));
    }
    if (intersections.length !== 2) return '';
    const ends = intersections.map(p => add(c, mul(sub(p, c), .54)));
    return line(ends[0], ends[1], 'opacity=".6" stroke-width=".55"') + poly.map(p => line(p, distance(p, ends[0]) < distance(p, ends[1]) ? ends[0] : ends[1], 'opacity=".42" stroke-width=".5"')).join('');
}

export function normalizeView(input = {}) {
    return {
        theme: Object.hasOwn(THEMES, input.theme) ? input.theme : 'atlas',
        roofs: input.roofs !== false,
        labels: input.labels !== false,
        legend: input.legend !== false,
        layers: Object.fromEntries(Object.keys(LAYERS).map(k => [k, input.layers?.[k] !== false]))
    };
}

export function renderMap(city, input = {}, {
    interactive = false,
    selected = null,
    selectedCastle = null,
    selectedStreet = null,
    selectedBuilding = null,
    editingVertices = false,
    mapOverlay = '',
    waterOverlay = '',
    quarterOverlay = ''
} = {}) {
    const view = normalizeView(input), theme = THEMES[view.theme], t = city.terrain, layer = view.layers;
    if (city.districts.some(d => !Object.hasOwn(theme.wealth, d.wealth))) assignDistrictWealth(city);
    if (city.source?.format === 'edited') return renderEditedSvg(city, view, theme, {
        interactive,
        selected,
        selectedBuilding,
        editingVertices,
        waterOverlay,
        quarterOverlay
    }, renderMap);
    ensureStreetNames(city);
    if (interactive && layer.streets) mapOverlay = renderStreetSelection(city, theme, selectedStreet, escapeXml) + mapOverlay;
    if (city.source?.format === 'mfcg') return renderMfcgSvg(city, view, theme, {interactive, selected, mapOverlay});
    if (city.source?.format === 'compatible') return renderCompatibleSvg(city, view, theme, {
        interactive,
        selected,
        selectedCastle,
        mapOverlay
    });
    const editedWater = city.editor?.water?.dirty ? renderEditedWater(city, view, theme, 'waves') : null;
    const masks = editedWater ? [waterLandMask(waterGeometry(city), city.viewBox, 'land-mask'), waterLandMask(waterGeometry(city).filter(r => r.kind === 'sea'), city.viewBox, 'coast-land-mask'), waterLandMask(waterGeometry(city).filter(r => r.kind === 'river'), city.viewBox, 'river-gap-mask')].join('') : `
    <mask id="land-mask"><rect width="1600" height="1200" fill="white"/>${polygon(t.sea, 'fill="black"')}${polygon(t.riverPolygon, 'fill="black"')}</mask>
    <mask id="coast-land-mask"><rect width="1600" height="1200" fill="white"/>${polygon(t.sea, 'fill="black"')}</mask>
    <mask id="river-gap-mask"><rect width="1600" height="1200" fill="white"/>${polygon(t.riverPolygon, 'fill="black"')}</mask>`;
    const defs = `<defs>
    ${masks}
    <clipPath id="water-clip">${polygon(t.sea)}${polygon(t.riverPolygon)}</clipPath>
    <pattern id="waves" width="29" height="18" patternUnits="userSpaceOnUse"><path d="M3 10q5-3 10 0t10 0" fill="none" stroke="${theme.wave}" stroke-width=".6" opacity=".4"/></pattern>
  </defs>`;
    const base = `<rect width="1600" height="1200" fill="${theme.paper}"/>`;
    const sea = editedWater ? editedWater.defs + editedWater.sea : group('sea', polygon(t.sea, `fill="${theme.water}"`) + polygon(t.sea, 'fill="url(#waves)"') + `<path d="${path(t.shoreline)}" stroke="${theme.bank}" stroke-width="2" fill="none" mask="url(#river-gap-mask)"/>`, layer.sea);
    const river = editedWater ? editedWater.river : group('river', polygon(t.riverPolygon, `fill="${theme.water}" stroke="${theme.bank}" stroke-width="1.4"`) + polygon(t.riverPolygon, 'fill="url(#waves)"'), layer.river, 'mask="url(#coast-land-mask)"');
    const districtShapes = city.districts.map(d => d.components ? `<path d="${d.rings.map(r => `${path(r)}Z`).join('')}" fill-rule="evenodd" data-wealth="${d.wealth}" fill="${theme.wealth[d.wealth]}" fill-opacity=".2"/>` : polygon(d.polygon, `data-wealth="${d.wealth}" fill="${theme.wealth[d.wealth]}" fill-opacity=".2"`)).join('');
    const districts = group('districts', districtShapes, true, 'mask="url(#land-mask)"');
    const fields = group('fields', city.fields.map(field => {
        const p = field.polygon, a = p[0], b = p[1], c = p[3];
        return polygon(p, `fill="${theme.field}" stroke="${theme.fieldLine}" stroke-width=".7"`) + Array.from({length: field.rows}, (_, i) => {
            const ratio = (i + 0.5) / field.rows;
            return line(add(a, mul(sub(c, a), ratio)), add(b, mul(sub(p[2], b), ratio)), `stroke="${theme.fieldLine}" stroke-width=".7" opacity=".8"`);
        }).join('');
    }).join(''), layer.fields, editedWater ? 'mask="url(#land-mask)"' : '');
    const gardens = city.gardens.map(g => polygon(g.polygon, `fill="${theme.green[1]}" stroke="none" opacity=".65"`)).join('');
    const trees = group('forest', city.trees.map(tree => {
        const [x, y] = tree.point, r = tree.radius, color = theme.green[tree.shade];
        if (tree.kind === 'conifer') return `<path d="M${f(x)} ${f(y - r * 1.25)}l${f(r * .83)} ${f(r * 1.9)}h${f(-r * 1.66)}Z" fill="${color}" stroke="${theme.ink}" stroke-width=".65"/>` + line([x, y], [x, y + r], `stroke="${theme.ink}" stroke-width=".6"`);
        return circle([x + .9, y + 1.5], r, `fill="${theme.ink}" opacity=".08"`) + `<path d="M${f(x - r)} ${f(y)}c${f(-r * .3)} ${f(-r * .8)} ${f(r * .6)} ${f(-r * 1.3)} ${f(r)} ${f(-r)}c${f(r * .7)} ${f(-r * .4)} ${f(r * 1.4)} ${f(r * .4)} ${f(r)} ${f(r)}c${f(r * .4)} ${f(r * .8)} ${f(-r * .7)} ${f(r * 1.2)} ${f(-r)} ${f(r * .8)}c${f(-r * .6)} ${f(r * .4)} ${f(-r * 1.3)} ${f(-r * .1)} ${f(-r)} ${f(-r * .8)}Z" fill="${color}" stroke="${theme.ink}" stroke-width=".65"/>`;
    }).join(''), layer.forest, editedWater ? 'mask="url(#land-mask)"' : '');
    const approachLines = city.approaches.map(a => `<path d="${path(a.points)}"/>`).join('');
    const streetEdges = city.streets.map(s => s.points?.length > 2 ? `<path d="${path(s.points)}" stroke-width="${s.width}"/>` : line(s.a || s.points[0], s.b || s.points.at(-1), `stroke-width="${s.width}"`)).join('');
    const bridges = city.bridges.map(b => {
        if (editedWater) return renderBridgeDeck(b, theme);
        const d = sub(b.b, b.a), len = Math.hypot(...d), n = [-d[1] / len, d[0] / len], axis = mul(d, 1 / len);
        const a = add(b.a, mul(axis, -5)), z = add(b.b, mul(axis, 5));
        return line(a, z, `stroke="${theme.ink}" stroke-width="${b.width + 3}" stroke-linecap="butt"`) + line(a, z, `stroke="${theme.street}" stroke-width="${b.width}" stroke-linecap="butt"`) + Array.from({length: Math.ceil(len / 5)}, (_, i) => {
            const p = add(a, mul(axis, i * 5));
            return line(add(p, mul(n, -b.width / 2)), add(p, mul(n, b.width / 2)), `stroke="${theme.roofLine}" stroke-width=".5" opacity=".6"`);
        }).join('');
    }).join('');
    const streets = group('streets', `<g fill="none" stroke="${theme.fieldLine}" stroke-width="7" stroke-linejoin="round" mask="url(#land-mask)">${approachLines}</g><g fill="none" stroke="${theme.street}" stroke-width="4" stroke-linejoin="round" mask="url(#land-mask)">${approachLines}</g><g stroke="${theme.street}" stroke-linecap="round">${streetEdges}</g>${bridges}`, layer.streets);
    const greens = group('greens', gardens, layer.greens, editedWater ? 'mask="url(#land-mask)"' : '');
    const appearance = buildingAppearance(city, theme);
    const buildings = group('buildings', city.buildings.map(b => {
        const {wealth, fill} = appearance(b);
        return `<g data-building-wealth="${wealth}" stroke="${theme.roofLine}" fill="${fill}" stroke-width=".75" stroke-linejoin="round">${polygon(b.polygon)}${view.roofs ? roofRidge(b.polygon) : ''}</g>`;
    }).join(''), layer.buildings);
    const plaza = city.plaza;
    const market = group('market', plaza ? polygon(plaza.polygon, `fill="${theme.street}" stroke="${theme.fieldLine}" stroke-width=".9"`) + plaza.stalls.map(s => {
        const p = s.polygon;
        return polygon(p, `fill="${[theme.accent, theme.green[0], theme.roof[2]][s.shade]}" stroke="${theme.ink}" stroke-width=".6"`) + line(add(p[0], mul(sub(p[1], p[0]), .5)), add(p[3], mul(sub(p[2], p[3]), .5)), `stroke="${theme.street}" stroke-width="1.5"`);
    }).join('') + circle(plaza.center, 7, `fill="${theme.wall}" stroke="${theme.roofLine}" stroke-width="1.2"`) + circle(plaza.center, 3.8, `fill="${theme.water}" stroke="${theme.bank}" stroke-width=".6"`) : '', layer.market, editedWater ? 'mask="url(#land-mask)"' : '');
    const castle = city.castle;
    const castleShape = castle ? polygon(castle.polygon, `fill="${theme.wall}" stroke="${theme.ink}" stroke-width="5" stroke-linejoin="round"`) + polygon(castle.court, `fill="${theme.street}" stroke="${theme.roofLine}" stroke-width=".9"`) + polygon(castle.keep, `fill="${theme.roof[1]}" stroke="${theme.ink}" stroke-width="2"`) + roofRidge(castle.keep) + castle.towers.map(p => circle(p, 6.8, `fill="${theme.wall}" stroke="${theme.ink}" stroke-width="1.6"`) + circle(p, 3.7, `fill="none" stroke="${theme.roofLine}" stroke-width=".7"`)).join('') : '';
    const castleLayer = group('castle', castleShape, layer.castle);
    const temple = city.temple;
    const templeLayer = group('temple', temple ? polygon(temple.court, `fill="${theme.street}" stroke="${theme.fieldLine}" stroke-width=".8"`) + polygon(temple.nave, `fill="${theme.roof[2]}" stroke="${theme.ink}" stroke-width="1.3"`) + polygon(temple.transept, `fill="${theme.roof[2]}" stroke="${theme.ink}" stroke-width="1.3"`) + polygon(temple.tower, `fill="${theme.wall}" stroke="${theme.ink}" stroke-width="1.3"`) + circle(temple.center, 3.2, `fill="${theme.wall}" stroke="${theme.ink}" stroke-width=".8"`) : '', layer.temple);
    const portLayer = group('port', city.docks.map(d => {
        const [a, b, c, z] = d.polygon;
        const len = distance(a, b);
        return polygon(d.polygon, `fill="${theme.roof[0]}" stroke="${theme.ink}" stroke-width="1.1"`) + Array.from({length: Math.floor(len / 5)}, (_, i) => line(add(a, mul(sub(b, a), i * 5 / len)), add(z, mul(sub(c, z), i * 5 / len)), `stroke="${theme.roofLine}" stroke-width=".6"`)).join('') + circle(a, 1.7, `fill="${theme.ink}"`) + circle(b, 1.7, `fill="${theme.ink}"`) + circle(c, 1.7, `fill="${theme.ink}"`) + circle(z, 1.7, `fill="${theme.ink}"`);
    }).join(''), layer.port);
    const wallLines = city.walls.map(w => line(w.a, w.b)).join('');
    const walls = group('walls', `<g fill="none" stroke="${theme.ink}" stroke-width="7" stroke-linejoin="round">${wallLines}</g><g fill="none" stroke="${theme.wall}" stroke-width="4" stroke-linejoin="round">${wallLines}</g>` + city.towers.map(p => circle(p, 5.5, `fill="${theme.wall}" stroke="${theme.ink}" stroke-width="1.4"`)).join('') + (city.options.walls ? city.gates.map(g => {
        const d = sub(g.point, city.center), n = Math.hypot(...d), axis = mul(d, 1 / n), cross = [-axis[1], axis[0]];
        return line(add(g.point, mul(axis, -7)), add(g.point, mul(axis, 7)), `stroke="${theme.street}" stroke-width="11"`) + [-1, 1].map(s => polygon([[-4, -4], [4, -4], [4, 4], [-4, 4]].map(p => add(g.point, add(mul(cross, s * 9 + p[0]), mul(axis, p[1])))), `fill="${theme.wall}" stroke="${theme.ink}" stroke-width="1.3"`)).join('');
    }).join('') : ''), layer.walls, editedWater ? 'mask="url(#land-mask)"' : '');
    const labelsList = city.districts.filter(d => d.kind !== 'residential' || (Number(d.id.split('-')[1]) % 9 === 0 && city.options.size !== 'village'));
    const labelObstacles = [mapTextBox(city.name, DECORATION.title.x, DECORATION.title.y, 39, 4), {
        x: DECORATION.title.x - 160,
        y: DECORATION.title.y + 15,
        width: 320,
        height: 45
    }];
    if (t.coast) labelObstacles.push({x: 1340, y: 520, width: 100, height: 300});
    const labels = group('labels', renderDistrictLabels(labelsList, {
        box: {x: 0, y: 0, width: 1600, height: 1200},
        fontSize: 12,
        strokeWidth: 3.4,
        theme,
        obstacles: labelObstacles
    }) + (t.coast ? `<text x="1390" y="670" fill="${theme.ink}" font-family="Georgia,serif" font-size="21" font-style="italic" text-anchor="middle" transform="rotate(-80 1390 670)">Прибрежное море</text>` : ''), layer.labels && view.labels);
    const title = `<g transform="translate(${DECORATION.title.x} ${DECORATION.title.y})" fill="${theme.ink}" text-anchor="middle"><text font-size="39" font-family="Georgia,'Times New Roman',serif">${escapeXml(city.name)}</text><path d="M-120 20h240" stroke="${theme.muted}" stroke-width=".7"/><text y="42" font-size="10" letter-spacing="2" font-family="Georgia,serif">ПЛАН ГОРОДА И ОКРЕСТНОСТЕЙ</text></g>`;
    const compass = `<g transform="translate(${DECORATION.compass.x} ${DECORATION.compass.y})" stroke="${theme.ink}" fill="none"><circle r="26" stroke-width=".7"/><path d="M0-37V37M-37 0H37" stroke-width=".7"/><path d="M0-29 7 9 0 4Z" fill="${theme.ink}" stroke-width=".8"/><path d="M0-29-7 9 0 4Z" fill="${theme.paper}" stroke-width=".8"/><text y="-46" text-anchor="middle" stroke="none" fill="${theme.ink}" font-family="Georgia,serif" font-size="14">С</text></g>`;
    const scale = `<g transform="translate(${DECORATION.scale.x} ${DECORATION.scale.y})" fill="${theme.ink}" font-family="Georgia,serif" font-size="10"><path d="M0 0h100M0-4v8M50-4v8M100-4v8" fill="none" stroke="${theme.ink}" stroke-width="1"/><text y="20">0</text><text x="44" y="20">50</text><text x="88" y="20">100 м</text></g>`;
    const footer = `<text x="${DECORATION.footer.x}" y="${DECORATION.footer.y}" text-anchor="end" fill="${theme.ink}" font-family="Georgia,serif" font-size="10">Градописарь · ${escapeXml(city.options.seed)} · v${city.version}</text>`;
    const hitAreas = interactive ? `<g id="district-hit-areas" fill="transparent" stroke="none" mask="url(#land-mask)">${city.districts.map(d => polygon(d.polygon, `data-district="${d.id}" class="district-hit" role="button" tabindex="0" aria-label="Открыть район ${escapeXml(d.name)}"`)).join('')}</g>` : '';
    const selection = selected ? city.districts.filter(d => d.id === selected).map(d => polygon(d.polygon, `fill="${theme.accent}" fill-opacity=".13" stroke="${theme.accent}" stroke-width="2" pointer-events="none" mask="url(#land-mask)"`)).join('') : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200" viewBox="0 0 1600 1200" role="${interactive ? 'group' : 'img'}" aria-labelledby="map-title map-desc"><title id="map-title">${escapeXml(city.name)}, карта города</title><desc id="map-desc">${city.buildings.length} домов, ${city.districts.length} районов, ${city.bridges.length} мостов. Сид ${escapeXml(city.options.seed)}.</desc>${defs}${base}${sea}${river}${fields}${districts}${greens}${trees}${streets}${buildings}${market}${templeLayer}${castleLayer}${portLayer}${walls}${hitAreas}${selection}${mapOverlay}<g id="map-annotations" pointer-events="none">${labels}${title}${compass}${scale}${footer}</g></svg>`;
}
