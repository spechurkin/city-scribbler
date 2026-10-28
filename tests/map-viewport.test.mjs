import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapViewport, rasterPlacement, viewportPoint} from '../src/map/map-viewport.js';

test('map coordinates and raster projection agree through letterboxing, pan and zoom', () => {
    const base = {x: -400, y: -300, width: 1600, height: 1200};
    for (const [width, height] of [[1200, 600], [400, 800], [1440, 1080]]) {
        for (const factor of [.15, .7, 1, 1.5]) {
            const view = {x: -123, y: 76, width: base.width * factor, height: base.height * factor};
            const p = rasterPlacement(base, view, width, height);
            for (const [u, v] of [[0, 0], [.5, .5], [1, 1]]) {
                const point = viewportPoint(view, {
                    left: 20,
                    top: 30,
                    width,
                    height
                }, 20 + p.x + u * p.width, 30 + p.y + v * p.height);
                assert.ok(Math.abs(point[0] - (base.x + u * base.width)) < 1e-8);
                assert.ok(Math.abs(point[1] - (base.y + v * base.height)) < 1e-8);
            }
        }
    }
});

test('a paused drag keeps the bitmap and restores the latest vector viewport on release', t => {
    const previous = new Map();
    const replace = (key, value) => {
        previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
    };
    t.after(() => {
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
    let frame, timer, writes = 0;
    replace('requestAnimationFrame', callback => {
        frame = callback;
        return 1;
    });
    replace('cancelAnimationFrame', () => {
        frame = null;
    });
    replace('setTimeout', callback => {
        timer = callback;
        return 1;
    });
    replace('clearTimeout', () => {
        timer = null;
    });
    replace('XMLSerializer', class {
        serializeToString() {
            return '<svg/>';
        }
    });
    replace('devicePixelRatio', 1);
    const bitmap = {
        style: {}, setAttribute() {
        }, getContext: () => ({
            drawImage() {
            }
        }), remove() {
        }
    };
    replace('document', {createElement: () => bitmap});
    replace('Image', class {
        set src(value) {
            this.onload();
        }
    });
    const svg = {
        style: {}, setAttribute(key, value) {
            this[key] = value;
            writes++;
        },
        cloneNode: () => ({
            style: {}, setAttribute() {
            }
        })
    };
    const container = {
        querySelector: () => svg, append() {
        }, clientWidth: 800, clientHeight: 600
    };
    const controller = createMapViewport(container, () => {
    });
    controller.reset({x: 0, y: 0, width: 1600, height: 1200});
    controller.beginGesture();
    controller.sync({x: 100, y: 50, width: 800, height: 600});
    frame();
    assert.equal(svg.style.display, 'none');
    assert.equal(bitmap.hidden, false);
    assert.equal(timer, null, 'a held pointer must not schedule an idle vector redraw');
    assert.equal(writes, 0);
    controller.endGesture();
    timer();
    assert.equal(svg.viewBox, '100 50 800 600');
    assert.equal(svg.style.display, '');
    assert.equal(bitmap.hidden, true);
});

test('viewport coalesces input bursts and applies the latest view when no bitmap is available', t => {
    let callback, requested = 0, handled = 0;
    t.mock.method(globalThis, 'setTimeout', () => 1);
    t.mock.method(globalThis, 'clearTimeout', () => {
    });
    const oldRequest = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = fn => {
        callback = fn;
        requested++;
        return 1;
    };
    globalThis.cancelAnimationFrame = () => {
    };
    t.after(() => {
        globalThis.requestAnimationFrame = oldRequest;
        globalThis.cancelAnimationFrame = oldCancel;
    });
    const attributes = {}, svg = {style: {}, setAttribute: (key, value) => attributes[key] = value};
    const controller = createMapViewport({querySelector: () => svg}, () => handled++);
    controller.reset({x: 0, y: 0, width: 1600, height: 1200}, false);
    for (let i = 0; i < 100; i++) controller.sync({x: i, y: -i, width: 800, height: 600});
    assert.equal(requested, 1);
    callback();
    assert.equal(handled, 1);
    assert.equal(attributes.viewBox, '99 -99 800 600');
    assert.equal(svg.style.opacity, '');
});
