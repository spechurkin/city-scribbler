import {centroid} from '../core/geometry.js';
import {
    applyQuarterChange,
    ensureQuarterEditor,
    planDistrictWealthChange,
    planQuarterChange
} from './quarter-editor.js';
import {WEALTH_LABELS} from '../districts/district-wealth.js';
import {insertWaterPoint} from './water-editor.js';

export const quarterEditorMarkup = `<div id="edit-quarter-panel" hidden>
  <div class="control-section"><label class="field-label" for="edit-quarter-list">Квартал</label><select id="edit-quarter-list"></select><button id="edit-quarter-focus" class="outline-button">Показать квартал</button><p id="edit-quarter-empty" class="field-hint" hidden>У этой карты нет кварталов. Откройте карту с районами или постройте новый город.</p></div>
  <div id="edit-quarter-settings" class="control-section"><label class="field-label" for="edit-quarter-district">Район квартала</label><select id="edit-quarter-district"></select><label class="field-label spaced" for="edit-district-wealth">Тип района</label><select id="edit-district-wealth" aria-describedby="edit-district-wealth-hint">${Object.entries(WEALTH_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select><p id="edit-district-wealth-hint" class="field-hint">Меняет тип всего района, включая остальные его кварталы. Существующие здания и границы сохраняются.</p><label id="edit-quarter-ring-label" class="field-label spaced" for="edit-quarter-ring">Граница</label><select id="edit-quarter-ring"></select>
    <fieldset class="editor-tools water-point-tools"><legend class="field-label">Вершины границы</legend><label><input name="quarter-point-tool" type="radio" value="move" checked aria-label="Передвигать вершины квартала"/>Тянуть</label><label><input name="quarter-point-tool" type="radio" value="insert" aria-label="Добавить вершину квартала"/>Добавить</label><label><input name="quarter-point-tool" type="radio" value="delete" aria-label="Удалить вершину квартала"/>Удалить</label></fieldset>
    <div class="editor-size-actions"><button id="edit-quarter-smaller" class="outline-button">Сузить</button><button id="edit-quarter-larger" class="outline-button">Расширить</button></div><button id="edit-quarter-rotate" class="outline-button">Повернуть на 15°</button><button id="edit-quarter-remove-point" class="outline-button">Удалить выбранную вершину</button><p class="field-hint">Тяните вершины или весь квартал. Соседние границы и дороги подстраиваются. Подходящие дома сохраняются; освободившееся место заполняется только вдоль дорог возле правки. Новые дома не меньше 9 × 9 м.</p><p class="field-hint">Особые, именованные и добавленные здания сохраняют форму и размеры. Если им не хватает места, правка не применяется. «Отменить» возвращает всю геометрию и застройку одним действием.</p></div></div>`;

