import {
    DEFAULT_OPTIONS,
    EXTRA_WATER_OPTIONS,
    generateCity,
    isReferenceInput,
    LEGACY_OPTION_ALIASES,
    normalizeOptions
} from './generation/interactive-city.js';
import {parseProject, serializeProject} from './io/city-project.js';
import {DEFAULT_VIEW, LAYERS, normalizeView, renderMap, THEMES} from './rendering/render.js';
import {WEALTH_LABELS} from './districts/district-wealth.js';
import {area, bounds} from './core/geometry.js';
import {exportMfcgGeoJson} from './io/mfcg-geojson.js';
import {
    generationHash,
    mfcgReferenceUrl,
    readGenerationForm,
    readGenerationLocation,
    syncCustomObjectControls,
    syncLandmarkControls,
    writeGenerationForm
} from './generation/generation-settings.js';
import {generationUiState} from './generation/generation-ui-state.js';
import {generateCityInWorker} from './generation/generation-client.js';
import {BUILDING_TYPES, buildingTypeGroups, enterEditor, isEditing} from './editor/building-editor.js';
import {createEditorUi, editorMarkup, editorWarningMarkup} from './editor/editor-ui.js';
import {castleMapObjects, mapDistricts} from './map/map-selection.js';
import {ensureStreetNames, renameStreet} from './roads/street-names.js';
import {visibleCityBuildings, visibleCityTrees} from './buildings/custom-objects.js';
import {CUSTOM_OBJECT_COUNTS} from './buildings/custom-object-settings.js';
import {renderMapLegend} from './map/map-legend.js';
import {createMapViewport, viewportPoint} from './map/map-viewport.js';

const $ = (selector, root = document) => root.querySelector(selector);
const num = value => new Intl.NumberFormat('ru-RU').format(value);
let city, view = normalizeView(DEFAULT_VIEW), selected = null, busy = false;
let selectedCastle = null;
let selectedStreet = null;
let viewport = {x: 0, y: 0, width: 1600, height: 1200};
let toastTimer;
let pendingReference = null;
let originalCity = null, editorDraft = null;
let pendingEditedProject = null;
let legendPaint = '';
const featureLabels = {
    walls: 'Стены',
    citadel: 'Замок',
    urban_castle: 'Внутри города',
    plaza: 'Рынок',
    temple: 'Храм',
    greens: 'Сады',
    shantytown: 'Посад',
    hub: 'Перекрёсток',
    river: 'Река',
    coast: 'Море'
};
const geographyNames = {inland: 'На суше', river: 'На реке', coast: 'У моря', estuary: 'В устье реки'};
const customObjectGroups = buildingTypeGroups().map(group => ({
    ...group,
    entries: group.entries.filter(([kind]) => Object.hasOwn(CUSTOM_OBJECT_COUNTS, kind))
})).filter(group => group.entries.length);
const sliderLabels = {
    riverWidthScale: v => `${Math.round(v * 100)}%`,
    riverCurvature: v => `${Math.round(v * 100)}%`,
    sea: v => `${Math.round(v * 1800) / 10}°`,
    coastOffset: v => `${Math.round(v * 100)}%`
};

