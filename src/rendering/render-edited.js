import {bounds, centroid} from '../core/geometry.js';
import {BUILDING_TYPES, buildingLabel, containsPoint} from '../editor/building-editor.js';
import {buildingAppearance} from '../districts/district-wealth.js';
import {renderBuildingArchitecture} from '../buildings/building-architecture.js';
import {renderCompatibleLandmark, renderCompatibleStall, renderCompatibleWall} from './render-compatible.js';
import {renderMarketBuilding} from '../buildings/market-building.js';

const escape = value => String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;'
}[c]));
const path = polygon => `M${polygon.map(p => p.join(',')).join('L')}Z`;
const poly = (polygon, attrs = '') => `<path d="${path(polygon)}" ${attrs}/>`;

function details(building, theme) {
    const [x0, y0, x1, y1] = bounds(building.polygon), [x, y] = centroid(building.polygon), w = x1 - x0, h = y1 - y0;
    const shape = BUILDING_TYPES[building.kind]?.shape;
    const ridge = `<path d="M${x0 + w * .2} ${y}H${x1 - w * .2}" fill="none"/>`;
    if (shape === 'mill') return `<path d="M${x - w * .6} ${y - h * .6}L${x + w * .6} ${y + h * .6}M${x + w * .6} ${y - h * .6}L${x - w * .6} ${y + h * .6}" fill="none" stroke-width="1.4"/><circle cx="${x}" cy="${y}" r="${w * .12}" fill="${theme.wall}"/>`;
    if (shape === 'tower') return `<circle cx="${x}" cy="${y}" r="${Math.min(w, h) * .23}" fill="${theme.wall}"/>`;
    if (shape === 'court') return `<path d="M${x0 + w * .3} ${y0 + h * .3}h${w * .4}v${h * .4}h${-w * .4}Z" fill="${theme.street}"/>`;
    if (shape === 'fort') return ridge + [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([cx, cy]) => `<rect x="${cx - w * .08}" y="${cy - h * .08}" width="${w * .16}" height="${h * .16}" fill="${theme.wall}"/>`).join('');
    if (shape === 'temple') return `<path d="M${x} ${y0 + h * .15}V${y1 - h * .15}M${x0 + w * .2} ${y}H${x1 - w * .2}" fill="none"/>`;
    return ridge;
}

function buildingBody(building, city, view, theme, fill, stallShade) {
    const baseFormat = city.editor.baseFormat, parts = building.parts || {};
    if (building.kind === 'market' && baseFormat === 'legacy') return renderMarketBuilding(building, theme, true);
    const architecture = renderBuildingArchitecture(building, view, theme);
    if (architecture) return architecture;
    if (baseFormat === 'compatible' && (!building.custom || building.nativeLandmark) && ['castle', 'temple'].includes(building.kind)) return renderCompatibleLandmark({
        ...building,
        court: parts.court,
        tower: parts.tower
    }, view, theme);
    if (building.kind === 'stall') {
        if (baseFormat !== 'legacy') return renderCompatibleStall(building.polygon, stallShade, theme);
        const p = building.polygon, a = [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2],
            b = [(p[3][0] + p[2][0]) / 2, (p[3][1] + p[2][1]) / 2];
        return poly(p, `fill="${[theme.accent, theme.green[0], theme.roof[2]][building.shade % 3]}" stroke="${theme.ink}" stroke-width=".6"`) + `<path d="M${a.join(',')}L${b.join(',')}" fill="none" stroke="${theme.street}" stroke-width="1.5"/>`;
    }
    if (baseFormat === 'legacy' && (!building.custom || building.nativeLandmark) && building.kind === 'castle' && parts.keep) {
        const towers = (building.towerPoints || []).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6.8" fill="${theme.wall}" stroke="${theme.ink}" stroke-width="1.6"/><circle cx="${x}" cy="${y}" r="3.7" fill="none" stroke="${theme.roofLine}" stroke-width=".7"/>`).join('');
        return poly(building.polygon, `fill="${theme.wall}" stroke="${theme.ink}" stroke-width="5" stroke-linejoin="round"`) + (parts.court ? poly(parts.court, `fill="${theme.street}" stroke="${theme.roofLine}" stroke-width=".9"`) : '') + poly(parts.keep, `fill="${theme.roof[1]}" stroke="${theme.ink}" stroke-width="2"`) + towers;
    }
    const landmark = ['castle', 'temple', 'fort'].includes(building.kind),
        importedSpecial = baseFormat === 'mfcg' && !building.custom && building.kind === 'special';
    const stroke = landmark || importedSpecial ? theme.ink : theme.roofLine;
    const nativeTemple = baseFormat === 'legacy' && (!building.custom || building.nativeLandmark) && building.kind === 'temple';
    const partsMarkup = Object.entries(parts).filter(([key]) => key !== 'court' && !(nativeTemple && key === 'nave')).map(([key, p]) => poly(p, `fill="${['keep', 'nave', 'transept'].includes(key) ? nativeTemple ? theme.roof[2] : theme.roof[1] : theme.wall}"`)).join('');
    const solid = poly(building.polygon) + (building.rings || []).slice(1).map(hole => poly(hole, `fill="${theme.street}"`)).join('') + partsMarkup;
    const roofDetails = view.roofs && (building.custom || building.kind === 'house' && baseFormat !== 'mfcg') ? `<g pointer-events="none">${details(building, theme)}</g>` : '';
    return (parts.court ? poly(parts.court, `fill="${theme.street}"`) : '') + `<g fill="${fill}" stroke="${stroke}" stroke-width="${landmark ? 1 : .8}" stroke-linejoin="round">${solid}${roofDetails}</g>`;
}

