import {bounds} from '../core/geometry.js';
import {
    applyBuildingPlan,
    BUILDING_TYPES,
    buildingLabel,
    buildingTypeGroups,
    createBuilding,
    createEditorHistory,
    isEditing,
    placementHint,
    planBuildingPlacement,
    planBuildingReplacement,
    removeEditorBuilding,
    transformBuilding
} from './building-editor.js';
import {renderEditorBuilding} from '../rendering/render-edited.js';
import {THEMES} from '../rendering/render.js';
import {createWaterEditorUi, waterEditorMarkup} from './water-editor-ui.js';
import {createQuarterEditorUi, quarterEditorMarkup} from './quarter-editor-ui.js';
import {editorHistoryAction, keepsTextHistory} from './editor-shortcuts.js';
import {applyPort, planPort, portContext} from '../water/ports.js';

const options = buildingTypeGroups({editable: true}).map(group => `<optgroup label="${group.label}">${group.entries.map(([key, value]) => `<option value="${key}"${key === 'house' ? ' selected' : ''}>${value.label}</option>`).join('')}</optgroup>`).join('');
export const editorMarkup = `
  <section id="panel-edit" role="tabpanel" aria-labelledby="tab-edit" hidden>
    <div class="control-section"><h2 class="editor-title">Редактор города</h2><div class="editor-history"><button id="edit-undo" class="outline-button" title="Отменить (Ctrl+Z)" aria-keyshortcuts="Control+Z Meta+Z" disabled>Отменить</button><button id="edit-redo" class="outline-button" title="Повторить (Ctrl+Shift+Z)" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y" disabled>Повторить</button></div>
      <fieldset class="editor-tools"><legend class="sr-only">Инструмент</legend><label><input type="radio" name="editor-tool" value="select" checked/> Выбрать</label><label><input type="radio" name="editor-tool" value="add"/> Добавить</label><label><input type="radio" name="editor-tool" value="water"/> Вода</label><label><input type="radio" name="editor-tool" value="quarters"/> Кварталы</label><label><input type="radio" name="editor-tool" value="pan"/> Карта</label></fieldset>
      <p id="edit-status" class="field-hint" role="status">Выберите здание, чтобы передвинуть или увеличить его.</p>
      <label class="check-row"><input type="radio" name="editor-tool" value="port"/><span>Добавить порт</span></label>
      <label class="check-row"><input id="edit-street-snap" type="checkbox" checked aria-describedby="edit-street-snap-hint"/><span>Привязка зданий к улицам</span></label><p id="edit-street-snap-hint" class="field-hint">При добавлении и переносе здание выравнивается вдоль края улицы. Удерживайте Shift для свободного размещения.</p>
    </div>
    <div id="edit-add-panel" class="control-section" hidden><label class="field-label" for="edit-add-kind">Новое здание</label><select id="edit-add-kind">${options}</select><div class="editor-symbol-key"><svg id="edit-symbol-preview" viewBox="-12 -12 24 24" aria-label="Вид здания сверху" role="img"></svg><span id="edit-add-scope"></span></div><p id="edit-add-hint" class="field-hint"></p><p class="field-hint">Кликните на карту. Застройка под контуром здания заменится автоматически. Размер не подстраивается под участок.</p></div>
    ${waterEditorMarkup}
    ${quarterEditorMarkup}
    <div id="edit-port-panel" class="control-section" hidden><label class="field-label" for="edit-port-count">Пирсов в порту</label><select id="edit-port-count"><option value="3">3</option><option value="4" selected>4</option><option value="6">6</option></select><p class="field-hint">Кликните у берега реки или моря. Пирсы привяжутся к свободной набережной. Если места мало, порт будет меньше. Отменить добавление можно кнопкой «Отменить».</p></div>
    <div id="edit-selected-panel" class="control-section" hidden><p class="small-label">Выбранное здание</p><h3 id="edit-selected-type" class="editor-title"></h3><p id="edit-building-info" class="field-hint"></p><label class="field-label spaced" for="edit-name">Название</label><input id="edit-name" maxlength="80" placeholder="По типу здания"/><div class="editor-size-actions"><button id="edit-smaller" class="outline-button">Уменьшить</button><button id="edit-larger" class="outline-button">Увеличить</button></div><button id="edit-rotate" class="outline-button">Повернуть на 15°</button><p class="field-hint">Перетаскивайте здание для переноса. Квадрат у правого нижнего угла меняет размер.</p><button id="edit-delete" class="text-button">Удалить здание</button></div>
    <p class="panel-description">Правки сохраняются в проект JSON через «Экспорт».</p>
  </section>`;