document.querySelector('#app').innerHTML = `
  <header class="app-header">
    <div class="header-actions"><span class="local-note">Карты для ваших историй</span><button id="switch-mode" class="outline-button" aria-haspopup="dialog">Редактировать карту</button><button id="import-project" class="text-button">Открыть проект</button><button id="export-open" class="outline-button" aria-haspopup="dialog">Экспорт</button></div>
  </header>
  <main class="workspace">
    <aside id="sidebar" class="sidebar" aria-label="Настройки карты">
      <div class="sidebar-tabs" role="tablist" aria-label="Параметры"><button id="tab-generate" role="tab" aria-selected="true" aria-controls="panel-generate" tabindex="0">Генерация</button><button id="tab-edit" role="tab" aria-selected="false" aria-controls="panel-edit" tabindex="-1" hidden>Редактор</button><button id="tab-layers" role="tab" aria-selected="false" aria-controls="panel-layers" tabindex="-1">Слои карты</button></div>
      <section id="panel-generate" role="tabpanel" aria-labelledby="tab-generate">
        <form id="generation-form">
          <div class="control-section"><label class="field-label" for="seed">Сид или ссылка MFCG</label><div class="seed-row"><input id="seed" name="seed" maxlength="2048" value="${DEFAULT_OPTIONS.seed}" autocomplete="off" spellcheck="false" required aria-describedby="seed-hint"/><button class="square-button" type="button" id="random-seed" title="Случайный сид" aria-label="Случайный сид">⤨</button></div><p class="field-hint" id="seed-hint">Полная ссылка переносит размер и параметры города.</p></div>
          <div class="control-section"><div class="number-grid"><label class="field-label" for="size">Размер<input id="size" name="size" type="number" min="6" max="200" value="34" required/></label><label class="field-label" for="gates">Въезды<input id="gates" name="gates" type="number" min="-1" max="1000" value="-1" required/></label></div><p class="field-hint">Размер — число ячеек. Въезды: −1 — автоматически.</p><label class="field-label spaced" for="population">Население<input id="population" name="population" type="number" min="0" step="1" placeholder="Не задано"/></label></div>
          <fieldset class="control-section features"><legend>Устройство города</legend><div class="feature-grid">${Object.entries(featureLabels).map(([key, label]) => `<label class="check-row"><input type="checkbox" id="feature-${key}" name="${key}" ${DEFAULT_OPTIONS[key] ? 'checked' : ''}/><span>${label}</span></label>`).join('')}</div></fieldset>
          <div class="control-section landmark-settings">${[['marketCount', 'Рынки'], ['templeCount', 'Храмы']].map(([key, label]) => `<div class="range-label"><label for="${key}">${label}</label><output id="${key}-value" for="${key}"></output></div><input id="${key}" name="${key}" type="range" min="0" max="4" step="1" value="1" aria-describedby="landmark-hint"/>`).join('')}<p class="field-hint" id="landmark-hint">Максимум растёт с размером города. Каждый объект занимает отдельный квартал.</p></div>
          <details class="control-section custom-object-settings"><summary>Кастомные объекты</summary><p class="field-hint" id="custom-object-hint">Количество и максимум зависят от размера города. Сдвиньте ползунок, чтобы задать своё количество. Хотя бы один объект постоя обязателен; фермерство ограничено наличием и площадью полей. При нехватке места объектов будет меньше.</p><button id="reset-custom-objects" type="button" class="text-button">Рассчитать по размеру</button>${customObjectGroups.map(group => `<fieldset><legend>${group.label}</legend>${group.entries.map(([kind, type]) => {
    const key = CUSTOM_OBJECT_COUNTS[kind];
    return `<div class="range-label"><label for="${key}">${type.label}</label><output id="${key}-value" for="${key}"></output></div><input id="${key}" name="${key}" type="range" min="0" max="1" step="1" value="0" data-custom-count="${kind}" data-auto="true" aria-describedby="custom-object-hint"/>`;
}).join('')}</fieldset>`).join('')}</details>
          <div class="control-section water-settings"><fieldset id="sea-settings"><legend>Море</legend><div class="range-label"><label for="sea">Направление берега</label><output id="sea-value" for="sea">0°</output></div><input id="sea" name="sea" type="range" min="0" max="2" step="any" value="0"/></fieldset><details class="extra-water"><summary>Дополнительно: форма воды</summary><p class="field-hint">Эти настройки есть только в Градописаре. Для сравнения с MFCG оставьте 100% и сдвиг 0.</p><fieldset id="river-settings"><legend>Река</legend><div class="range-label"><label for="riverWidthScale">Ширина</label><output id="riverWidthScale-value" for="riverWidthScale">100%</output></div><input id="riverWidthScale" name="riverWidthScale" type="range" min="0.25" max="3" step="0.01" value="1"/><div class="range-label"><label for="riverCurvature">Извилистость</label><output id="riverCurvature-value" for="riverCurvature">100%</output></div><input id="riverCurvature" name="riverCurvature" type="range" min="0" max="2" step="0.01" value="1"/></fieldset><div class="range-label"><label for="coastOffset">Сдвиг берега моря</label><output id="coastOffset-value" for="coastOffset">0%</output></div><input id="coastOffset" name="coastOffset" type="range" min="-0.3" max="0.3" step="0.01" value="0"/><button id="reset-water" class="text-button" type="button">Вернуть исходную форму воды</button></details><p class="field-hint">Поля, леса и причалы можно скрыть на вкладке «Слои карты».</p></div>
          <div class="generation-actions"><button type="submit" class="primary-button" id="generate">Построить по сиду</button><button type="button" id="new-city" class="outline-button">Новый город <kbd>N</kbd></button><p class="field-hint" id="draft-hint" aria-live="polite">Настройки применены к карте.</p></div>
        </form>
      </section>
      ${editorMarkup}
      <section id="panel-layers" role="tabpanel" aria-labelledby="tab-layers" hidden><p class="panel-description">Скрытие слоёв не меняет геометрию города. Цвета достатка районов видны всегда.</p><div class="layer-actions"><button type="button" class="text-button" id="layers-all">Показать все</button><button type="button" class="text-button" id="layers-none">Скрыть все</button></div><div id="layer-list">${Object.entries(LAYERS).map(([key, label]) => `<label class="check-row layer-row"><input type="checkbox" data-layer-toggle="${key}" checked/><span>${label}</span><span class="layer-count" data-count="${key}"></span></label>`).join('')}</div><label class="check-row roof-option"><input type="checkbox" id="roof-details" checked/><span>Детали крыш</span></label></section>
      <div class="sidebar-foot"><button id="help-open" class="text-button">Управление и о проекте</button><span>Локально · без аккаунта</span></div>
    </aside>
    <section class="map-column" aria-label="Карта города">
      <div class="map-heading"><div><label for="city-name" class="sr-only">Название города</label><input id="city-name" maxlength="80" aria-label="Название города"/><p id="city-description"></p></div><button id="toggle-sidebar" class="outline-button" aria-expanded="false" aria-controls="sidebar">Настройки</button><label class="style-control">Вид карты<select id="theme"><option value="atlas">Атлас</option><option value="ink">Тушь</option></select></label></div>
      <div id="map-stage" class="map-stage" tabindex="0" role="region" aria-label="Интерактивная карта. Колесо: масштаб, перетаскивание: перемещение. Стрелки, плюс, минус и Home доступны с клавиатуры."><div id="map"></div><div id="loading" class="map-loading" hidden><span>Строим кварталы и улицы…</span></div><div id="map-error" role="alert" hidden></div><div class="map-tools" aria-label="Масштаб карты"><button id="zoom-in" title="Приблизить (+)" aria-label="Приблизить">+</button><output id="zoom-value" aria-label="Масштаб">100%</output><button id="zoom-out" title="Отдалить (-)" aria-label="Отдалить">−</button><span></span><button id="fit-map" title="Показать всю карту (Home)" aria-label="Показать всю карту">⌖</button></div><div class="map-tip">Перетащите карту · колесо для масштаба · нажмите на район</div></div>
      <div id="wealth-legend" class="wealth-legend" aria-label="Достаток районов"><span><i data-wealth-swatch="rich" aria-hidden="true"></i>Богатые районы</span><span><i data-wealth-swatch="mixed" aria-hidden="true"></i>Смешанные районы</span><span><i data-wealth-swatch="poor" aria-hidden="true"></i>Бедные районы</span></div>
      <div class="map-status"><span id="map-statistics" aria-live="polite"></span><button id="copy-link" class="text-button">Скопировать ссылку на сид</button><button id="copy-mfcg-link" class="text-button">Скопировать ссылку MFCG</button></div>
      <section id="district-panel" class="district-panel" aria-labelledby="district-title" hidden><div><p id="selection-kind" class="small-label">Выбранный район</p><h2 id="district-title"></h2><p id="district-info"></p></div><label>Название<input id="district-name" maxlength="80"/></label><button id="close-district" class="square-button" aria-label="Закрыть сведения об объекте">×</button></section>
    </section>
  </main>
  <dialog id="export-dialog" aria-labelledby="export-title"><div class="dialog-heading"><h2 id="export-title">Сохранить карту</h2><button class="square-button" data-close="export-dialog" aria-label="Закрыть экспорт">×</button></div><p>Изображения сохраняются с выбранным оформлением и видимыми слоями.</p><div class="export-options"><button data-export="svg"><strong>SVG</strong><span>Векторная карта, отдельные группы слоёв</span></button><button data-export="png"><strong>PNG</strong><span>Изображение 3200 × 2400 для печати и VTT</span></button><button data-export="json"><strong>JSON</strong><span>Проект, названия, настройки и геометрия</span></button><button data-export="mfcg" hidden><strong>MFCG</strong><span>Исходный GeoJSON с обновлёнными названиями районов</span></button></div><p id="export-status" role="status"></p></dialog>
  <dialog id="help-dialog" aria-labelledby="help-title"><div class="dialog-heading"><h2 id="help-title">Карта под рукой</h2><button class="square-button" data-close="help-dialog" aria-label="Закрыть справку">×</button></div><dl class="shortcuts"><div><dt>Новый город</dt><dd><kbd>N</kbd></dd></div><div><dt>Изменить масштаб</dt><dd>Колесо / <kbd>+</kbd> <kbd>−</kbd></dd></div><div><dt>Передвинуть карту</dt><dd>Перетащить / стрелки</dd></div><div><dt>Показать целиком</dt><dd><kbd>Home</kbd></dd></div><div><dt>Сведения о районе</dt><dd>Нажать на район</dd></div><div><dt>Закрыть окно</dt><dd><kbd>Esc</kbd></dd></div></dl><p>Градописарь создаёт вымышленные города по сиду. Названия, дома и ландшафт генерируются, а не описывают реальные поселения. Вода, застройка и дороги связаны геометрическими ограничениями.</p><p>Самостоятельная реализация, вдохновлённая <a href="https://watabou.github.io/city-generator/" target="_blank" rel="noopener noreferrer">Medieval Fantasy City Generator от watabou</a>. Код и графика оригинала не используются.</p><p>Нужную карту можно вернуть через ссылку на сид или файл проекта. Для локального сохранения используйте JSON.</p></dialog>
  ${editorWarningMarkup}
  <input id="project-file" type="file" accept="application/json,.json" hidden/>
  <div id="toast" role="status" hidden></div>
`;

