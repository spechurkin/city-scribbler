import test from 'node:test';
import assert from 'node:assert/strict';
import {editorHistoryAction} from '../src/editor/editor-shortcuts.js';

for (const modifier of ['ctrlKey', 'metaKey']) {
    for (const key of ['z', 'я', 'Z', 'Я']) {
        test(`${modifier}: undo and redo use the physical Z key with ${key}`, () => {
            const event = {[modifier]: true, code: 'KeyZ', key};
            assert.equal(editorHistoryAction(event), 'undo');
            assert.equal(editorHistoryAction({...event, shiftKey: true}), 'redo');
        });
    }
    test(`${modifier}: Y is an alternative redo shortcut in either layout`, () => {
        for (const key of ['y', 'н']) assert.equal(editorHistoryAction({[modifier]: true, code: 'KeyY', key}), 'redo');
    });
}

test('typing, composition, AltGr and already handled events do not travel through history', () => {
    const event = {ctrlKey: true, code: 'KeyZ', key: 'z'};
    for (const override of [{ctrlKey: false}, {altKey: true}, {isComposing: true}, {defaultPrevented: true}, {code: 'KeyA'}]) {
        assert.equal(editorHistoryAction({...event, ...override}), null);
    }
});

test('events without physical key codes retain standard Z and Y shortcuts', () => {
    for (const key of ['z', 'Z']) {
        assert.equal(editorHistoryAction({ctrlKey: true, key}), 'undo');
        assert.equal(editorHistoryAction({ctrlKey: true, key, shiftKey: true}), 'redo');
    }
    assert.equal(editorHistoryAction({ctrlKey: true, key: 'y'}), 'redo');
    assert.equal(editorHistoryAction({ctrlKey: true, key: 'a'}), null);
});
