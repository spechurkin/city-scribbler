import {add, centroid, distance, mul, sub} from '../core/geometry.js';
import {mapTextBox, renderDistrictLabels} from './label-layout.js';
import {buildingAppearance} from '../districts/district-wealth.js';
import {renderEditedWater, waterLandMask} from './render-water.js';
import {waterGeometry} from '../water/water-geometry.js';
import {castleMapObjects, mapDistricts} from '../map/map-selection.js';
import {visibleCityBuildings, visibleCityTrees} from '../buildings/custom-objects.js';
import {BUILDING_TYPES} from '../editor/building-editor.js';
import {renderBuildingArchitecture, renderLandmarkArchitecture} from '../buildings/building-architecture.js';
import {renderMarketStall} from '../buildings/market-building.js';

const escape = value => String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;'
}[c]));
const coordinate = n => Math.round(n * 1000) / 1000;
const path = p => p.length ? `M${p.map(p => p.join(',')).join('L')}` : '';
const compactPath = p => path(p.map(p => p.map(coordinate)));
const poly = (p, a = '') => `<path d="${path(p)}Z" ${a}/>`;
const districtPoly = (district, attrs = '') => `<path d="${(district.rings || [district.polygon]).map(ring => `${path(ring)}Z`).join('')}" fill-rule="evenodd" ${attrs}/>`;
const line = (p, a = '') => `<path d="${path(p)}" ${a}/>`;
const circle = (p, r, a = '') => `<circle cx="${p[0]}" cy="${p[1]}" r="${r}" ${a}/>`;

export function renderBridgeDeck(bridge, theme) {
    const {a, b, width} = bridge, len = distance(a, b), axis = mul(sub(b, a), 1 / len), normal = [-axis[1], axis[0]],
        half = mul(normal, width / 2);
    const projections = bridge.polygon.map(p => (p[0] - a[0]) * axis[0] + (p[1] - a[1]) * axis[1]),
        start = Math.min(...projections), span = Math.max(...projections) - start;
    const planks = Array.from({length: Math.ceil(span / 2.5)}, (_, i) => {
        const p = add(a, mul(axis, start + (i + .5) * span / Math.ceil(span / 2.5)));
        return line([sub(p, half), add(p, half)], `stroke="${theme.roofLine}" stroke-width=".45"`);
    }).join('');
    const rails = (bridge.rails || [[add(a, half), add(b, half)], [sub(a, half), sub(b, half)]]).map(points => line(points, `stroke="${theme.ink}" stroke-width="1.1"`)).join('');
    return `<g ${bridge.pier ? 'data-pier="true"' : `data-bridge="true" data-pedestrian="${bridge.pedestrian}"`}><defs><clipPath id="deck-${bridge.id}">${poly(bridge.polygon)}</clipPath></defs>${poly(bridge.polygon, `fill="${theme.street}"`)}<g clip-path="url(#deck-${bridge.id})">${planks}${rails}</g></g>`;
}

function roof(poly) {
    const c = centroid(poly);
    let edge = 0;
    for (let i = 1; i < poly.length; i++) if (distance(poly[i], poly[(i + 1) % poly.length]) > distance(poly[edge], poly[(edge + 1) % poly.length])) edge = i;
    const a = poly[edge], b = poly[(edge + 1) % poly.length], axis = mul(sub(b, a), 1 / (distance(a, b) || 1));
    const projections = poly.map(p => (p[0] - c[0]) * axis[0] + (p[1] - c[1]) * axis[1]);
    const ends = [add(c, mul(axis, Math.min(...projections) * .45)), add(c, mul(axis, Math.max(...projections) * .45))];
    return compactPath(ends);
}