$('#layer-list').insertAdjacentHTML('afterend', '<label class="check-row layer-row"><input type="checkbox" id="legend-visible" checked aria-controls="map-legend"/><span>Легенда</span></label>');
const mapBody = document.createElement('div');
mapBody.className = 'map-body';
$('#map-stage').before(mapBody);
mapBody.append($('#map-stage'));
mapBody.insertAdjacentHTML('beforeend', '<aside id="map-legend" class="map-legend" aria-labelledby="map-legend-title"><h2 id="map-legend-title">Легенда карты</h2><div id="map-legend-content" class="map-legend-content" tabindex="0" role="region" aria-label="Обозначения объектов карты"></div></aside>');

const editHelp = document.createElement('p');
editHelp.id = 'edit-help';
editHelp.hidden = true;
editHelp.textContent = 'Добавить: выберите тип здания и кликните на карту. Застройка заменится автоматически, крупный комплекс займёт квартал. Выбрать: перетаскивайте здания и меняйте размер квадратом у угла. Вода: выберите реку или море, тяните точки русла и берегов, добавляйте и удаляйте точки. Новую реку или море нарисуйте кликами и завершите Enter или кнопкой Готово. Кварталы: тяните вершины или весь квартал, расширяйте и поворачивайте его. Соседи, застройка, дороги и границы районов подстроятся. На вершинах работают стрелки и Delete. Отмена: Ctrl+Z, повтор: Ctrl+Shift+Z. Alt и перетаскивание перемещают карту. Сохраняйте правки через Экспорт → JSON.';
$('#help-dialog').append(editHelp);

function notify(message) {
    $('#toast').textContent = message;
    $('#toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        $('#toast').hidden = true;
    }, 4500);
}

function draftOptions() {
    return readGenerationForm($('#generation-form'), pendingReference);
}

function fillOptions(options) {
    options = {...options};
    for (const [old, native] of Object.entries(LEGACY_OPTION_ALIASES)) if (options[native] === undefined && options[old] !== undefined) options[native] = options[old];
    if (options.geography && options.coast === undefined) options = {
        ...options,
        coast: ['coast', 'estuary'].includes(options.geography),
        river: ['river', 'estuary'].includes(options.geography)
    };
    options = {
        ...DEFAULT_OPTIONS, ...options,
        size: {village: 16, town: 34, city: 60, capital: 92}[options.size] || options.size || DEFAULT_OPTIONS.size
    };
    writeGenerationForm($('#generation-form'), options);
    syncWaterControls();
    syncLandmarkUi();
    syncCustomObjectUi();
}

function syncCustomObjectUi(options) {
    const counts = syncCustomObjectControls($('#generation-form'), options);
    for (const [kind, key] of Object.entries(CUSTOM_OBJECT_COUNTS)) {
        const field = $(`#${key}`),
            value = `${counts[kind]} из ${field.max}${field.dataset.auto === 'true' ? ' · авто' : ''}`;
        $(`#${key}-value`).value = value;
        field.setAttribute('aria-valuetext', value);
    }
}