export const editorWarningMarkup = `<dialog id="edit-warning" aria-labelledby="edit-warning-title"><div class="dialog-heading"><h2 id="edit-warning-title">Перейти к редактированию?</h2></div><p>После изменения геометрии эта карта не будет совместима с MFCG. Вернуть правки по сиду или ссылке нельзя. Для продолжения работы сохраняйте проект JSON.</p><p>Исходная карта останется в режиме генерации. Правки редактора сохранятся при переключении режимов в этой сессии.</p><div class="editor-dialog-actions"><button id="edit-decline" class="outline-button" autofocus>Остаться в генерации</button><button id="edit-agree" class="primary-button">Согласен, редактировать</button></div></dialog>`;

export function createEditorUi({getCity, getView, repaint, onChange, notify, mapPoint, focusGeometry, stage}) {
    const $ = selector => document.querySelector(selector);
    let selected = null, tool = 'select', pointer = null, previewFrame = null, renameSession = null,
        hoverPlacement = null;
    const histories = new WeakMap();
    const active = () => isEditing(getCity());
    const current = () => getCity()?.buildings.find(b => b.id === selected);
    const status = message => {
        $('#edit-status').textContent = message;
    };
    const mobile = () => matchMedia('(max-width: 820px)').matches;
    const snapOptions = event => {
        const matrix = $('#map svg').getScreenCTM();
        return {snapDistance: $('#edit-street-snap').checked && !event?.shiftKey ? 12 / Math.hypot(matrix.a, matrix.b) : 0};
    };
    const history = () => {
        const city = getCity();
        if (!histories.has(city)) histories.set(city, createEditorHistory());
        return histories.get(city);
    };
    const water = createWaterEditorUi({
        getCity,
        getView,
        active: () => active() && tool === 'water',
        repaint,
        changed,
        status,
        notify,
        history,
        mapPoint,
        focusGeometry,
        stage
    });
    const quarters = createQuarterEditorUi({
        getCity,
        active: () => active() && tool === 'quarters',
        repaint,
        changed,
        status,
        notify,
        history,
        mapPoint,
        focusGeometry,
        stage
    });

    function sync() {
        if (!active()) return;
        const building = current(), kind = $('#edit-add-kind').value, rule = BUILDING_TYPES[kind];
        $('#edit-undo').disabled = !history().canUndo;
        $('#edit-redo').disabled = !history().canRedo;
        $('#edit-add-panel').hidden = tool !== 'add';
        $('#edit-selected-panel').hidden = !building || tool !== 'select';
        $('#edit-water-panel').hidden = tool !== 'water';
        if (tool === 'water') water.sync();
        $('#edit-quarter-panel').hidden = tool !== 'quarters';
        $('#edit-port-panel').hidden = tool !== 'port';
        if (tool === 'quarters') quarters.sync();
        $('#edit-add-hint').textContent = placementHint(kind);
        $('#edit-add-scope').textContent = `${rule.width} × ${rule.height} м`;
        const previewCity = {...getCity(), editor: {...getCity().editor, water: null}},
            scale = 20 / Math.max(rule.width, rule.height);
        const preview = transformBuilding(createBuilding(previewCity, kind, [0, 0]), {
            scaleX: scale,
            scaleY: scale,
            origin: [0, 0]
        });
        $('#edit-symbol-preview').innerHTML = renderEditorBuilding(preview, previewCity, {
            ...getView(),
            roofs: true
        }, THEMES[getView().theme] || THEMES.atlas);
        stage.dataset.editorTool = tool;
        if (!building) return;
        $('#edit-name').value = building.name;
        const guardhouse = building.kind === 'guardhouse';
        for (const id of ['edit-name', 'edit-smaller', 'edit-larger', 'edit-rotate', 'edit-delete']) $(`#${id}`).disabled = guardhouse;
        $('#edit-selected-panel').querySelector('p:last-of-type').textContent = guardhouse
            ? 'Перетаскивайте караульню или перемещайте её стрелками. Она должна оставаться в своём районе.'
            : 'Перетаскивайте здание для переноса. Квадрат у правого нижнего угла меняет размер.';
        $('#edit-selected-type').textContent = BUILDING_TYPES[building.kind].label;
        const district = getCity().districts.find(d => d.id === building.district);
        $('#edit-building-info').textContent = (district?.name || 'За пределами районов') + (guardhouse ? '. Обязательная караульня: можно только передвигать внутри района.' : '');
    }

    function select(id, focus = false) {
        selected = id;
        sync();
        repaint();
        if (focus && current() && current().kind !== 'guardhouse') $('#edit-name').focus();
    }

    function changed(message) {
        sync();
        onChange();
        repaint();
        status(message);
        if (mobile()) notify(message);
    }

    function apply(plan) {
        if (!plan.ok) {
            status(plan.message);
            if (mobile()) notify(plan.message);
            return false;
        }
        history().record(getCity());
        const building = applyBuildingPlan(getCity(), plan);
        selected = building.id;
        getView().layers[BUILDING_TYPES[building.kind].layer] = true;
        changed(`${buildingLabel(building)}. ${plan.remove.length ? `Заменено зданий: ${plan.remove.length}.` : 'Готово.'}${plan.snap ? ' Привязано к улице.' : ''}`);
        return true;
    }

    function clearPreview() {
        if (previewFrame !== null) cancelAnimationFrame(previewFrame);
        previewFrame = null;
        hoverPlacement = null;
        $('#editor-preview')?.replaceChildren();
    }

    const portPlan = point => planPort(portContext(getCity()), point, {count: Number($('#edit-port-count').value)});

    function addPort(point) {
        const plan = portPlan(point);
        if (!plan.ok) {
            status(plan.message);
            notify(plan.message);
            return;
        }
        history().record(getCity());
        applyPort(getCity(), plan);
        getView().layers.port = true;
        changed(`Порт добавлен. Пирсов: ${plan.docks.length}.`);
    }

    function previewPort(point) {
        if (previewFrame !== null) cancelAnimationFrame(previewFrame);
        previewFrame = requestAnimationFrame(() => {
            previewFrame = null;
            const plan = portPlan(point), layer = $('#editor-preview');
            if (!layer) return;
            layer.innerHTML = plan.ok ? plan.docks.map(d => `<path d="M${d.points[0].join(',')}L${d.points[1].join(',')}" fill="none" stroke="${THEMES[getView().theme]?.accent || '#294e36'}" stroke-width="${d.width}" opacity=".7"/>`).join('') : '';
            status(plan.ok ? `Кликните, чтобы добавить порт. Пирсов: ${plan.docks.length}.` : plan.message);
        });
    }

    function preview(makePlan, dragging = false) {
        if (previewFrame !== null) cancelAnimationFrame(previewFrame);
        previewFrame = requestAnimationFrame(() => {
            previewFrame = null;
            if (!active() || !$('#editor-preview')) return;
            const plan = makePlan(), matrix = $('#map svg').getScreenCTM(), k = 1 / Math.hypot(matrix.a, matrix.b);
            const poly = (p, attrs) => `<path d="M${p.map(p => p.join(',')).join('L')}Z" ${attrs}/>`;
            const removed = new Set(plan.remove || []);
            const guide = plan.snap ? `<path data-street-snap="true" d="M${plan.snap.a.join(',')}L${plan.snap.b.join(',')}" fill="none" stroke="#294e36" stroke-width="${2 * k}" stroke-dasharray="${5 * k} ${3 * k}"/>` : '';
            const body = plan.building ? `<g opacity=".65">${renderEditorBuilding(plan.building, getCity(), getView(), THEMES[getView().theme] || THEMES.atlas)}</g>${poly(plan.building.polygon, `fill="none" stroke="${plan.ok ? '#294e36' : '#a33524'}" stroke-width="${2 * k}"`)}` : '';
            $('#editor-preview').innerHTML = guide + getCity().buildings.filter(b => removed.has(b.id)).map(b => poly(b.polygon, `fill="#a33524" fill-opacity=".25" stroke="#a33524" stroke-width="${k}"`)).join('') + body;
            status(plan.ok ? `${plan.snap ? 'Привязка к улице. ' : ''}Здание готово к размещению.${plan.remove.length ? ` Построек на замену: ${plan.remove.length}.` : ''} ${dragging ? 'Отпустите, чтобы применить.' : 'Кликните, чтобы применить.'}` : plan.message);
        });
    }

    function setTool(next) {
        water.cancelInteraction();
        quarters.cancelInteraction();
        tool = next;
        if (next === 'port') selected = null;
        $(`input[name="editor-tool"][value="${next}"]`).checked = true;
        clearPreview();
        sync();
        repaint();
        $('.map-tip').textContent = next === 'quarters' ? 'Тяните вершины кварталов · Alt + перетаскивание перемещает карту' : next === 'water' ? 'Тяните точки воды · Alt + перетаскивание перемещает карту' : 'Выберите и перетащите здание · Alt + перетаскивание перемещает карту';
        if (next === 'port') {
            $('.map-tip').textContent = 'Кликните у берега, чтобы добавить порт · Alt + перетаскивание перемещает карту';
            status('Выберите свободный берег реки или моря. Порт привяжется к набережной.');
            return;
        }
        status(next === 'quarters' ? 'Выберите квартал и передвигайте его вершины. Районы и застройка подстроятся.' : next === 'water' ? 'Выберите реку или море. Тяните точки, чтобы менять берега и изгибы.' : next === 'add' ? 'Выберите здание и кликните на карту.' : next === 'pan' ? 'Перетаскивайте карту. Колесо меняет масштаб.' : 'Выберите здание, чтобы передвинуть или увеличить его.');
    }

    function travelHistory(action) {
        if (!active()) return;
        if (!(action === 'undo' ? history().canUndo : history().canRedo)) return;
        const pointerId = pointer?.id;
        pointer = null;
        if (pointerId !== undefined && stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
        water.cancelInteraction();
        quarters.cancelInteraction();
        renameSession = null;
        history()[action](getCity());
        if (!current()) selected = null;
        clearPreview();
        changed(action === 'undo' ? 'Действие отменено.' : 'Действие повторено.');
    }

    function deleteSelected() {
        if (!active() || !current()) return;
        if (current().kind === 'guardhouse') {
            status('Караульня обязательна для района и не удаляется.');
            return;
        }
        history().record(getCity());
        removeEditorBuilding(getCity(), selected);
        selected = null;
        changed('Здание удалено. Действие можно отменить.');
    }

    document.querySelectorAll('[name="editor-tool"]').forEach(input => input.addEventListener('change', () => setTool(input.value)));
    $('#edit-add-kind').addEventListener('change', () => {
        clearPreview();
        sync();
        status('Кликните на карту, чтобы разместить здание.');
        if (mobile()) {
            $('.workspace').classList.remove('settings-open');
            $('#toggle-sidebar').setAttribute('aria-expanded', 'false');
            stage.focus({preventScroll: true});
        }
    });
    $('#edit-undo').addEventListener('click', () => travelHistory('undo'));
    $('#edit-redo').addEventListener('click', () => travelHistory('redo'));
    $('#edit-street-snap').addEventListener('change', () => {
        clearPreview();
        status($('#edit-street-snap').checked ? 'Привязка к улицам включена. Shift временно отключает её.' : 'Привязка к улицам отключена. Здания размещаются свободно.');
    });
    $('#edit-delete').addEventListener('click', deleteSelected);
    for (const [id, scale] of [['edit-smaller', .85], ['edit-larger', 1.15]]) $(`#${id}`).addEventListener('click', () => {
        if (current()) apply(planBuildingReplacement(getCity(), transformBuilding(current(), {
            scaleX: scale,
            scaleY: scale
        })));
    });
    $('#edit-rotate').addEventListener('click', () => {
        if (current()) apply(planBuildingReplacement(getCity(), transformBuilding(current(), {angle: Math.PI / 12})));
    });
    $('#edit-name').addEventListener('input', () => {
        if (!current() || current().kind === 'guardhouse' || current().name === $('#edit-name').value) return;
        if (renameSession !== selected) {
            history().record(getCity());
            renameSession = selected;
        }
        current().name = $('#edit-name').value;
        $('#edit-undo').disabled = false;
        $('#edit-redo').disabled = true;
        repaint();
        status('Название сохранено.');
    });
    $('#edit-name').addEventListener('blur', () => {
        if (renameSession && current()) {
            current().name = current().name.trim();
            sync();
            repaint();
        }
        renameSession = null;
    });

    stage.addEventListener('pointerdown', e => {
        if (!active() || e.target.closest('.map-tools') || e.button > 0 || ['pan', 'water', 'quarters'].includes(tool) || e.altKey || e.pointerType === 'touch' && !e.isPrimary) return;
        const target = e.target.closest('[data-building]');
        if (tool === 'port') {
            e.stopImmediatePropagation();
            stage.focus({preventScroll: true});
            stage.setPointerCapture(e.pointerId);
            pointer = {
                id: e.pointerId,
                point: mapPoint(e.clientX, e.clientY),
                client: [e.clientX, e.clientY],
                moved: false,
                port: true
            };
            return;
        }
        if (tool !== 'add' && !target) return;
        e.stopImmediatePropagation();
        stage.focus({preventScroll: true});
        stage.setPointerCapture(e.pointerId);
        pointer = {
            id: e.pointerId,
            point: mapPoint(e.clientX, e.clientY),
            client: [e.clientX, e.clientY],
            moved: false,
            targetId: target?.dataset.building,
            resize: e.target.dataset.resize
        };
        if (tool !== 'add') {
            pointer.building = structuredClone(getCity().buildings.find(b => b.id === target.dataset.building));
            select(pointer.building.id);
        }
    }, true);
    stage.addEventListener('pointermove', e => {
        if (!active() || ['water', 'quarters'].includes(tool) || e.target.closest('.map-tools')) return;
        const point = mapPoint(e.clientX, e.clientY);
        if (tool === 'port') {
            if (pointer) {
                e.stopImmediatePropagation();
                if (Math.hypot(e.clientX - pointer.client[0], e.clientY - pointer.client[1]) > 4) pointer.moved = true;
            } else if (!e.altKey) previewPort(point);
            return;
        }
        if (!pointer) {
            if (tool === 'add') {
                const targetId = e.target.closest('[data-building]')?.dataset.building;
                hoverPlacement = {point, targetId};
                const options = {...snapOptions(e), targetId};
                preview(() => planBuildingPlacement(getCity(), $('#edit-add-kind').value, point, {
                    ...options,
                    regenerateStreets: false
                }));
            }
            return;
        }
        if (pointer.id !== e.pointerId) return;
        e.stopImmediatePropagation();
        if (Math.hypot(e.clientX - pointer.client[0], e.clientY - pointer.client[1]) > 4) pointer.moved = true;
        if (tool === 'add') return;
        const building = pointer.building;
        if (pointer.resize) {
            const [x0, y0, x1, y1] = bounds(building.polygon);
            pointer.candidate = transformBuilding(building, {
                scaleX: Math.max(2, x1 - x0 + point[0] - pointer.point[0]) / (x1 - x0),
                scaleY: Math.max(2, y1 - y0 + point[1] - pointer.point[1]) / (y1 - y0),
                origin: [x0, y0]
            });
        } else pointer.candidate = transformBuilding(building, {
            dx: point[0] - pointer.point[0],
            dy: point[1] - pointer.point[1]
        });
        const candidate = pointer.candidate, options = pointer.resize ? {} : snapOptions(e);
        preview(() => planBuildingReplacement(getCity(), candidate, {...options, regenerateStreets: false}), true);
    }, true);

    function stop(e) {
        if (!pointer || pointer.id !== e.pointerId) return;
        e.stopImmediatePropagation();
        const pending = pointer;
        pointer = null;
        clearPreview();
        if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
        if (e.type !== 'pointerup') {
            repaint();
            return;
        }
        if (pending.port) {
            if (!pending.moved) addPort(pending.point);
            return;
        }
        if (tool === 'add' && !pending.moved) apply(planBuildingPlacement(getCity(), $('#edit-add-kind').value, pending.point, {targetId: pending.targetId, ...snapOptions(e)}));
        else if (pending.moved && pending.candidate) apply(planBuildingReplacement(getCity(), pending.candidate, pending.resize ? {} : snapOptions(e)));
    }

    stage.addEventListener('pointerup', stop, true);
    stage.addEventListener('pointercancel', stop, true);
    stage.addEventListener('lostpointercapture', () => {
        pointer = null;
        clearPreview();
    });
    stage.addEventListener('pointerleave', () => {
        if (!pointer) clearPreview();
    });
    for (const event of ['keydown', 'keyup']) document.addEventListener(event, e => {
        if (e.key !== 'Shift' || !active()) return;
        const options = snapOptions(e);
        if (pointer?.candidate && !pointer.resize) {
            const candidate = pointer.candidate;
            preview(() => planBuildingReplacement(getCity(), candidate, {...options, regenerateStreets: false}), true);
        } else if (!pointer && tool === 'add' && hoverPlacement) {
            const {point, targetId} = hoverPlacement;
            preview(() => planBuildingPlacement(getCity(), $('#edit-add-kind').value, point, {
                ...options,
                targetId,
                regenerateStreets: false
            }));
        }
    });
    stage.addEventListener('keydown', e => {
        if (!active() || ['water', 'quarters'].includes(tool)) return;
        const target = e.target.closest('[data-building]');
        if (tool === 'port' && e.key === 'Enter' && e.target === stage) {
            e.preventDefault();
            e.stopImmediatePropagation();
            const box = stage.getBoundingClientRect();
            addPort(mapPoint(box.x + box.width / 2, box.y + box.height / 2));
            return;
        }
        if (tool === 'add' && e.target === stage && e.key === 'Enter') {
            e.preventDefault();
            e.stopImmediatePropagation();
            const box = stage.getBoundingClientRect();
            apply(planBuildingPlacement(getCity(), $('#edit-add-kind').value, mapPoint(box.x + box.width / 2, box.y + box.height / 2), snapOptions(e)));
            return;
        }
        if (target && ['Enter', ' '].includes(e.key)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            select(target.dataset.building, true);
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            pointer = null;
            clearPreview();
            selected = null;
            setTool('select');
            return;
        }
        if (e.target !== stage && !target) return;
        if (['Delete', 'Backspace'].includes(e.key)) {
            e.preventDefault();
            deleteSelected();
            return;
        }
        if (current() && tool === 'select' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            const step = e.shiftKey ? 10 : 1;
            apply(planBuildingReplacement(getCity(), transformBuilding(current(), {
                dx: ({
                    ArrowLeft: -step,
                    ArrowRight: step
                })[e.key] || 0, dy: ({ArrowUp: -step, ArrowDown: step})[e.key] || 0
            })));
        }
    }, true);
    document.addEventListener('keydown', e => {
        if (!active() || e.target.closest('dialog') || keepsTextHistory(e.target)) return;
        const action = editorHistoryAction(e);
        if (!action) return;
        e.preventDefault();
        travelHistory(action);
    });

    return {
        get selected() {
            return tool === 'select' ? selected : null;
        },
        get editingVertices() {
            return false;
        },
        get waterOverlay() {
            return water.render();
        },
        get quarterOverlay() {
            return quarters.render();
        },
        scaleHandles() {
            if (!active()) return;
            const matrix = $('#map svg').getScreenCTM(), k = 1 / Math.hypot(matrix.a, matrix.b);
            water.scale(k);
            quarters.scale(k);
            if (!current() || !$('#editor-selection')) return;
            $('#editor-selection').setAttribute('stroke-width', 1.7 * k);
            const resize = $('#editor-selection [data-resize]'), [, , x1, y1] = bounds(current().polygon);
            if (resize) for (const [key, value] of Object.entries({
                x: x1 + 4 * k,
                y: y1 + 4 * k,
                width: 9 * k,
                height: 9 * k
            })) resize.setAttribute(key, value);
        },
        reset() {
            pointer = null;
            selected = null;
            clearPreview();
            water.reset();
            quarters.reset();
            tool = 'select';
            $('[name="editor-tool"][value="select"]').checked = true;
            if (active()) sync(); else delete stage.dataset.editorTool;
        },
        clearSelection() {
            const pointerId = pointer?.id;
            pointer = null;
            if (pointerId !== undefined && stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
            selected = null;
            clearPreview();
            sync();
        },
        sync
    };
}