export function createQuarterEditorUi({
                                          getCity,
                                          active,
                                          repaint,
                                          changed,
                                          status,
                                          notify,
                                          history,
                                          mapPoint,
                                          focusGeometry,
                                          stage
                                      }) {
    const $ = selector => document.querySelector(selector);
    let selected = null, ringIndex = 0, pointIndex = null, action = 'move', pointer = null;
    const state = () => ensureQuarterEditor(getCity());
    const quarters = () => getCity().editor.quarters;
    const quarter = () => quarters().find(q => q.id === selected);
    const rings = () => quarter()?.rings || (quarter() ? [quarter().polygon] : []);
    const points = () => rings()[ringIndex] || [];
    const mobile = () => matchMedia('(max-width:820px)').matches;
    const closeMobile = () => {
        if (mobile()) {
            $('.workspace').classList.remove('settings-open');
            $('#toggle-sidebar').setAttribute('aria-expanded', 'false');
            stage.focus({preventScroll: true});
        }
    };
    const error = message => {
        status(message);
        if (mobile()) notify(message);
    };
    const path = p => p.length ? `M${p.map(p => p.join(',')).join('L')}Z` : '';

    function sync() {
        if (!active()) return;
        const catalog = state().catalog;
        if (!quarter()) {
            selected = quarters()[0]?.id || null;
            pointIndex = null;
            ringIndex = 0;
        }
        $('#edit-quarter-list').replaceChildren(...quarters().map((q, i) => new Option(`Квартал ${i + 1} · ${catalog.find(d => d.id === q.district)?.name || 'Без района'}`, q.id)));
        $('#edit-quarter-list').value = selected || '';
        $('#edit-quarter-list').disabled = !quarter();
        $('#edit-quarter-focus').disabled = !quarter();
        $('#edit-quarter-empty').hidden = !!quarter();
        $('#edit-quarter-settings').hidden = !quarter();
        if (!quarter()) return;
        $('#edit-quarter-district').replaceChildren(...catalog.map(d => new Option(d.name, d.id)));
        $('#edit-quarter-district').value = quarter().district;
        const district = catalog.find(d => d.id === quarter().district);
        $('#edit-district-wealth').value = district?.wealth || '';
        $('#edit-district-wealth').disabled = !district;
        if (ringIndex >= rings().length) ringIndex = 0;
        if (pointIndex !== null && pointIndex >= points().length) pointIndex = points().length - 1;
        $('#edit-quarter-ring').replaceChildren(...rings().map((_, i) => new Option(i ? `Внутренняя граница ${i}` : 'Внешняя граница', String(i))));
        $('#edit-quarter-ring').value = String(ringIndex);
        $('#edit-quarter-ring').hidden = $('#edit-quarter-ring-label').hidden = rings().length < 2;
        $('#edit-quarter-remove-point').disabled = pointIndex === null || points().length <= 3;
    }

    function apply(change, nextIndex = pointIndex) {
        const restoreFocus = !!document.activeElement?.closest?.('[data-quarter-point]');
        const plan = planQuarterChange(getCity(), selected, {...change, ring: ringIndex});
        if (!plan.ok) {
            error(plan.message);
            sync();
            repaint();
            return false;
        }
        history().record(getCity());
        applyQuarterChange(getCity(), plan);
        pointIndex = nextIndex;
        changed(`Квартал изменён. Границы районов обновлены.${plan.populated ? ` Заново построено домов: ${plan.populated}.` : ''}${plan.rearranged ? ` Переставлено зданий: ${plan.rearranged}.` : ''}${plan.removedHouses ? ` Обычных домов и лавок стало меньше на ${plan.removedHouses}.` : ''}${plan.removed ? ` Убрано затопленных зданий: ${plan.removed}.` : ''}`);
        if (restoreFocus) $(`[data-quarter-point="${pointIndex}"]`)?.focus({preventScroll: true});
        return true;
    }

    function removePoint(index = pointIndex) {
        if (index === null || !quarter()) return;
        apply({type: 'delete', index}, Math.max(0, index - 1));
    }

    function transform(scale, angle = 0) {
        if (!quarter()) return;
        const center = centroid(quarter().polygon), c = Math.cos(angle), s = Math.sin(angle);
        const next = rings().map(r => r.map(p => {
            const x = (p[0] - center[0]) * scale, y = (p[1] - center[1]) * scale;
            return [center[0] + x * c - y * s, center[1] + x * s + y * c];
        }));
        apply({type: 'transform', rings: next});
    }

    $('#edit-quarter-list').addEventListener('change', e => {
        selected = e.target.value;
        pointIndex = null;
        ringIndex = 0;
        sync();
        repaint();
        closeMobile();
    });
    $('#edit-quarter-district').addEventListener('change', e => apply({type: 'district', district: e.target.value}));
    $('#edit-district-wealth').addEventListener('change', e => {
        const district = getCity().districts.find(d => d.id === quarter()?.district);
        if (!district || district.wealth === e.target.value) return;
        const plan = planDistrictWealthChange(getCity(), district.id, e.target.value);
        if (!plan.ok) {
            error(plan.message);
            sync();
            return;
        }
        history().record(getCity());
        applyQuarterChange(getCity(), plan);
        changed(`${district.name}: ${WEALTH_LABELS[e.target.value].toLocaleLowerCase('ru')}.`);
    });
    $('#edit-quarter-ring').addEventListener('change', e => {
        ringIndex = Number(e.target.value);
        pointIndex = null;
        sync();
        repaint();
        closeMobile();
    });
    document.querySelectorAll('[name="quarter-point-tool"]').forEach(input => input.addEventListener('change', () => {
        action = input.value;
        repaint();
        closeMobile();
        status(action === 'insert' ? 'Кликните у границы квартала, чтобы добавить вершину.' : action === 'delete' ? 'Кликните на вершину, чтобы удалить её.' : 'Перетаскивайте вершины или весь квартал.');
    }));
    $('#edit-quarter-smaller').addEventListener('click', () => transform(.95));
    $('#edit-quarter-focus').addEventListener('click', () => {
        if (quarter()) {
            closeMobile();
            focusGeometry(quarter().polygon);
        }
    });
    $('#edit-quarter-larger').addEventListener('click', () => transform(1.05));
    $('#edit-quarter-rotate').addEventListener('click', () => transform(1, Math.PI / 12));
    $('#edit-quarter-remove-point').addEventListener('click', () => removePoint());

    stage.addEventListener('pointerdown', e => {
        if (!active() || e.target.closest('.map-tools') || e.button > 0 || e.altKey || e.pointerType === 'touch' && !e.isPrimary) return;
        e.stopImmediatePropagation();
        stage.focus({preventScroll: true});
        stage.setPointerCapture(e.pointerId);
        const handle = e.target.closest('[data-quarter-point]'), target = e.target.closest('[data-quarter-select]');
        if (target && selected !== target.dataset.quarterSelect) {
            selected = target.dataset.quarterSelect;
            ringIndex = 0;
            pointIndex = null;
        }
        if (handle) pointIndex = Number(handle.dataset.quarterPoint);
        pointer = {
            id: e.pointerId,
            at: mapPoint(e.clientX, e.clientY),
            client: [e.clientX, e.clientY],
            moved: false,
            point: handle ? Number(handle.dataset.quarterPoint) : null,
            target: !!target,
            original: quarter() ? structuredClone(quarter()) : null
        };
        sync();
        repaint();
    }, true);
    stage.addEventListener('pointermove', e => {
        if (!active() || !pointer || pointer.id !== e.pointerId) return;
        e.stopImmediatePropagation();
        if (Math.hypot(e.clientX - pointer.client[0], e.clientY - pointer.client[1]) > 4) pointer.moved = true;
        if (!pointer.moved || action !== 'move' || !pointer.original) return;
        const at = mapPoint(e.clientX, e.clientY), originalRings = pointer.original.rings || [pointer.original.polygon];
        let preview;
        if (pointer.point !== null) {
            pointer.change = {type: 'move', index: pointer.point, point: at};
            preview = originalRings[ringIndex].map((p, i) => i === pointer.point ? at : p);
        } else if (pointer.target) {
            const dx = at[0] - pointer.at[0], dy = at[1] - pointer.at[1];
            pointer.change = {type: 'transform', rings: originalRings.map(r => r.map(p => [p[0] + dx, p[1] + dy]))};
            preview = pointer.change.rings[ringIndex];
        }
        if (preview && $('#editor-preview')) {
            const k = 1 / $('#map svg').getScreenCTM().a;
            $('#editor-preview').innerHTML = `<path d="${path(preview)}" fill="none" stroke="#3d5747" stroke-width="${2 * k}"/>`;
        }
    }, true);

    function stop(e) {
        if (!pointer || pointer.id !== e.pointerId) return;
        e.stopImmediatePropagation();
        const pending = pointer;
        pointer = null;
        if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
        if (e.type !== 'pointerup') {
            repaint();
            return;
        }
        if (pending.moved && pending.change) apply(pending.change);
        else if (pending.point !== null && action === 'delete') removePoint(pending.point);
        else if (pending.point === null && action === 'insert' && quarter()) {
            const inserted = insertWaterPoint(points(), pending.at, true);
            apply({type: 'insert', index: inserted.index - 1, point: pending.at}, inserted.index);
        } else repaint();
    }

    stage.addEventListener('pointerup', stop, true);
    stage.addEventListener('pointercancel', stop, true);
    stage.addEventListener('lostpointercapture', () => {
        pointer = null;
    });
    stage.addEventListener('keydown', e => {
        if (!active() || e.target.closest('input,select,button')) return;
        const handle = e.target.closest('[data-quarter-point]');
        if (handle) pointIndex = Number(handle.dataset.quarterPoint);
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            pointer = null;
            pointIndex = null;
            sync();
            repaint();
            return;
        }
        if (['Delete', 'Backspace'].includes(e.key)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            removePoint();
            return;
        }
        if (handle && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            const p = points()[pointIndex], step = e.shiftKey ? 10 : 1;
            apply({
                type: 'move',
                index: pointIndex,
                point: [p[0] + (({ArrowLeft: -step, ArrowRight: step})[e.key] || 0), p[1] + (({
                    ArrowUp: -step,
                    ArrowDown: step
                })[e.key] || 0)]
            });
        }
    }, true);
    return {
        sync,
        cancelInteraction() {
            pointer = null;
            $('#editor-preview')?.replaceChildren();
        },
        reset() {
            pointer = null;
            selected = null;
            pointIndex = null;
            ringIndex = 0;
            action = 'move';
            $('[name="quarter-point-tool"][value="move"]').checked = true;
        },
        render() {
            if (!active()) return '';
            state();
            const k = getCity().viewBox.width / 1600;
            const targets = quarters().map(q => `<path d="${(q.rings || [q.polygon]).map(path).join('')}" fill="transparent" fill-rule="evenodd" stroke="${q.id === selected ? '#9e5b43' : '#6a4935'}" stroke-opacity="${q.id === selected ? 1 : .45}" stroke-width="${(q.id === selected ? 2 : .8) * k}" data-quarter-select="${q.id}" data-quarter-border="${q.id === selected ? 'selected' : 'other'}" class="quarter-target"/>`).join('');
            const handles = points().map(([x, y], i) => `<g transform="translate(${x} ${y})" data-quarter-select="${selected}" data-quarter-point="${i}" role="button" tabindex="0" aria-label="Вершина квартала ${i + 1}" class="quarter-point"><circle r="${12 * k}" fill="transparent" data-quarter-hit="true"/><circle r="${5 * k}" fill="${pointIndex === i ? '#9e5b43' : '#f7f5ef'}" stroke="#6a4935" stroke-width="${1.5 * k}" data-quarter-handle="true"/></g>`).join('');
            return `<g id="editor-quarter-controls">${targets}${handles}</g>`;
        },
        scale(k) {
            for (const c of document.querySelectorAll('[data-quarter-handle]')) {
                c.setAttribute('r', 5 * k);
                c.setAttribute('stroke-width', 1.5 * k);
            }
            for (const c of document.querySelectorAll('[data-quarter-hit]')) c.setAttribute('r', 12 * k);
            for (const p of document.querySelectorAll('[data-quarter-border]')) p.setAttribute('stroke-width', (p.dataset.quarterBorder === 'selected' ? 2 : .8) * k);
        }
    };
}