function syncLandmarkUi() {
    const max = syncLandmarkControls($('#generation-form'));
    for (const key of ['marketCount', 'templeCount']) {
        const field = $(`#${key}`), count = field.disabled ? 0 : Number(field.value);
        $(`#${key}-value`).value = `${count} из ${max}`;
        field.setAttribute('aria-valuetext', `${count} из ${max}`);
    }
}

function syncWaterControls() {
    for (const [key, label] of Object.entries(sliderLabels)) $(`#${key}-value`).value = label(Number($(`#${key}`).value));
    $('#river-settings').disabled = !$('#feature-river').checked;
    $('#sea-settings').disabled = !$('#feature-coast').checked;
    $('#coastOffset').disabled = !$('#feature-coast').checked;
}

function urlOptions() {
    return readGenerationLocation(location);
}

function updateUrl() {
    if (!city) return;
    if (isEditing(city)) {
        history.replaceState(null, '', `${location.pathname}${location.search}#edited-project`);
        return;
    }
    if (city.source?.format === 'mfcg') {
        history.replaceState(null, '', `${location.pathname}${location.search}#imported`);
        return;
    }
    history.replaceState(null, '', `${location.pathname}${location.search}${generationHash(city)}`);
}

const mapViewport = createMapViewport($('#map'), () => {
    editor.scaleHandles();
    $('#zoom-value').value = `${Math.round((city?.viewBox?.width || 1600) / viewport.width * 100)}%`;
});

function syncViewport(preview = true) {
    mapViewport.sync(viewport, preview && !isEditing(city));
}

function fit() {
    viewport = {...(city?.viewBox || {x: 0, y: 0, width: 1600, height: 1200})};
    syncViewport();
}

function focusGeometry(points) {
    if (!points?.length) return;
    const [x0, y0, x1, y1] = bounds(points),
        width = Math.max(x1 - x0, (y1 - y0) * 4 / 3, city.viewBox.width * .15) * 1.2;
    viewport = {x: (x0 + x1 - width) / 2, y: (y0 + y1 - width * .75) / 2, width, height: width * .75};
    syncViewport();
}

function zoom(factor, x = viewport.x + viewport.width / 2, y = viewport.y + viewport.height / 2) {
    const baseWidth = city?.viewBox?.width || 1600;
    const width = Math.max(baseWidth * .15, Math.min(Math.max(baseWidth * (isEditing(city) ? 20 : 1.5), viewport.width), viewport.width * factor)),
        ratio = width / viewport.width;
    viewport = {x: x - (x - viewport.x) * ratio, y: y - (y - viewport.y) * ratio, width, height: width * .75};
    syncViewport();
}

function repaint() {
    $('#map').innerHTML = renderMap(city, view, {
        interactive: true,
        selected,
        selectedCastle,
        selectedStreet,
        selectedBuilding: editor.selected,
        editingVertices: editor.editingVertices,
        waterOverlay: editor.waterOverlay,
        quarterOverlay: editor.quarterOverlay
    });
    mapViewport.reset(city.viewBox || {x: 0, y: 0, width: 1600, height: 1200}, !isEditing(city));
    for (const swatch of document.querySelectorAll('[data-wealth-swatch]')) swatch.style.backgroundColor = THEMES[view.theme].wealth[swatch.dataset.wealthSwatch];
    $('#map-legend').hidden = !view.legend;
    $('#legend-visible').checked = view.legend;
    const paint = `${view.theme}:${view.roofs}`;
    if (view.legend && paint !== legendPaint) {
        const legend = $('#map-legend-content'), scroll = legend.scrollTop;
        legend.innerHTML = renderMapLegend(view);
        legend.scrollTop = scroll;
        $('#map-legend').style.setProperty('--legend-paper', THEMES[view.theme].paper);
        $('#map-legend').style.setProperty('--legend-ink', THEMES[view.theme].ink);
        legendPaint = paint;
    }
    syncViewport(false);
}

function refreshLayerControls() {
    const imported = city.source?.format === 'mfcg';
    const counts = {
        sea: city.terrain.coast ? 1 : 0,
        river: city.terrain.river ? 1 : 0,
        districts: city.districts.length,
        streets: city.streets.length,
        buildings: visibleCityBuildings(city).length + (city.customObjects || []).filter(b => b.layer === 'buildings').length,
        port: city.docks.length,
        castle: imported ? city.imported.special.length : city.castle ? 1 : 0,
        market: imported ? city.imported.squares.length : city.squares?.length || (city.plaza ? 1 : 0),
        temple: city.special?.filter(b => b.kind === 'temple').length ?? (city.temple ? 1 : 0),
        walls: city.walls.length,
        fields: city.fields.length,
        greens: imported ? city.imported.greens.length : city.gardens.length,
        forest: visibleCityTrees(city).length
    };
    const importedLabels = {
        castle: 'Особые объекты',
        market: 'Площади',
        port: 'Настилы и причалы',
        temple: 'Храм (не выделен в JSON)',
        districts: 'Именованные районы'
    };
    if (isEditing(city)) {
        for (const layer of ['buildings', 'castle', 'temple']) counts[layer] = city.buildings.filter(b => (b.layer || BUILDING_TYPES[b.kind]?.layer) === layer).length;
        counts.market += city.buildings.filter(b => (b.layer || BUILDING_TYPES[b.kind]?.layer) === 'market').length;
    }
    for (const [key, visible] of Object.entries(view.layers)) {
        const toggle = $(`[data-layer-toggle="${key}"]`);
        toggle.checked = visible;
        toggle.nextElementSibling.textContent = imported ? (importedLabels[key] || LAYERS[key]) : (isEditing(city) || city.customObjects) && key === 'buildings' ? 'Здания' : LAYERS[key];
        const count = $(`[data-count="${key}"]`);
        if (count) count.textContent = key === 'labels' ? '' : num(counts[key] || 0);
    }
    $('#theme').value = view.theme;
    $('#roof-details').checked = view.roofs;
    $('#roof-details').disabled = imported;
    $('#roof-details').nextElementSibling.textContent = imported ? 'Детали крыш отсутствуют в JSON' : 'Детали крыш';
}

