import {waterGeometry} from '../water/water-geometry.js';

const path = points => points.length ? `M${points.map(p => p.join(',')).join('L')}Z` : '';
const rings = region => [region.polygon, ...(region.holes || [])].map(path).join('');

export function waterLandMask(regions, box, id) {
    return `<mask id="${id}" maskUnits="userSpaceOnUse" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="white"/>${regions.map(r => `<path d="${rings(r)}" fill="black" fill-rule="evenodd"/>`).join('')}</mask>`;
}

export function renderEditedWater(city, view, theme, pattern = null) {
    const regions = waterGeometry(city), sea = regions.filter(r => r.kind === 'sea'),
        rivers = regions.filter(r => r.kind === 'river');
    const defs = `<defs>${waterLandMask(rivers, city.viewBox, 'edited-sea-open')}${waterLandMask(sea, city.viewBox, 'edited-river-open')}</defs>`;
    const group = (kind, bodies, otherVisible) => `<g id="layer-${kind}" data-layer="${kind}"${view.layers[kind] === false ? ' style="display:none"' : ''}>${bodies.map(r => `<g data-water-shape="${r.id}"><path d="${rings(r)}" fill="${theme.water}" fill-rule="evenodd"/>${pattern ? `<path d="${rings(r)}" fill="url(#${pattern})" fill-rule="evenodd"/>` : ''}<path d="${rings(r)}" fill="none" stroke="${theme.bank}" stroke-width="1"${otherVisible ? ` mask="url(#edited-${kind}-open)"` : ''}/></g>`).join('')}</g>`;
    return {
        defs,
        sea: group('sea', sea, view.layers.river !== false),
        river: group('river', rivers, view.layers.sea !== false)
    };
}
