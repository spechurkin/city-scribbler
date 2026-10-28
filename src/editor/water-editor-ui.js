import {
    applyWaterChange,
    editedWaterPoints,
    insertWaterPoint,
    planWaterChange,
    translateWaterBody,
    withWaterPoints
} from './water-editor.js';
import {ensureEditorWater, waterBodyGeometry} from '../water/water-geometry.js';

export const waterEditorMarkup = `<div id="edit-water-panel" hidden>
  <div class="control-section"><label class="field-label" for="edit-water-body">Река или море</label><select id="edit-water-body"></select><button id="edit-water-focus" class="outline-button">Показать водоём</button><div class="editor-size-actions"><button id="edit-new-river" class="outline-button">Добавить реку</button><button id="edit-new-sea" class="outline-button">Добавить море</button></div><p id="edit-water-empty" class="field-hint" hidden>На карте нет воды. Добавьте реку или море.</p></div>
  <div id="edit-water-drawing" class="control-section" hidden><p id="edit-water-drawing-hint" class="field-hint"></p><div class="editor-size-actions"><button id="edit-water-finish" class="primary-button">Готово</button><button id="edit-water-cancel" class="outline-button">Отмена</button></div></div>
  <div id="edit-water-settings" class="control-section"><label class="field-label" for="edit-water-boundary">Что изменять</label><select id="edit-water-boundary"></select><fieldset class="editor-tools water-point-tools"><legend class="field-label">Точки контура</legend><label><input name="water-point-tool" type="radio" value="move" checked/>Тянуть</label><label><input name="water-point-tool" type="radio" value="insert"/>Добавить</label><label><input name="water-point-tool" type="radio" value="delete"/>Удалить</label></fieldset><div id="edit-water-width-panel"><div class="range-label"><label for="edit-water-width">Ширина реки</label><output id="edit-water-width-value"></output></div><input id="edit-water-width" type="range" min="2" max="500" step="1"/><p class="field-hint">Ширина и русло заново формируют берега.</p></div><label id="edit-water-smooth-label" class="check-row"><input id="edit-water-smooth" type="checkbox"/>Плавные изгибы</label><button id="edit-water-remove-point" class="outline-button">Удалить выбранную точку</button><button id="edit-water-remove" class="text-button">Удалить водоём</button><p class="field-hint">Тяните точки, чтобы менять контур. Начало и конец реки тоже передвигаются. Для переноса всего водоёма тяните за воду. Alt и перетаскивание перемещают карту.</p><p class="field-hint">Затопленные постройки убираются автоматически. «Отменить» возвращает и воду, и застройку.</p></div>
</div>`;

