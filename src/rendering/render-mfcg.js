import {mapTextBox, renderDistrictLabels} from './label-layout.js';
import {buildingAppearance} from '../districts/district-wealth.js';
import {renderEditedWater, waterLandMask} from './render-water.js';
import {waterGeometry} from '../water/water-geometry.js';
import {renderBridgeDeck} from './render-compatible.js';

const escape = value => String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;'
}[c]));
const n = value => value === 0 ? 0 : value;
const ringPath = ring => ring.length ? `M${ring.map(p => p.map(n).join(',')).join('L')}Z` : '';
const polygonPath = rings => rings.map(ringPath).join('');
const linePath = points => points.length ? `M${points.map(p => p.map(n).join(',')).join('L')}` : '';
const poly = (rings, attrs = '') => `<path d="${polygonPath(rings)}" fill-rule="evenodd" ${attrs}/>`;
const group = (id, body, layers, attrs = '') => `<g id="layer-${id}" data-layer="${id}" ${layers[id] === false ? 'style="display:none"' : ''} ${attrs}>${body}</g>`;

export function renderMfcgSvg(city, view, theme, {interactive = false, selected = null, mapOverlay = ''} = {}) {
    const {imported: i} = city, l = {...view.layers, labels: view.labels && view.layers.labels !== false},
        box = city.viewBox, k = box.width / 1600, mid = box.x + box.width / 2;
    const editedWater = city.editor?.water?.dirty ? renderEditedWater(city, view, theme) : null;
    const land = body => editedWater ? `<g mask="url(#edited-dry-land)">${body}</g>` : body;
    const terrain = group('terrain', i.earth.map(p => poly(p, `fill="${theme.paper}"`)).join(''), l);
    const water = editedWater ? `<defs>${waterLandMask(waterGeometry(city), box, 'edited-dry-land')}</defs>${editedWater.defs}${editedWater.sea}` : group('sea', i.water.map(p => poly(p, `fill="${theme.water}" stroke="${theme.bank}" stroke-width="1.2"`)).join(''), l);
    const rivers = editedWater ? editedWater.river : group('river', i.rivers.map(r => `<path d="${linePath(r.points)}" fill="none" stroke="${theme.water}" stroke-width="${r.width}" stroke-linejoin="round" stroke-linecap="round"/>`).join(''), l);
    const fields = group('fields', city.fields.map(f => poly(f.rings, `fill="${theme.field}" stroke="${theme.fieldLine}" stroke-width=".45"`)).join(''), l);
    const districts = group('districts', city.districts.map(d => poly(d.rings, `data-wealth="${d.wealth}" fill="${theme.wealth[d.wealth]}" fill-opacity=".2"`)).join(''), {
        ...l,
        districts: true
    });
    const greens = group('greens', i.greens.map(p => poly(p, `fill="${theme.green[1]}" stroke="${theme.green[0]}" stroke-width=".6"`)).join(''), l);
    const roads = group('streets', land(city.streets.map(r => `<path d="${linePath(r.points)}" fill="none" stroke="${theme.street}" stroke-width="${r.width}" stroke-linejoin="round" stroke-linecap="round"/>`).join('')) + (editedWater ? city.bridges.map(b => renderBridgeDeck(b, theme)).join('') : ''), l);
    const appearance = buildingAppearance(city, theme);
    const buildings = group('buildings', city.buildings.map(b => {
        const {wealth, fill} = appearance(b);
        return poly(b.rings, `data-building-wealth="${wealth}" fill="${fill}" stroke="${theme.roofLine}" stroke-width=".9" stroke-linejoin="round"`);
    }).join(''), l);
    const special = group('castle', i.special.map(p => poly(p, `fill="${theme.ink}" stroke="${theme.ink}" stroke-width=".8"`)).join(''), l);
    const squares = group('market', i.squares.map(p => poly(p, `fill="${theme.street}" stroke="${theme.roofLine}" stroke-width=".7"`)).join(''), l);
    const planks = group('port', i.planks.map(p => `<path d="${linePath(p.points)}" fill="none" stroke="${theme.roofLine}" stroke-width="${p.width}" stroke-linecap="square"/>`).join(''), l);
    const walls = group('walls', i.wallPolygons.map(p => poly(p.rings, `fill="none" stroke="${theme.ink}" stroke-width="${p.width}" stroke-linejoin="round"`)).join(''), l);
    const forest = group('forest', city.trees.map(t => `<circle cx="${n(t.point[0])}" cy="${n(t.point[1])}" r="${t.radius}" fill="${theme.green[t.shade]}" stroke="${theme.ink}" stroke-width=".4"/>`).join(''), l);
    const labels = group('labels', renderDistrictLabels(city.districts, {
        box,
        fontSize: 13 * k,
        strokeWidth: 3 * k,
        theme,
        obstacles: [mapTextBox(city.name, mid, box.y + box.height * .07, 39 * k, 3 * k)]
    }), l);
    const title = `<text x="${n(mid)}" y="${n(box.y + box.height * .07)}" text-anchor="middle" font-family="Georgia,serif" font-size="${39 * k}" fill="${theme.ink}" paint-order="stroke" stroke="${theme.paper}" stroke-width="${3 * k}">${escape(city.name)}</text>`;
    const footer = `<text x="${n(box.x + box.width * .94)}" y="${n(box.y + box.height * .95)}" text-anchor="end" font-family="Georgia,serif" font-size="${10 * k}" fill="${theme.ink}">${city.editor ? 'Градописарь · редактируемая карта' : `MFCG ${escape(city.source.version || '')} · импорт геометрии`}</text>`;
    const scaleX = box.x + box.width * .06, scaleY = box.y + box.height * .94;
    const scale = `<g transform="translate(${n(scaleX)} ${n(scaleY)})" fill="${theme.ink}" stroke="${theme.ink}" font-family="Georgia,serif" font-size="${10 * k}"><path d="M0 0h500M0 ${-4 * k}v${8 * k}M250 ${-4 * k}v${8 * k}M500 ${-4 * k}v${8 * k}" fill="none" stroke-width="${k}"/><text y="${20 * k}" stroke="none">0</text><text x="250" y="${20 * k}" text-anchor="middle" stroke="none">250</text><text x="500" y="${20 * k}" text-anchor="end" stroke="none">500 м</text></g>`;
    const hitAreas = interactive ? `<g fill="transparent" stroke="none">${city.districts.map(d => poly(d.rings, `data-district="${d.id}" class="district-hit" role="button" tabindex="0" aria-label="Открыть район ${escape(d.name)}"`)).join('')}</g>` : '';
    const selection = selected ? city.districts.filter(d => d.id === selected).map(d => poly(d.rings, `fill="${theme.accent}" fill-opacity=".13" stroke="${theme.accent}" stroke-width="${2 * k}" pointer-events="none"`)).join('') : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200" viewBox="${n(box.x)} ${n(box.y)} ${n(box.width)} ${n(box.height)}" role="${interactive ? 'group' : 'img'}" aria-labelledby="map-title map-desc"><title id="map-title">${escape(city.name)}, импортированная карта MFCG</title><desc id="map-desc">Координаты сохранены из экспорта MFCG. Оформление Градописаря. Генерация по исходному сиду не выполнялась.</desc><rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}" fill="${theme.paper}"/>${terrain}${water}${rivers}${land(fields)}${land(districts)}${land(greens)}${roads}${land(buildings)}${land(squares)}${land(special)}${group('temple', '', l)}${planks}${land(walls)}${land(forest)}${hitAreas}${selection}${mapOverlay}<g id="map-annotations" pointer-events="none">${labels}${title}${scale}${footer}</g></svg>`;
}