function syncGenerationUi({fill = false} = {}) {
    const state = generationUiState(city, {busy});
    if (fill) {
        fillOptions(state.options);
        $('#draft-hint').textContent = state.draftHint;
    }
    $('#seed').readOnly = state.seedReadOnly;
    $('#seed').placeholder = state.seedPlaceholder;
    $('#seed-hint').textContent = state.seedHint;
    $('#random-seed').disabled = state.randomDisabled;
    $('#generate').disabled = state.buildDisabled;
    $('#generate').textContent = state.buildLabel;
    $('#generate').setAttribute('aria-busy', String(busy));
    $('#generation-form').setAttribute('aria-busy', String(busy));
}

function acceptCity(next, reset = true, preserveModes = false) {
    city = next;
    ensureStreetNames(city);
    selectedStreet = null;
    if (!preserveModes) {
        originalCity = isEditing(city) ? null : city;
        editorDraft = isEditing(city) ? city : null;
    }
    selected = null;
    selectedCastle = null;
    $('#district-panel').hidden = true;
    $('#map-error').hidden = true;
    pendingReference = city.source?.referenceUrl ? {
        seed: city.options.seed,
        name: city.name,
        url: city.source.referenceUrl
    } : null;
    $('#city-name').value = city.name;
    const imported = city.source?.format === 'mfcg';
    $('#city-description').textContent = isEditing(city) ? 'Редактирование геометрии · сохранение в проект JSON' : imported ? `Импорт геометрии MFCG ${city.source.version || ''} · Только для чтения` : `${city.options.size} ячеек · ${geographyNames[city.terrain.kind]}`;
    updateStatistics();
    syncGenerationUi({fill: true});
    refreshLayerControls();
    syncModeUi();
    editor.reset();
    if (reset) viewport = {...(city.viewBox || {x: 0, y: 0, width: 1600, height: 1200})};
    repaint();
    updateUrl();
    $('#copy-link').disabled = imported;
    $('#copy-link').textContent = imported ? 'Импорт: сохраните проект JSON' : 'Скопировать ссылку на сид';
    $('#copy-mfcg-link').disabled = city.source?.format !== 'compatible' || Object.entries(EXTRA_WATER_OPTIONS).some(([key, value]) => city.options[key] !== value);
    $('#copy-mfcg-link').title = $('#copy-mfcg-link').disabled ? 'Для сравнения нужна генерация по сиду с исходной формой воды.' : 'Ссылка с теми же основными параметрами и именами MFCG';
}

function updateStatistics() {
    $('#map-statistics').textContent = isEditing(city) ? `${num(city.buildings.length)} зданий · ${num(mapDistricts(city).length)} районов · проект с ручными правками` : city.source?.format === 'mfcg' ? `${num(city.statistics.buildings)} зданий · ${num(city.districts.length)} районов · ${num(city.streets.length)} линий дорог` : `${num(city.statistics.buildings)} зданий · ${num(city.statistics.districts)} районов · ${num(city.statistics.bridges)} мостов`;
}

function syncModeUi() {
    const editing = isEditing(city);
    document.body.classList.toggle('editing-mode', editing);
    $('#tab-generate').hidden = editing;
    $('#tab-edit').hidden = !editing;
    $('#switch-mode').textContent = editing ? 'Режим генерации' : 'Редактировать карту';
    $('#switch-mode').disabled = busy;
    $('#switch-mode').setAttribute('aria-haspopup', editing ? 'false' : 'dialog');
    $('#copy-link').hidden = editing;
    $('#copy-mfcg-link').hidden = editing;
    $('#help-dialog .shortcuts').hidden = editing;
    for (const p of document.querySelectorAll('#help-dialog > p')) p.hidden = editing ? p.id !== 'edit-help' : p.id === 'edit-help';
    $('.map-tip').textContent = editing ? 'Выберите и перетащите здание · Alt + перетаскивание перемещает карту' : 'Перетащите карту · колесо для масштаба · нажмите на район';
    stage.setAttribute('aria-label', editing ? 'Редактор карты. Добавить: выберите тип и кликните на карту; Enter размещает здание в центре карты. Выбрать: перетаскивайте здания и меняйте размер квадратом у угла. Вода и Кварталы: перетаскивайте точки границ или объект целиком. Стрелки перемещают выбранное здание или точку; Delete удаляет. Alt и перетаскивание перемещают карту.' : 'Интерактивная карта. Колесо: масштаб, перетаскивание: перемещение. Стрелки, плюс, минус и Home доступны с клавиатуры.');
    showTab(editing ? 'edit' : 'generate');
}

async function build(options) {
    if (busy) return;
    busy = true;
    $('#switch-mode').disabled = true;
    $('#loading').hidden = false;
    $('#loading span').textContent = 'Запускаем генератор…';
    $('#map-error').hidden = true;
    $('#generation-form').inert = true;
    syncGenerationUi();
    try {
        const next = await generateCityInWorker(options, () => {
            $('#loading span').textContent = 'Строим кварталы и улицы…';
        }, {fallback: generateCity});
        if (!options.name && !isReferenceInput(options.seed) && city?.options.seed === next.options.seed && city.name !== city.generatedName) next.name = city.name;
        acceptCity(next);
    } catch (err) {
        $('#map-error').textContent = `Не удалось построить город: ${err.message}. Попробуйте другой сид.`;
        $('#map-error').hidden = false;
    } finally {
        busy = false;
        $('#switch-mode').disabled = false;
        $('#loading').hidden = true;
        $('#generation-form').inert = false;
        syncGenerationUi();
    }
}

function randomSeed() {
    return String(crypto.getRandomValues(new Uint32Array(1))[0] || 1);
}

