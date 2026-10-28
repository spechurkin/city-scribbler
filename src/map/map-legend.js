import {BUILDING_TYPES, buildingTypeGroups} from '../editor/building-editor.js';
import {createArchitecture} from '../buildings/building-architecture.js';
import {bounds} from '../core/geometry.js';
import {renderEditorBuilding} from '../rendering/render-edited.js';
import {renderBridgeDeck} from '../rendering/render-compatible.js';
import {escapeXml, normalizeView, THEMES} from '../rendering/render.js';

const previewCity = {districts: [], editor: {baseFormat: 'compatible'}};

export function buildingLegendSymbol(kind, view, theme) {
    const rule = BUILDING_TYPES[kind], scale = 28 / Math.max(rule.width, rule.height);
    const building = {
        kind, custom: true, name: '', shade: 0, district: null,
        ...createArchitecture(kind, [0, 0], rule.width * scale, rule.height * scale)
    };
    const [x0, y0, x1, y1] = bounds([building.polygon, ...Object.values(building.parts)].flat());
    return `<svg viewBox="${x0 - 3} ${y0 - 3} ${x1 - x0 + 6} ${y1 - y0 + 6}" aria-hidden="true" focusable="false">${renderEditorBuilding(building, previewCity, view, theme)}</svg>`;
}

function terrainSymbols(t) {
    const water = `<path d="M3 9h7m4 7h11M7 25h10" stroke="${t.wave}" stroke-width=".7"/>`;
    const tree = (x, y) => `<circle cx="${x}" cy="${y}" r="5" fill="${t.green[0]}" stroke="${t.ink}" stroke-width=".7"/>`;
    return [
        ['sea', 'Море', `<path d="M0 0H32V32H0Z" fill="${t.water}"/>${water}`],
        ['river', 'Река', `<path d="M11 0C1 11 27 21 17 32h8C35 21 9 11 19 0" fill="${t.water}" stroke="${t.bank}"/>`],
        ['street', 'Улица или дорога', `<path d="M0 23L32 9" stroke="${t.fieldLine}" stroke-width="8"/><path d="M0 23L32 9" stroke="${t.street}" stroke-width="6"/>`],
        ['bridge', 'Мост', `<path d="M10 0H22V32H10Z" fill="${t.water}"/>${renderBridgeDeck({
            id: 'legend-bridge',
            pedestrian: false,
            a: [0, 16],
            b: [32, 16],
            width: 8,
            polygon: [[0, 12], [32, 12], [32, 20], [0, 20]]
        }, t)}`],
        ['port', 'Причал', `<path d="M0 0H32V32H0Z" fill="${t.water}"/>${renderBridgeDeck({
            id: 'legend-pier',
            pier: true,
            a: [2, 16],
            b: [27, 16],
            width: 8,
            polygon: [[2, 12], [27, 12], [27, 20], [2, 20]]
        }, t)}`],
        ['wall', 'Городская стена', `<path d="M0 16H32" stroke="${t.ink}" stroke-width="7"/><path d="M0 16H32" stroke="${t.wall}" stroke-width="4"/>`],
        ['tower', 'Крепостная башня', `<circle cx="16" cy="16" r="9" fill="${t.wall}" stroke="${t.ink}" stroke-width="1.5"/><circle cx="16" cy="16" r="5" fill="none" stroke="${t.roofLine}"/>`],
        ['gate', 'Городские ворота', `<path d="M0 16H11m10 0H32" stroke="${t.ink}" stroke-width="6"/><path d="M0 16H11m10 0H32" stroke="${t.wall}" stroke-width="3"/><path d="M11 10v12m10-12v12" stroke="${t.ink}" stroke-width="2"/>`],
        ['square', 'Площадь', `<path d="M3 4H29V28H3Z" fill="${t.street}" stroke="${t.fieldLine}" stroke-width=".7"/>`],
        ['fountain', 'Фонтан', `<circle cx="16" cy="16" r="10" fill="${t.water}" stroke="${t.ink}"/><circle cx="16" cy="16" r="4" fill="none" stroke="${t.bank}"/>`],
        ['fields', 'Поле', `<path d="M2 4H30V28H2Z" fill="${t.field}" stroke="${t.fieldLine}"/><path d="M6 5V27m5-22V27m5-22V27m5-22V27m5-22V27" stroke="${t.fieldLine}" stroke-width=".7"/>`],
        ['greens', 'Сад или парк', `<path d="M2 2H30V30H2Z" fill="${t.green[1]}"/>${tree(10, 10)}${tree(23, 22)}`],
        ['forest', 'Дерево или лес', tree(11, 12) + tree(22, 18) + tree(10, 24)],
        ['conifer', 'Хвойное дерево', `<path d="M16 3L27 26H5Z" fill="${t.green[0]}" stroke="${t.ink}" stroke-width=".7"/><path d="M16 21v9" stroke="${t.ink}"/>`]
    ];
}

export function renderMapLegend(input = {}) {
    const view = normalizeView(input), theme = THEMES[view.theme];
    const row = (kind, label, symbol) => `<li data-legend-kind="${escapeXml(kind)}">${symbol}<span>${escapeXml(label)}</span></li>`;
    const terrain = terrainSymbols(theme).map(([kind, label, body]) => row(kind, label, `<svg viewBox="-2 -2 36 36" aria-hidden="true" focusable="false">${body}</svg>`)).join('');
    const groups = buildingTypeGroups().map(({
                                                 label,
                                                 entries
                                             }) => `<section class="legend-group"><h3>${escapeXml(label)}</h3><ul>${entries.map(([kind, rule]) => row(kind, rule.label, buildingLegendSymbol(kind, view, theme))).join('')}</ul></section>`).join('');
    return `<p class="legend-note">Все типы объектов. Рисунки показаны без соблюдения масштаба.</p>${groups}<section class="legend-group"><h3>Ландшафт и сооружения</h3><ul>${terrain}</ul></section>`;
}