export function renderEditorBuilding(building, city, view, theme, {
    interactive = false,
    tabIndex = 0,
    stallShade = building.nativeStallShade ?? building.shade,
    includeFortification = true,
    appearance = buildingAppearance(city, theme)
} = {}) {
    const paint = appearance(building), wealth = paint.wealth;
    let fill = building.kind === 'house' ? paint.fill : theme.roof[1];
    if (city.editor.baseFormat === 'legacy' && building.kind === 'castle') fill = theme.wall;
    if (city.editor.baseFormat === 'legacy' && building.kind === 'temple') fill = theme.roof[2];
    if (city.editor.baseFormat === 'mfcg' && !building.custom && building.kind === 'special') fill = theme.ink;
    const label = escape(buildingLabel(building));
    const attributes = interactive ? `data-building="${escape(building.id)}" role="button" tabindex="${tabIndex}" aria-label="${label}. Выбрать здание" class="editable-building"` : '';
    const body = (includeFortification && building.fortification && view.layers?.walls !== false ? renderCompatibleWall(building.fortification, theme) : '') + buildingBody(building, city, view, theme, fill, stallShade);
    const mask = city.editor.baseFormat === 'compatible' ? 'dry-land' : city.editor.baseFormat === 'legacy' ? 'land-mask' : 'edited-dry-land';
    return `<g ${attributes} data-building-kind="${escape(building.kind)}" data-building-wealth="${wealth}"><title>${label}</title>${city.editor.water?.dirty ? `<g mask="url(#${mask})">${body}</g>` : body}</g>`;
}

export function renderEditedSvg(city, view, theme, options, renderBase) {
    const {
        interactive = false,
        selectedBuilding = null,
        editingVertices = false,
        waterOverlay = '',
        quarterOverlay = ''
    } = options;
    const buildings = city.buildings.filter(b => view.layers[b.layer || BUILDING_TYPES[b.kind]?.layer || 'buildings'] !== false);
    const stallShades = new Map(), marketCounts = new Map();
    for (const b of city.buildings.filter(b => b.kind === 'stall' && !b.custom)) {
        const market = city.markets?.find(m => containsPoint(m, centroid(b.polygon))),
            index = marketCounts.get(market) || 0;
        stallShades.set(b.id, b.nativeStallShade ?? index);
        marketCounts.set(market, index + 1);
    }
    const grounds = buildings.filter(b => b.nativeLandmark && b.parts.court).map(b => poly(b.parts.court, `fill="${theme.street}"`)).join('');
    const appearance = buildingAppearance(city, theme);
    const bodies = buildings.map((b, i) => renderEditorBuilding(b.nativeLandmark && b.parts.court ? {
        ...b,
        parts: {...b.parts, court: undefined}
    } : b, city, view, theme, {
        interactive,
        appearance,
        includeFortification: false,
        tabIndex: b.id === selectedBuilding || !selectedBuilding && i === 0 ? 0 : -1,
        stallShade: city.editor.baseFormat === 'compatible' ? stallShades.get(b.id) ?? b.shade : b.shade
    })).join('');
    const selected = buildings.find(b => b.id === selectedBuilding), k = city.viewBox.width / 1600;
    const selection = interactive && selected ? (() => {
        const [x0, y0, x1, y1] = bounds(selected.polygon);
        const handles = selected.kind === 'guardhouse' ? '' : `${editingVertices ? selected.polygon.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${4 * k}" fill="${theme.paper}" data-vertex="${i}" data-building="${escape(selected.id)}" class="vertex-handle"/>`).join('') : ''}<rect x="${x1 + 4 * k}" y="${y1 + 4 * k}" width="${9 * k}" height="${9 * k}" fill="${theme.accent}" stroke="${theme.paper}" data-resize="true" data-building="${escape(selected.id)}" class="resize-handle"/>`;
        return `<g id="editor-selection" fill="none" stroke="${theme.accent}" stroke-width="${1.7 * k}">${poly(selected.polygon, 'pointer-events="none"')}<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" stroke-dasharray="${4 * k} ${3 * k}" pointer-events="none"/>${handles}</g>`;
    })() : '';
    const mask = city.editor.baseFormat === 'compatible' ? 'dry-land' : city.editor.baseFormat === 'legacy' ? 'land-mask' : 'edited-dry-land';
    const mapOverlay = `<g id="editor-grounds" pointer-events="none"${city.editor.water?.dirty ? ` mask="url(#${mask})"` : ''}>${grounds}</g><g id="editor-buildings">${bodies}</g>${selection}${interactive ? waterOverlay + quarterOverlay : ''}<g id="editor-preview" pointer-events="none"></g>`;
    const walls = [...city.walls, ...city.buildings.flatMap(b => b.fortification ? [b.fortification] : [])];
    const base = renderBase({
        ...city,
        walls,
        source: {format: city.editor.baseFormat},
        editorLabels: city.buildings,
        buildings: []
    }, view, {...options, interactive: false, mapOverlay});
    return base.replace('role="img"', `role="${interactive ? 'group' : 'img'}"`).replace(/<title id="map-title">[\s\S]*?<\/title>/, `<title id="map-title">${escape(city.name)}, редактируемая карта</title>`)
        .replace(/<desc id="map-desc">[\s\S]*?<\/desc>/, `<desc id="map-desc">Карта города с изменённой геометрией. ${city.buildings.length} зданий. Сохраните проект JSON для продолжения редактирования.</desc>`);
}