async function newCity() {
    if (isEditing(city)) return;
    try {
        const options = readGenerationForm($('#generation-form'), null, {seed: randomSeed()});
        pendingReference = null;
        await build(options);
    } catch (error) {
        notify(error.message);
    }
}

$('#generation-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
        build(draftOptions());
    } catch (error) {
        notify(error.message);
    }
});
$('#new-city').addEventListener('click', newCity);
$('#random-seed').addEventListener('click', () => {
    $('#seed').value = randomSeed();
    $('#draft-hint').textContent = 'Нажмите «Построить по сиду», чтобы применить.';
});

function applyReferenceInput() {
    if (!isReferenceInput($('#seed').value.trim())) return false;
    const {options, source, name} = normalizeOptions({seed: $('#seed').value.trim()});
    pendingReference = {seed: options.seed, name, url: source.url};
    fillOptions(options);
    $('#draft-hint').textContent = `Прочитана ссылка: размер ${options.size}, замок ${options.urban_castle ? 'внутри' : 'на окраине'}, сады ${options.greens ? 'включены' : 'выключены'}. Нажмите «Построить по сиду».`;
    return true;
}

$('#generation-form').addEventListener('input', event => {
    if (event.target.dataset.customCount) event.target.dataset.auto = 'false';
    if (event.target.id === 'seed' && ['insertFromPaste', 'insertFromDrop'].includes(event.inputType)) {
        try {
            if (applyReferenceInput()) return;
        } catch { /* Incomplete URLs remain editable until change or submit. */
        }
    }
    syncWaterControls();
    syncLandmarkUi();
    syncCustomObjectUi();
    $('#draft-hint').textContent = 'Настройки изменены. Нажмите «Построить по сиду».';
});
$('#reset-custom-objects').addEventListener('click', () => {
    syncCustomObjectUi({reset: true});
    $('#draft-hint').textContent = 'Количество объектов рассчитано по размеру. Нажмите «Построить по сиду».';
});
$('#seed').addEventListener('change', () => {
    try {
        applyReferenceInput();
    } catch (error) {
        notify(error.message);
    }
});
$('#reset-water').addEventListener('click', () => {
    for (const [key, value] of Object.entries(EXTRA_WATER_OPTIONS)) $(`#${key}`).value = value;
    syncWaterControls();
    $('#draft-hint').textContent = 'Восстановлена исходная форма воды. Нажмите «Построить по сиду».';
});
$('#city-name').addEventListener('change', () => {
    city.name = $('#city-name').value.trim() || city.name;
    if (pendingReference) pendingReference.name = city.name;
    $('#city-name').value = city.name;
    repaint();
    updateUrl();
});
$('#theme').addEventListener('change', () => {
    view.theme = $('#theme').value;
    repaint();
});
$('#roof-details').addEventListener('change', () => {
    view.roofs = $('#roof-details').checked;
    repaint();
});
$('#legend-visible').addEventListener('change', () => {
    view.legend = $('#legend-visible').checked;
    repaint();
});
$('#layer-list').addEventListener('change', event => {
    const key = event.target.dataset.layerToggle;
    if (!key) return;
    view.layers[key] = event.target.checked;
    if (key === 'streets' && !view.layers.streets && selectedStreet !== null) {
        selectedStreet = null;
        $('#district-panel').hidden = true;
    }
    if (key === 'castle' && !view.layers.castle && selectedCastle !== null) {
        selectedCastle = null;
        $('#district-panel').hidden = true;
    }
    repaint();
});

function setAllLayers(visible) {
    for (const key of Object.keys(LAYERS)) view.layers[key] = visible;
    view.legend = visible;
    if (!visible && selectedStreet !== null) {
        selectedStreet = null;
        $('#district-panel').hidden = true;
    }
    if (!visible && selectedCastle !== null) {
        selectedCastle = null;
        $('#district-panel').hidden = true;
    }
    refreshLayerControls();
    repaint();
}

$('#layers-all').addEventListener('click', () => setAllLayers(true));
$('#layers-none').addEventListener('click', () => setAllLayers(false));

function showTab(id, focus = false) {
    for (const name of ['generate', 'edit', 'layers']) {
        const tab = $(`#tab-${name}`), active = name === id;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
        $(`#panel-${name}`).hidden = !active;
    }
    if (focus) $(`#tab-${id}`).focus();
}

for (const id of ['generate', 'edit', 'layers']) {
    $(`#tab-${id}`).addEventListener('click', () => showTab(id));
    $(`#tab-${id}`).addEventListener('keydown', e => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            const first = isEditing(city) ? 'edit' : 'generate';
            showTab(e.key === 'Home' ? first : e.key === 'End' ? 'layers' : id === 'layers' ? first : 'layers', true);
        }
    });
}
$('#toggle-sidebar').addEventListener('click', () => {
    const open = $('.workspace').classList.toggle('settings-open');
    $('#toggle-sidebar').setAttribute('aria-expanded', String(open));
});

$('#zoom-in').addEventListener('click', () => zoom(.8));
$('#zoom-out').addEventListener('click', () => zoom(1.25));
$('#fit-map').addEventListener('click', fit);
const stage = $('#map-stage'), pointers = new Map();
let drag = null;
const editor = createEditorUi({
    getCity: () => city, getView: () => view, repaint, notify, mapPoint, focusGeometry, stage, onChange: () => {
        updateStatistics();
        refreshLayerControls();
        updateUrl();
    }
});
new ResizeObserver(() => {
    if (city) syncViewport();
}).observe(stage);