export function createWaterEditorUi({
                                        getCity,
                                        getView,
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
    let selected = null, boundary = 'course', pointIndex = null, action = 'move', pointer = null, draft = null;
    const state = () => ensureEditorWater(getCity());
    const body = () => state().bodies.find(b => b.id === selected);
    const points = () => body() ? editedWaterPoints(body(), boundary) : [];
    const closed = () => body()?.kind === 'sea' || boundary !== 'course';
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
    const path = (p, close = false) => p.length ? `M${p.map(p => p.join(',')).join('L')}${close ? 'Z' : ''}` : '';

    function sync() {
        if (!active()) return;
        const water = state(), list = $('#edit-water-body');
        if (!body()) {
            selected = water.bodies[0]?.id || null;
            pointIndex = null;
            boundary = 'course';
        }
        let rivers = 0, seas = 0;
        list.replaceChildren(...water.bodies.map(b => new Option(`${b.kind === 'river' ? 'Река' : 'Море'} ${b.kind === 'river' ? ++rivers : ++seas}`, b.id)));
        if (!water.bodies.length) list.append(new Option('Нет водоёмов', ''));
        list.value = selected || '';
        list.disabled = !water.bodies.length || !!draft;
        $('#edit-water-focus').disabled = !body() || !!draft;
        $('#edit-water-empty').hidden = !!water.bodies.length || !!draft;
        $('#edit-water-settings').hidden = !body() || !!draft;
        $('#edit-water-drawing').hidden = !draft;
        if (draft) {
            $('#edit-water-drawing-hint').textContent = `${draft.kind === 'river' ? 'Отметьте начало, изгибы и конец реки' : 'Отметьте точки морского контура'}. Точек: ${draft.points.length}. Enter завершает, Escape отменяет.`;
            $('#edit-water-finish').disabled = draft.points.length < (draft.kind === 'river' ? 2 : 3);
        }
        if (!body()) return;
        const entries = body().kind === 'river' ? [['course', 'Русло, начало и конец'], ['banks', 'Берега реки']] : [['course', 'Морской берег'], ...(body().holes || []).map((_, i) => [`hole-${i}`, `Остров ${i + 1}`])];
        if (!entries.some(([key]) => key === boundary)) boundary = 'course';
        $('#edit-water-boundary').replaceChildren(...entries.map(([key, label]) => new Option(label, key)));
        $('#edit-water-boundary').value = boundary;
        if (pointIndex !== null && pointIndex >= points().length) pointIndex = points().length - 1;
        $('#edit-water-remove-point').disabled = pointIndex === null || points().length <= (closed() ? 3 : 2);
        $('#edit-water-width-panel').hidden = body().kind !== 'river';
        $('#edit-water-width').max = Math.min(10000, Math.max(500, Math.ceil((body().width || 2) * 2)));
        $('#edit-water-width').value = body().width || 2;
        $('#edit-water-width-value').textContent = `${Math.round(body().width || 2)} м`;
        $('#edit-water-smooth-label').hidden = boundary !== 'course';
        $('#edit-water-smooth').checked = body().smooth;
    }

    function apply(bodies, id = selected, index = pointIndex) {
        const restoreFocus = !!document.activeElement?.closest?.('[data-water-point]');
        const plan = planWaterChange(getCity(), bodies);
        if (!plan.ok) {
            error(plan.message);
            sync();
            repaint();
            return false;
        }
        history().record(getCity());
        applyWaterChange(getCity(), plan);
        selected = id;
        pointIndex = index;
        const next = state().bodies.find(b => b.id === id);
        if (next) getView().layers[next.kind] = true;
        changed(`Вода изменена.${plan.removed ? ` Убрано затопленных зданий: ${plan.removed}.` : ''}`);
        if (restoreFocus) $(`[data-water-point="${pointIndex}"]`)?.focus({preventScroll: true});
        return true;
    }

    const replace = candidate => state().bodies.map(b => b.id === candidate.id ? candidate : b);

    function preview(candidate) {
        const container = $('#editor-preview');
        if (!container) return;
        try {
            const geometry = waterBodyGeometry(candidate), k = 1 / $('#map svg').getScreenCTM().a;
            container.innerHTML = `<path d="${[geometry.polygon, ...(geometry.holes || [])].map(p => path(p, true)).join('')}" fill="#afc5c3" fill-opacity=".7" fill-rule="evenodd" stroke="#3d5747" stroke-width="${2 * k}"/>`;
        } catch {
            container.innerHTML = `<path d="${path(candidate.points)}" fill="none" stroke="#8c3524" stroke-width="2"/>`;
        }
    }

    function removePoint(index = pointIndex) {
        if (!body() || index === null) return;
        if (points().length <= (closed() ? 3 : 2)) return error(closed() ? 'У контура должно остаться хотя бы три точки.' : 'У реки должны остаться начало и конец.');
        const next = points().filter((_, i) => i !== index).map(p => [...p]);
        apply(replace(withWaterPoints(body(), next, boundary)), selected, Math.min(index, next.length - 1));
    }

    function startDrawing(kind) {
        draft = {
            id: `water-${state().nextId}`,
            kind,
            points: [],
            smooth: kind === 'river', ...(kind === 'river' ? {width: Math.max(6, Math.min(100, getCity().viewBox.width * .012))} : {holes: []})
        };
        pointer = null;
        pointIndex = null;
        boundary = 'course';
        sync();
        repaint();
        closeMobile();
        status(kind === 'river' ? 'Кликните начало реки, затем изгибы и конец. Нажмите «Готово» или Enter.' : 'Отметьте морской контур и нажмите «Готово» или Enter.');
    }

    function finishDrawing() {
        if (!draft || draft.points.length < (draft.kind === 'river' ? 2 : 3)) return;
        const candidate = draft;
        draft = null;
        if (!apply([...state().bodies, candidate], candidate.id, 0)) {
            draft = candidate;
            sync();
            repaint();
        }
    }

    function cancelInteraction() {
        pointer = null;
        draft = null;
        $('#editor-preview')?.replaceChildren();
    }

    $('#edit-water-body').addEventListener('change', e => {
        selected = e.target.value;
        boundary = 'course';
        pointIndex = null;
        getView().layers[body().kind] = true;
        sync();
        repaint();
        closeMobile();
        status('Перетаскивайте точки или весь водоём.');
    });
    $('#edit-water-boundary').addEventListener('change', e => {
        boundary = e.target.value;
        pointIndex = null;
        sync();
        repaint();
        closeMobile();
    });
    document.querySelectorAll('[name="water-point-tool"]').forEach(input => {
        input.setAttribute('aria-label', ({
            move: 'Передвигать точки воды',
            insert: 'Добавить точку воды',
            delete: 'Удалить точку воды'
        })[input.value]);
        input.addEventListener('change', () => {
            action = input.value;
            repaint();
            closeMobile();
            status(action === 'insert' ? 'Кликните на контур или за концом реки, чтобы добавить точку.' : action === 'delete' ? 'Кликните на точку, чтобы удалить её.' : 'Перетаскивайте точки или весь водоём.');
        });
    });
    $('#edit-new-river').addEventListener('click', () => startDrawing('river'));
    $('#edit-water-focus').addEventListener('click', () => {
        if (body()) {
            closeMobile();
            focusGeometry(points());
        }
    });
    $('#edit-new-sea').addEventListener('click', () => startDrawing('sea'));
    $('#edit-water-finish').addEventListener('click', finishDrawing);
    $('#edit-water-cancel').addEventListener('click', () => {
        cancelInteraction();
        sync();
        repaint();
        status('Добавление водоёма отменено.');
    });
    $('#edit-water-remove-point').addEventListener('click', () => removePoint());
    $('#edit-water-remove').addEventListener('click', () => apply(state().bodies.filter(b => b.id !== selected), null, null));
    $('#edit-water-width').addEventListener('input', e => {
        if (!body()) return;
        $('#edit-water-width-value').textContent = `${e.target.value} м`;
        const candidate = {...body(), width: Number(e.target.value)};
        delete candidate.outline;
        preview(candidate);
    });
    $('#edit-water-width').addEventListener('change', e => {
        if (!body()) return;
        const candidate = {...body(), width: Number(e.target.value)};
        delete candidate.outline;
        apply(replace(candidate));
    });
    $('#edit-water-smooth').addEventListener('change', e => {
        if (!body()) return;
        const candidate = {...body(), smooth: e.target.checked};
        delete candidate.outline;
        apply(replace(candidate));
    });

    stage.addEventListener('pointerdown', e => {
        if (!active() || e.target.closest('.map-tools') || e.button > 0 || e.altKey || e.pointerType === 'touch' && !e.isPrimary) return;
        e.stopImmediatePropagation();
        stage.focus({preventScroll: true});
        stage.setPointerCapture(e.pointerId);
        const handle = e.target.closest('[data-water-point]'), target = e.target.closest('[data-water-select]'),
            at = mapPoint(e.clientX, e.clientY);
        if (target && target.dataset.waterSelect !== selected) {
            selected = target.dataset.waterSelect;
            boundary = 'course';
            pointIndex = null;
        }
        if (handle) pointIndex = Number(handle.dataset.waterPoint);
        pointer = {
            id: e.pointerId,
            at,
            client: [e.clientX, e.clientY],
            moved: false,
            point: handle ? Number(handle.dataset.waterPoint) : null,
            target: !!target,
            original: body() ? structuredClone(body()) : null
        };
        sync();
        repaint();
    }, true);
    stage.addEventListener('pointermove', e => {
        if (!active() || !pointer || pointer.id !== e.pointerId) return;
        e.stopImmediatePropagation();
        if (Math.hypot(e.clientX - pointer.client[0], e.clientY - pointer.client[1]) > 4) pointer.moved = true;
        if (draft || action !== 'move' || !pointer.original || !pointer.moved) return;
        const at = mapPoint(e.clientX, e.clientY), delta = [at[0] - pointer.at[0], at[1] - pointer.at[1]];
        if (pointer.point !== null) {
            const next = editedWaterPoints(pointer.original, boundary).map(p => [...p]);
            next[pointer.point] = at;
            pointer.candidate = withWaterPoints(pointer.original, next, boundary);
        } else if (pointer.target) pointer.candidate = translateWaterBody(pointer.original, delta);
        if (pointer.candidate) preview(pointer.candidate);
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
        if (draft) {
            if (!pending.moved && (!draft.points.length || Math.hypot(pending.at[0] - draft.points.at(-1)[0], pending.at[1] - draft.points.at(-1)[1]) > .1)) draft.points.push(pending.at);
            sync();
            repaint();
        } else if (pending.moved && pending.candidate) apply(replace(pending.candidate));
        else if (action === 'delete' && pending.point !== null) removePoint(pending.point);
        else if (action === 'insert' && body() && pending.point === null) {
            const next = insertWaterPoint(points(), pending.at, closed());
            apply(replace(withWaterPoints(body(), next.points, boundary)), selected, next.index);
        } else repaint();
    }

    stage.addEventListener('pointerup', stop, true);
    stage.addEventListener('pointercancel', stop, true);
    stage.addEventListener('lostpointercapture', () => {
        pointer = null;
    });
    stage.addEventListener('keydown', e => {
        if (!active() || e.target.closest('input,select,button')) return;
        const handle = e.target.closest('[data-water-point]');
        if (handle) pointIndex = Number(handle.dataset.waterPoint);
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            cancelInteraction();
            sync();
            repaint();
            return;
        }
        if (e.key === 'Enter' && draft) {
            e.preventDefault();
            e.stopImmediatePropagation();
            finishDrawing();
            return;
        }
        if (['Delete', 'Backspace'].includes(e.key) && !draft) {
            e.preventDefault();
            e.stopImmediatePropagation();
            removePoint();
            return;
        }
        if (e.key === 'Enter' && handle) {
            e.preventDefault();
            e.stopImmediatePropagation();
            sync();
            repaint();
            return;
        }
        if (handle && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            const next = points().map(p => [...p]), step = e.shiftKey ? 10 : 1;
            next[pointIndex][0] += ({ArrowLeft: -step, ArrowRight: step})[e.key] || 0;
            next[pointIndex][1] += ({ArrowUp: -step, ArrowDown: step})[e.key] || 0;
            apply(replace(withWaterPoints(body(), next, boundary)));
        }
    }, true);

    return {
        sync,
        cancelInteraction,
        reset() {
            cancelInteraction();
            selected = null;
            boundary = 'course';
            pointIndex = null;
            action = 'move';
            $('[name="water-point-tool"][value="move"]').checked = true;
        },
        render() {
            if (!active()) return '';
            const water = state(), k = getCity().viewBox.width / 1600;
            const targets = water.bodies.map(b => {
                const shape = waterBodyGeometry(b);
                return `<path d="${path(shape.polygon, true)}" fill="transparent" stroke="transparent" stroke-width="${12 * k}" data-water-select="${b.id}" class="water-target"/>`;
            }).join('');
            const current = draft || body();
            if (!current) return `<g id="editor-water-controls">${targets}</g>`;
            const selectedPoints = draft ? current.points : points(), isClosed = !draft && closed();
            const line = `<path d="${path(selectedPoints, isClosed)}" fill="none" stroke="#3d5747" stroke-width="${1.5 * k}" stroke-dasharray="${5 * k} ${3 * k}" pointer-events="none" data-water-guide="true"/>`;
            const handles = selectedPoints.map(([x, y], i) => {
                const endpoint = current.kind === 'river' && boundary === 'course' && (i === 0 || i === selectedPoints.length - 1);
                const label = endpoint ? i === 0 ? 'Начало реки' : 'Конец реки' : `Точка ${i + 1}`;
                return `<g transform="translate(${x} ${y})" data-water-point="${i}" data-water-select="${current.id}" class="water-point" role="button" tabindex="0" aria-label="${label}"><circle r="${12 * k}" fill="transparent" data-water-hit="true"/><circle r="${5 * k}" fill="${i === pointIndex ? '#9e5b43' : endpoint ? '#afc5c3' : '#f7f5ef'}" stroke="#3d5747" stroke-width="${1.5 * k}" data-water-handle="true"/>${endpoint ? `<text x="${9 * k}" y="${-9 * k}" fill="#333a32" font-family="Segoe UI,Arial,sans-serif" font-size="${11 * k}" paint-order="stroke" stroke="#f7f5ef" stroke-width="${3 * k}" pointer-events="none" data-water-end="true">${i === 0 ? 'Начало' : 'Конец'}</text>` : ''}</g>`;
            }).join('');
            return `<g id="editor-water-controls">${targets}${line}${handles}</g>`;
        },
        scale(k) {
            for (const c of document.querySelectorAll('[data-water-handle]')) {
                c.setAttribute('r', 5 * k);
                c.setAttribute('stroke-width', 1.5 * k);
            }
            for (const c of document.querySelectorAll('[data-water-hit]')) c.setAttribute('r', 12 * k);
            for (const text of document.querySelectorAll('[data-water-end]')) for (const [key, value] of Object.entries({
                x: 9 * k,
                y: -9 * k,
                'font-size': 11 * k,
                'stroke-width': 3 * k
            })) text.setAttribute(key, value);
            for (const guide of document.querySelectorAll('[data-water-guide]')) {
                guide.setAttribute('stroke-width', 1.5 * k);
                guide.setAttribute('stroke-dasharray', `${5 * k} ${3 * k}`);
            }
        }
    };
}
