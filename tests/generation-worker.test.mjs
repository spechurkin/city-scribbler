import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {generateCityInWorker} from '../src/generation/generation-client.js';

test('generation client terminates its worker on success, generation failure and loading failure', async () => {
    const original = globalThis.Worker;
    let current;
    globalThis.Worker = class {
        constructor(url, options) {
            assert.equal(url.pathname.endsWith('/generation-worker.js'), true);
            assert.equal(options.type, 'module');
            current = this;
        }

        postMessage(options) {
            this.options = options;
        }

        terminate() {
            this.terminated = true;
        }
    };
    try {
        const options = {seed: '42', size: 100}, city = {name: 'Test'};
        const success = generateCityInWorker(options);
        assert.equal(current.options, options);
        current.onmessage({data: {city}});
        assert.equal(await success, city);
        assert.equal(current.terminated, true);
        const fallback = generateCityInWorker(options, undefined, {fallback: () => city, startupTimeout: 1});
        assert.equal(await fallback, city);
        assert.equal(current.terminated, true);
        const failure = generateCityInWorker(options);
        current.onmessage({data: {error: 'Rejected city'}});
        await assert.rejects(failure, /Rejected city/);
        assert.equal(current.terminated, true);
        const loading = generateCityInWorker(options);
        current.onerror({message: 'Module load failed'});
        await assert.rejects(loading, /Module load failed/);
        assert.equal(current.terminated, true);
        const transfer = generateCityInWorker(options);
        current.onmessageerror();
        await assert.rejects(transfer, /получить построенный город/);
        assert.equal(current.terminated, true);
    } finally {
        globalThis.Worker = original;
    }
});

test('real generation worker returns cloneable geometry and reports invalid recipes', async () => {
    const url = new URL('../src/generation/generation-worker.js', import.meta.url).href;
    const worker = new Worker(`
        const {parentPort} = require('node:worker_threads');
        globalThis.self = {postMessage: value => parentPort.postMessage(value)};
        import(${JSON.stringify(url)}).then(() => parentPort.on('message', data => self.onmessage({data})));
    `, {eval: true});
    const request = options => new Promise((resolve, reject) => {
        const receive = data => {
            if (data.phase) return;
            worker.off('message', receive);
            resolve(data);
        };
        worker.on('message', receive);
        worker.once('error', reject);
        worker.postMessage(options);
    });
    try {
        const {city, error} = await request({seed: '1424740', size: 6});
        assert.equal(error, undefined);
        assert.equal(city.options.seed, '1424740');
        assert.ok(city.buildings.length > 0 && city.customObjects.length > 0);
        assert.equal(city.generatedGeometry.format, 'gradopisets-structure');
        assert.match((await request({seed: 'invalid'})).error, /сид/);
    } finally {
        await worker.terminate();
    }
});