$('#switch-mode').addEventListener('click', () => {
    if (!city || busy) return;
    if (isEditing(city)) {
        editorDraft = city;
        if (!originalCity) originalCity = generateCity(DEFAULT_OPTIONS);
        acceptCity(originalCity, true, true);
    } else {
        pendingEditedProject = null;
        $('#edit-warning').showModal();
    }
});
$('#edit-decline').addEventListener('click', () => $('#edit-warning').close());
$('#edit-warning').addEventListener('close', () => {
    pendingEditedProject = null;
});
$('#edit-agree').addEventListener('click', () => {
    try {
        originalCity = city;
        if (pendingEditedProject) {
            editorDraft = pendingEditedProject.city;
            view = normalizeView(pendingEditedProject.view);
            pendingEditedProject = null;
        } else editorDraft ||= enterEditor(city);
        $('#edit-warning').close();
        acceptCity(editorDraft, false, true);
    } catch (error) {
        notify(`Не удалось открыть редактор: ${error.message}`);
    }
});

function mapPoint(clientX, clientY) {
    return viewportPoint(viewport, $('#map').getBoundingClientRect(), clientX, clientY);
}

stage.addEventListener('wheel', e => {
    e.preventDefault();
    const p = mapPoint(e.clientX, e.clientY);
    zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12, ...p);
}, {passive: false});
stage.addEventListener('pointerdown', e => {
    if (e.target.closest('.map-tools') || e.button > 0) return;
    mapViewport.finish();
    mapViewport.beginGesture();
    const target = document.elementFromPoint(e.clientX, e.clientY) || e.target;
    stage.focus({preventScroll: true});
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    drag = {
        client: [e.clientX, e.clientY],
        viewport: {...viewport},
        moved: false,
        target: target.closest('[data-district]')?.dataset.district,
        street: target.closest('[data-street]')?.dataset.street,
        castle: target.closest('[data-castle]')?.dataset.castle
    };
    if (pointers.size === 2) {
        drag.pinch = distancePair();
        drag.moved = true;
        drag.target = null;
        drag.castle = null;
    }
});

function distancePair() {
    const p = [...pointers.values()];
    return Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
}

stage.addEventListener('pointermove', e => {
    if (!drag || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) {
        const d = distancePair();
        if (drag.pinch && d > 0) zoom(drag.pinch / d);
        drag.pinch = d;
        drag.moved = true;
        return;
    }
    const dx = e.clientX - drag.client[0], dy = e.clientY - drag.client[1];
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    const rect = stage.getBoundingClientRect(),
        scale = Math.min(rect.width / drag.viewport.width, rect.height / drag.viewport.height);
    viewport = {...drag.viewport, x: drag.viewport.x - dx / scale, y: drag.viewport.y - dy / scale};
    stage.classList.add('dragging');
    syncViewport();
});

function stopPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (!pointers.size) mapViewport.endGesture();
    if (drag && !drag.moved && e.type === 'pointerup') {
        if (drag.street !== undefined && drag.street !== null) selectStreet(drag.street);
        else if (drag.castle !== undefined && drag.castle !== null) selectCastle(drag.castle);
        else if (drag.target) selectDistrict(drag.target);
    }
    drag = pointers.size === 1 ? {
        client: [...pointers.values()][0],
        viewport: {...viewport},
        moved: true,
        target: null
    } : null;
    stage.classList.remove('dragging');
}

stage.addEventListener('pointerup', stopPointer);
stage.addEventListener('pointercancel', stopPointer);
stage.addEventListener('lostpointercapture', stopPointer);
stage.addEventListener('keydown', e => {
    if (e.target !== stage) return;
    const step = viewport.width * .06;
    if (['+', '=', '-', '_', 'Home', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();
    if (['+', '='].includes(e.key)) zoom(.8);
    if (['-', '_'].includes(e.key)) zoom(1.25);
    if (e.key === 'Home') fit();
    if (e.key === 'ArrowLeft') viewport.x -= step;
    if (e.key === 'ArrowRight') viewport.x += step;
    if (e.key === 'ArrowUp') viewport.y -= step;
    if (e.key === 'ArrowDown') viewport.y += step;
    syncViewport();
});
document.addEventListener('keydown', e => {
    if (e.target.closest('input,select,textarea,button,dialog') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.toLowerCase() === 'n') newCity();
    if (e.key === 'Escape') {
        editor.clearSelection();
        selected = null;
        selectedCastle = null;
        selectedStreet = null;
        $('#district-panel').hidden = true;
        repaint();
        $('.workspace').classList.remove('settings-open');
        $('#toggle-sidebar').setAttribute('aria-expanded', 'false');
    }
});

function selectDistrict(id) {
    if (isEditing(city)) return;
    selectedStreet = null;
    selectedCastle = null;
    selected = id;
    const d = city.districts.find(d => d.id === id);
    if (!d) return;
    $('#selection-kind').textContent = 'Выбранный район';
    const houses = city.buildings.filter(b => b.district === id).length;
    $('#district-title').textContent = d.name;
    $('#district-name').value = d.name;
    const polygonArea = area(d.polygon) - (d.rings?.slice(1).reduce((sum, ring) => sum + area(ring), 0) || 0);
    const landmarks = [['market', 'Рынки'], ['temple', 'Храмы']].filter(([kind]) => d.features?.includes(kind)).map(([kind, label]) => `${label.toLocaleLowerCase('ru')}: ${d.features.filter(feature => feature === kind).length}`);
    $('#district-info').textContent = `${WEALTH_LABELS[d.wealth]} · ${num(houses)} зданий · ${(polygonArea / 10000).toFixed(2).replace('.', ',')} га ${city.source?.format === 'mfcg' ? '(по экспорту MFCG)' : '(включая участки воды)'}${landmarks.length ? ' · ' + landmarks.join(' · ') : ''}`;
    $('#district-panel').hidden = false;
    repaint();
}

function selectCastle(id) {
    if (isEditing(city) || view.layers.castle === false) return;
    const object = castleMapObjects(city).find(c => c.id === id);
    if (!object) return;
    selectedStreet = null;
    selected = null;
    selectedCastle = id;
    $('#selection-kind').textContent = 'Выбранный замок';
    $('#district-title').textContent = object.castle.name || 'Замок';
    $('#district-name').value = object.castle.name || 'Замок';
    $('#district-info').textContent = `Замковый участок · ${(area(object.polygon) / 10000).toFixed(2).replace('.', ',')} га`;
    $('#district-panel').hidden = false;
    repaint();
}

function selectStreet(id) {
    if (isEditing(city) || view.layers.streets === false) return;
    const road = city.streets.find(r => r.streetId === id);
    if (!road) return;
    selected = selectedCastle = null;
    selectedStreet = id;
    $('#selection-kind').textContent = 'Выбранная улица';
    $('#district-title').textContent = road.name;
    $('#district-name').value = road.name;
    $('#district-info').textContent = 'Улица на карте города';
    $('#district-panel').hidden = false;
    repaint();
}

$('#district-name').addEventListener('change', () => {
    if (selectedStreet !== null) {
        renameStreet(city, selectedStreet, $('#district-name').value);
        selectStreet(selectedStreet);
        return;
    }
    if (selectedCastle !== null) {
        const castle = castleMapObjects(city).find(c => c.id === selectedCastle)?.castle;
        if (!castle) return;
        castle.name = $('#district-name').value.trim() || castle.name;
        selectCastle(selectedCastle);
        return;
    }
    const d = city.districts.find(d => d.id === selected);
    if (!d) return;
    d.name = $('#district-name').value.trim() || d.name;
    selectDistrict(d.id);
});
$('#close-district').addEventListener('click', () => {
    selectedStreet = null;
    selected = null;
    selectedCastle = null;
    $('#district-panel').hidden = true;
    repaint();
    stage.focus();
});
$('#map').addEventListener('keydown', e => {
    const street = e.target.closest('[data-street]');
    if (street && ['Enter', ' '].includes(e.key)) {
        e.preventDefault();
        selectStreet(street.dataset.street);
        $('#district-name').focus();
        return;
    }
    const castle = e.target.closest('[data-castle]');
    if (castle && ['Enter', ' '].includes(e.key)) {
        e.preventDefault();
        selectCastle(castle.dataset.castle);
        $('#district-name').focus();
        return;
    }
    const district = e.target.closest('[data-district]');
    if (!district || !['Enter', ' '].includes(e.key)) return;
    e.preventDefault();
    selectDistrict(district.dataset.district);
    $('#district-name').focus();
});

$('#export-open').addEventListener('click', () => {
    $('#export-status').textContent = '';
    $('[data-export="mfcg"]').hidden = city.source?.format !== 'mfcg';
    $('#export-dialog').showModal();
});
$('#help-open').addEventListener('click', () => $('#help-dialog').showModal());
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', e => {
    if (e.target === dialog) {
        const r = dialog.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
    }
}));