export function renderHousing(buildings, appearance, view, theme) {
    const batches = new Map(), result = [];
    const flush = batch => {
        result.push(`<g data-building-wealth="${batch.wealth}" fill="${batch.fill}" stroke="${theme.roofLine}" stroke-width=".65" stroke-linejoin="round"><path d="${batch.bodies.join('')}"/>${view.roofs ? `<path d="${batch.roofs.join('')}" fill="none" stroke-width=".5" opacity=".55"/>` : ''}</g>`);
        batch.bodies = [];
        batch.roofs = [];
    };
    for (const building of buildings) {
        const {wealth, fill} = appearance(building), key = `${wealth}:${fill}`;
        if (!batches.has(key)) batches.set(key, {wealth, fill, bodies: [], roofs: []});
        const batch = batches.get(key);
        batch.bodies.push(`${compactPath(building.polygon)}Z`);
        if (view.roofs) batch.roofs.push(roof(building.polygon));
        if (batch.bodies.length === 256) flush(batch);
    }
    for (const batch of batches.values()) if (batch.bodies.length) flush(batch);
    return result.join('');
}

export function renderCompatibleLandmark(building, view, theme) {
    return `${building.court ? poly(building.court, `fill="${theme.street}"`) : ''}<g fill="${theme.roof[1]}" stroke="${theme.roofLine}" stroke-width=".7" stroke-linejoin="round">${poly(building.polygon)}${renderLandmarkArchitecture(building, view, theme)}</g>`;
}

export function renderCompatibleWall(wall, theme) {
    const segments = wall.polygon.flatMap((p, i) => wall.segments[i] ? [line([p, wall.polygon[(i + 1) % wall.polygon.length]])] : []).join('');
    return `<g fill="none" stroke-linejoin="round"><g stroke="${theme.ink}" stroke-width="4.8">${segments}</g><g stroke="${theme.wall}" stroke-width="2.8">${segments}</g></g>` + wall.towers.map(p => circle(p, 3.7, `fill="${theme.wall}" stroke="${theme.ink}" stroke-width=".8"`)).join('') + wall.gates.map(p => circle(p, 5, `fill="${theme.wall}" stroke="${theme.ink}" stroke-width="1"`)).join('');
}

export function renderCompatibleStall(polygon, shade, theme) {
    return renderMarketStall(polygon, shade, theme);
}