function download(blob, extension) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url;
    a.download = `${city.name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')}.${extension}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function exportFile(type) {
    const status = $('#export-status');
    status.textContent = 'Подготавливаем файл…';
    try {
        if (type === 'mfcg') {
            download(new Blob([JSON.stringify(exportMfcgGeoJson(city), null, 2)], {type: 'application/json'}), 'json');
        } else if (type === 'json') {
            const project = JSON.parse(serializeProject(city, view));
            if (!city.source) project.geometry = city;
            download(new Blob([JSON.stringify(project, null, 2)], {type: 'application/json'}), 'json');
        } else {
            const svg = renderMap(city, view), blob = new Blob([svg], {type: 'image/svg+xml;charset=utf-8'});
            if (type === 'svg') download(blob, 'svg');
            else {
                const url = URL.createObjectURL(blob);
                try {
                    const image = new Image();
                    image.src = url;
                    await image.decode();
                    const canvas = document.createElement('canvas');
                    canvas.width = 3200;
                    canvas.height = 2400;
                    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                    if (!png) throw new Error('Браузер не создал PNG. Попробуйте экспорт SVG.');
                    download(png, 'png');
                } finally {
                    URL.revokeObjectURL(url);
                }
            }
        }
        status.textContent = `${type.toUpperCase()}: файл готов к сохранению.`;
    } catch (err) {
        status.textContent = `Не удалось сохранить: ${err.message}`;
    }
}

document.querySelectorAll('[data-export]').forEach(button => button.addEventListener('click', () => exportFile(button.dataset.export)));
$('#import-project').addEventListener('click', () => $('#project-file').click());
$('#project-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
        if (file.size > 20 * 1024 * 1024) throw new Error('Размер проекта превышает 20 МБ.');
        const result = parseProject(await file.text(), {name: file.name.replace(/\.json$/i, '')});
        if (isEditing(result.city) && !isEditing(city)) {
            pendingEditedProject = result;
            $('#edit-warning').showModal();
            return;
        }
        view = normalizeView(result.view);
        acceptCity(result.city);
        notify('Проект открыт.');
    } catch (err) {
        notify(`Не удалось открыть проект: ${err.message}`);
    } finally {
        e.target.value = '';
    }
});
$('#copy-link').addEventListener('click', async () => {
    try {
        updateUrl();
        await navigator.clipboard.writeText(location.href);
        notify('Ссылка на сид и параметры скопирована. Переименованные кварталы сохраняются в JSON.');
    } catch {
        notify('Браузер не разрешил копирование. Ссылку можно скопировать из адресной строки.');
    }
});
$('#copy-mfcg-link').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(mfcgReferenceUrl(city));
        notify('Ссылка MFCG с параметрами текущего города скопирована. Полное совпадение генерации пока не достигнуто.');
    } catch {
        notify('Не удалось скопировать ссылку MFCG.');
    }
});

function buildFromLocation() {
    if (isEditing(city)) return;
    const result = urlOptions();
    view = normalizeView({...view, layers: {...view.layers, ...result.view?.layers}});
    return build(result.options);
}

window.addEventListener('hashchange', () => {
    try {
        buildFromLocation();
    } catch (error) {
        notify(error.message);
    }
});
try {
    await buildFromLocation();
} catch (error) {
    $('#map-error').textContent = error.message;
    $('#map-error').hidden = false;
}