export function renderCompatibleSvg(city, view, theme, {
    interactive = false,
    selected = null,
    selectedCastle = null,
    mapOverlay = ''
} = {}) {
    const box = city.viewBox, k = box.width / 1600, l = view.layers;
    const group = (id, body, attrs = '') => `<g id="layer-${id}" data-layer="${id}" ${l[id] === false ? 'style="display:none"' : ''} ${attrs}>${body}</g>`;
    const rect = `x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"`;
    const water = [...city.terrain.sea, ...city.terrain.ribbons],
        editedWater = city.editor?.water?.dirty ? renderEditedWater(city, view, theme, 'water-lines') : null;
    const mask = (id, polygons) => editedWater && id === 'dry-land' ? waterLandMask(waterGeometry(city), box, id) : `<mask id="${id}" maskUnits="userSpaceOnUse" ${rect}><rect ${rect} fill="white"/>${polygons.map(p => poly(p, 'fill="black"')).join('')}</mask>`;
    const defs = `<defs>${mask('dry-land', water)}${mask('river-mouth-gaps', city.terrain.ribbons)}${mask('sea-overlap', city.terrain.sea)}<pattern id="water-lines" width="${29 * k}" height="${18 * k}" patternUnits="userSpaceOnUse"><path d="M${3 * k} ${10 * k}q${5 * k} ${-3 * k} ${10 * k} 0t${10 * k} 0" fill="none" stroke="${theme.wave}" stroke-width="${.6 * k}" opacity=".35"/></pattern><pattern id="furrows" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 2h8" stroke="${theme.fieldLine}" stroke-width=".5"/></pattern>${city.treeCrowns.map((c, i) => c ? `<path id="crown-${i}" d="${path(c)}Z"/>` : '').join('')}</defs>`;
    const fillWater = p => poly(p, `fill="${theme.water}"`) + poly(p, 'fill="url(#water-lines)"');
    const outline = (p, mask) => poly(p, `fill="none" stroke="${theme.bank}" stroke-width="1" ${mask ? `mask="url(#${mask})"` : ''}`);
    const sea = editedWater ? editedWater.defs + editedWater.sea : group('sea', city.terrain.sea.map(p => fillWater(p) + outline(p, l.river !== false ? 'river-mouth-gaps' : null)).join(''));
    const river = editedWater ? editedWater.river : group('river', city.terrain.ribbons.map(p => fillWater(p) + outline(p, l.sea !== false ? 'sea-overlap' : null)).join(''));
    const custom = (layer) => (city.customObjects || []).filter(b => b.layer === layer).map(b => `<g data-building-kind="${b.kind}" data-custom-object="${b.id}"><title>${escape(BUILDING_TYPES[b.kind].label)}</title>${renderBuildingArchitecture(b, view, theme)}</g>`).join('');
    const farmhouses = city.customObjects ? custom('fields') : city.special.filter(b => b.kind === 'farmhouse').map(b => poly(b.polygon, `fill="${theme.roof[1]}" stroke="${theme.roofLine}" stroke-width=".65"`)).join('');
    const fields = group('fields', city.fields.map(f => poly(f.polygon, `fill="${theme.field}" stroke="${theme.fieldLine}" stroke-width=".4"`) + poly(f.polygon, 'fill="url(#furrows)"')).join('') + farmhouses, 'mask="url(#dry-land)"');
    const districts = `<g id="layer-districts" data-layer="districts" mask="url(#dry-land)">${city.districts.map(d => districtPoly(d, `data-wealth="${d.wealth}" fill="${theme.wealth[d.wealth]}" fill-opacity=".2"`)).join('')}</g>`;
    const greens = group('greens', city.gardens.map(g => poly(g.polygon, `fill="${theme.green[1]}" opacity=".55"`)).join(''), 'mask="url(#dry-land)"');
    const appearance = buildingAppearance(city, theme);
    const buildings = group('buildings', renderHousing(visibleCityBuildings(city), appearance, view, theme) + custom('buildings'), 'mask="url(#dry-land)"');
    const bridgeDecks = city.bridges.map(b => renderBridgeDeck(b, theme)).join('');
    const quays = (city.quays || []).map(q => poly(q.polygon, `fill="${theme.street}"`)).join('');
    const streets = group('streets', `<g data-bridge-decks="true">${bridgeDecks}</g><g data-quays="true" mask="url(#dry-land)">${quays}</g><g data-street-connections="true" mask="url(#dry-land)" fill="none" stroke="${theme.street}" stroke-linejoin="round" stroke-linecap="butt">${city.streets.map(r => line(r.points, `stroke-width="${r.width}"${r.id.startsWith('local-') ? ' stroke-linecap="round"' : ''}`)).join('')}</g>`);
    const specials = kind => city.special.filter(b => b.kind === kind).map(b => `<g data-landmark="${kind}">${b.name ? `<title>${escape(b.name)}</title>` : ''}${renderCompatibleLandmark(b, view, theme)}</g>`).join('');
    const castle = group('castle', specials('castle'), 'mask="url(#dry-land)"'),
        temple = group('temple', specials('temple'), 'mask="url(#dry-land)"');
    const market = group('market', city.markets ? city.markets.map(site => `<g data-landmark="market">${poly(site.polygon, `fill="${theme.street}"`)}${site.stalls.map((stall, i) => renderCompatibleStall(stall, i, theme)).join('')}${circle(site.center, site.radius, `fill="${theme.water}" stroke="${theme.ink}" stroke-width=".8"`)}</g>`).join('') : city.squares.map(p => poly(p, `fill="${theme.street}"`)).join('') + city.monuments.map(p => poly(p, `fill="${theme.wall}" stroke="${theme.ink}" stroke-width=".7"`)).join(''), 'mask="url(#dry-land)"');
    const port = group('port', city.docks.map((d, i) => {
        const a = d.points[0], b = d.points.at(-1), axis = mul(sub(b, a), 1 / distance(a, b)),
            n = mul([-axis[1], axis[0]], d.width / 2);
        return renderBridgeDeck({
            ...d,
            a,
            b,
            id: `pier-${i}`,
            pier: true,
            polygon: [add(a, n), add(b, n), sub(b, n), sub(a, n)]
        }, theme);
    }).join(''));
    const walls = group('walls', city.walls.map(w => renderCompatibleWall(w, theme)).join(''), 'mask="url(#dry-land)"');
    const trees = group('forest', visibleCityTrees(city).map(t => city.treeCrowns[t.index] ? `<use href="#crown-${t.index}" transform="translate(${t.point.join(' ')})" fill="${theme.green[t.shade]}" stroke="${theme.ink}" stroke-width=".4"/>` : circle(t.point, t.radius, `fill="${theme.green[t.shade]}" stroke="${theme.ink}" stroke-width=".4"`)).join(''), 'mask="url(#dry-land)"');
    const castleLabels = l.castle === false ? [] : (city.editorLabels || city.special).filter(b => b.kind === 'castle' && b.name).map(b => ({
        ...b, id: b.id || `castle-${b.cell}`, landmark: 'castle'
    }));
    const displayedDistricts = mapDistricts(city);
    const labels = group('labels', view.labels ? renderDistrictLabels([...castleLabels, ...displayedDistricts], {
        box,
        fontSize: 12 * k,
        strokeWidth: 3 * k,
        theme,
        obstacles: [mapTextBox(city.name, box.x + box.width / 2, box.y + box.height * .065, 39 * k, 4 * k)]
    }) : '');
    const castleObjects = l.castle === false ? [] : castleMapObjects(city);
    const hitAreas = interactive ? `<g fill="transparent">${displayedDistricts.map(d => districtPoly(d, `data-district="${escape(d.id)}" class="district-hit" role="button" tabindex="0" aria-label="Открыть район ${escape(d.name)}"`)).join('')}${castleObjects.map(c => poly(c.polygon, `data-castle="${escape(c.id)}" class="district-hit" role="button" tabindex="0" aria-label="Открыть замок ${escape(c.castle.name || 'Замок')}"`)).join('')}</g>` : '';
    const selection = [...city.districts.filter(d => d.id === selected), ...castleObjects.filter(c => c.id === selectedCastle)].map(d => districtPoly(d, `fill="${theme.accent}" fill-opacity=".12" stroke="${theme.accent}" stroke-width="${2 * k}" pointer-events="none"`)).join('');
    const title = `<text x="${box.x + box.width / 2}" y="${box.y + box.height * .065}" text-anchor="middle" font-family="Georgia,serif" font-size="${39 * k}" fill="${theme.ink}" paint-order="stroke" stroke="${theme.paper}" stroke-width="${4 * k}">${escape(city.name)}</text>`;
    const scaleLength = 100 * Math.max(1, Math.round(box.width / 800)),
        scale = `<g transform="translate(${box.x + box.width * .06} ${box.y + box.height * .94})" fill="${theme.ink}" stroke="${theme.ink}" font-family="Georgia,serif" font-size="${10 * k}" paint-order="stroke"><path d="M0 0h${scaleLength}M0 ${-4 * k}v${8 * k}M${scaleLength} ${-4 * k}v${8 * k}" fill="none" stroke-width="${k}"/><text y="${20 * k}" stroke="${theme.paper}" stroke-width="${2 * k}">0</text><text x="${scaleLength}" y="${20 * k}" text-anchor="end" stroke="${theme.paper}" stroke-width="${2 * k}">${scaleLength} м</text></g>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200" viewBox="${box.x} ${box.y} ${box.width} ${box.height}" role="${interactive ? 'group' : 'img'}" aria-labelledby="map-title map-desc"><title id="map-title">${escape(city.name)}</title><desc id="map-desc">Город построен независимым движком по сиду ${escape(city.options.seed)}. Полное совпадение с MFCG пока не достигнуто.</desc>${defs}<rect ${rect} fill="${theme.paper}"/>${sea}${river}${fields}${districts}${greens}${buildings}${streets}${market}${castle}${temple}${port}${walls}${trees}${hitAreas}${selection}${mapOverlay}<g id="map-annotations" pointer-events="none">${labels}${title}${scale}</g></svg>`;
}
