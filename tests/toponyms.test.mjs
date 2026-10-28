import test from 'node:test';
import assert from 'node:assert/strict';
import {
    districtNameContexts,
    districtNameFitsOccupation,
    districtNameFitsWater,
    generateCastleNames,
    generateCityName,
    generateDistrictNames,
    generateToponym,
    settlementType
} from '../src/generation/toponyms.js';
import {cityFromGeometry, generateCity} from '../src/generation/interactive-city.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';
import {LAYERS, renderMap} from '../src/rendering/render.js';
import {centroid} from '../src/core/geometry.js';

const terrainKinds = [{coast: false, river: false}, {coast: false, river: true}, {
    coast: true,
    river: false
}, {coast: true, river: true}];

test('outdoor professions require a land frontier or an extramural district in every name form', () => {
    const occupations = ['Слобода Рудокопов', 'Шахтёрский район', 'Шахтерская слобода', 'Рудная слобода',
        'Стрелецкая слобода', 'Слобода Стрельцов', 'Слобода Лесорубов', 'Ямская слобода',
        'Слобода Ямщиков', 'Пушкарская слобода', 'Слобода Пушкарей', 'Солдатская слобода',
        'Угольный район', 'Никольское подворье Рудокопов', 'Торговая слобода Лесорубов'];
    for (const name of occupations) {
        for (const context of [{}, {coast: true}, {river: true}, {proximity: 'far'}]) assert.equal(districtNameFitsOccupation(name, context), false, name);
        assert.equal(districtNameFitsOccupation(name, {landEdge: true}), true, name);
        assert.equal(districtNameFitsOccupation(name, {kind: 'outskirts'}), true, name);
    }
    for (const name of ['Слобода Кузнецов', 'Слобода Плотников', 'Слобода Гончаров', 'Слобода Рыбаков', 'Купеческий район']) assert.equal(districtNameFitsOccupation(name), true, name);
    const districts = [
        {id: 'center', kind: 'regular'}, {id: 'port', kind: 'docks', coast: true},
        {id: 'wall', kind: 'regular', landEdge: true}, {id: 'outer', kind: 'outskirts'}
    ];
    const seen = new Set();
    for (let seed = 1; seed <= 1000; seed++) {
        const names = generateDistrictNames(seed, districts);
        for (const d of districts) {
            assert.equal(districtNameFitsOccupation(names[d.id], d), true, names[d.id]);
            if (!districtNameFitsOccupation(names[d.id])) seen.add(d.id);
        }
        assert.deepEqual(generateDistrictNames(seed, [...districts].reverse()), names);
    }
    assert.deepEqual([...seen].sort(), ['outer', 'wall']);
});

test('land frontier excludes the sea, castle walls and contact at a single corner', () => {
    const box = (x, y, w = 10, h = 10) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    const cells = [];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) cells.push({
        id: cells.length, urban: x >= 1 && x <= 3 && y >= 1 && y <= 3,
        water: y === 0, polygon: box(x * 10, y * 10)
    });
    cells[12].ward = 'castle';
    const districts = [
        {id: 'center', type: 'regular', polygon: box(20, 20)},
        {id: 'west', type: 'regular', polygon: box(10, 20)},
        {id: 'sea', type: 'docks', polygon: box(20, 10)},
        {id: 'corner', type: 'regular', polygon: [[10, 10], [20, 15], [15, 20]]}
    ];
    const wall = {
        polygon: [
            [10, 10], [20, 10], [30, 10], [40, 10], [40, 20], [40, 30],
            [40, 40], [30, 40], [20, 40], [10, 40], [10, 30], [10, 20]
        ]
    };
    const geometry = {
        cells, water: box(0, 0, 50, 10), rivers: [], recipe: {walls: true},
        walls: [wall, {polygon: cells[12].polygon}], experimental: {districts, specialBuildings: []}
    };
    for (const walls of [true, false]) {
        geometry.recipe.walls = walls;
        if (!walls) geometry.walls = [geometry.walls[1]];
        assert.deepEqual(districtNameContexts(geometry).map(d => d.landEdge), [false, true, false, false]);
    }
});

test('generated walled and unwalled maps keep outdoor professions on their land edges', () => {
    let peripheral = 0;
    for (const walls of [true, false]) for (const terrain of terrainKinds) {
        const city = generateCity({seed: '1931200012', size: 34, walls, ...terrain});
        for (const context of districtNameContexts(city.generatedGeometry)) {
            const name = city.districts.find(d => d.id === context.id).name;
            assert.equal(districtNameFitsOccupation(name, context), true, name);
            peripheral += Number(context.landEdge);
        }
    }
    assert.ok(peripheral > 0);
});

test('all supplied Perchance modes expand their weighted rules and case transforms', () => {
    for (const type of ['city', 'ust', 'coast', 'town', 'selo', 'village', 'poselok', 'stanitsa', 'sloboda', 'khutor', 'fortress', 'any', 'experimental']) {
        const names = new Set();
        for (let seed = 1; seed <= 250; seed++) {
            const name = generateToponym(seed, {type});
            assert.match(name, /^[А-ЯЁ][А-Яа-яЁё\s-]+$/u, `${type}: ${name}`);
            if (type === 'ust') assert.match(name, /^Усть-/);
            names.add(name);
        }
        assert.ok(names.size > 10, `${type}: ${names.size}`);
    }
    assert.throws(() => generateToponym(1, {type: 'missing'}), /Неизвестный тип/);
});

test('city naming follows geography and stays reproducible across unrelated random draws', () => {
    for (let seed = 1; seed <= 1000; seed++) for (const terrain of terrainKinds) {
        const name = generateCityName(seed, terrain);
        if (terrain.coast && terrain.river) assert.match(name, /^Усть-/);
        if (!terrain.coast) assert.doesNotMatch(name, /морск|гаван|порт|бухт|пролив|балтий/i);
        if (!terrain.river) assert.doesNotMatch(name, /Усть-|реч|Волг|Амур|Енисей|Ангар|Иркут/i);
        assert.doesNotMatch(name, /оз[её]р/i);
        generateToponym(seed, {type: 'experimental'});
        assert.equal(generateCityName(seed, terrain), name);
    }
});

test('settlement names follow ordered population tiers, falling back to map size only when population is absent', () => {
    const levels = [
        ['khutor', 0, 6], ['village', 100, 10], ['selo', 500, 16],
        ['poselok', 1000, 24], ['town', 2000, 34], ['city', 10000, 60]
    ];
    for (const [index, [type, population, size]] of levels.entries()) {
        assert.equal(settlementType({population, size: 200}), type);
        assert.equal(settlementType({size}), type);
        if (index) {
            assert.equal(settlementType({population: population - 1, size: 200}), levels[index - 1][0]);
            assert.equal(settlementType({size: size - 1}), levels[index - 1][0]);
        }
        for (const terrain of terrainKinds) for (let seed = 1; seed <= 100; seed++) {
            const context = {...terrain, size, population};
            const name = generateCityName(seed, context);
            const expectedType = type === 'city' && terrain.coast ? (terrain.river ? 'ust' : 'coast') : type;
            assert.equal(name, generateToponym(seed, {type: expectedType, terrain: context, channel: 'city-name'}));
            assert.equal(generateCityName(seed, {...context, population: null}), name);
            if (type !== 'city') assert.doesNotMatch(name, /^Усть-/);
            if (!terrain.coast) assert.doesNotMatch(name, /морск|гаван|порт|бухт|балтий/i);
            if (!terrain.river) assert.doesNotMatch(name, /Усть-|реч|Волг|Амур|Енисей|Ангар|Иркут/i);
        }
    }
    assert.equal(settlementType({population: 10000, size: 6}), 'city');
    assert.equal(settlementType({size: 200}), 'city');
});

test('fortress vocabulary names castles independently of the surrounding district', () => {
    const contexts = [{id: 'keep', coast: false, river: false}];
    for (let seed = 1; seed <= 200; seed++) {
        const names = generateCastleNames(seed, contexts);
        assert.match(names.keep, /^[А-ЯЁ]/u);
        assert.doesNotMatch(generateDistrictNames(seed, [{
            ...contexts[0],
            kind: 'castle'
        }]).keep, /крепость|острог|застава|городок/i);
        assert.deepEqual(generateCastleNames(seed, contexts), names);
    }
});

test('district names distinguish local waterfronts, parks, temples and fortifications', () => {
    const districts = [
        {id: 'coast', kind: 'docks', coast: true, river: false},
        {id: 'bank', kind: 'bank', coast: false, river: true},
        {id: 'inner', kind: 'regular', coast: false, river: false},
        {id: 'park', kind: 'park', coast: false, river: false},
        {id: 'temple', kind: 'temple', coast: false, river: false},
        {id: 'castle', kind: 'castle', coast: false, river: false}
    ];
    for (let seed = 1; seed <= 50; seed++) {
        const names = generateDistrictNames(seed, districts);
        assert.match(names.coast, /Бухта|Гавань|Пристань|^Слобода /);
        assert.match(names.bank, /набережная|берег|^Слобода /);
        assert.match(names.park, /роща$/);
        assert.match(names.temple, /кое(?: подворье .+)?$/);
        assert.doesNotMatch(names.inner, /Квартал|\d|морск|гаван|порт|бухт|реч|оз[её]р/i);
        assert.doesNotMatch(names.castle, /\d|Квартал/);
        assert.deepEqual(generateDistrictNames(seed, [...districts].reverse()), names);
    }
});

test('many districts in one city have distinct names without numbered fallbacks', () => {
    const districts = Array.from({length: 120}, (_, id) => ({
        id: String(id),
        kind: 'regular',
        coast: false,
        river: false
    }));
    const names = Object.values(generateDistrictNames('987654321', districts));
    assert.equal(new Set(names).size, districts.length);
    assert.ok(names.every(name => !/[\d\[\]]|Квартал/.test(name)));
});

test('markets always receive trading names while other districts can still use them', () => {
    const trading = /купеч|купцов|торгов|торжище|рыноч|базар|ярмар|гостин|коробейник/i;
    const vocabulary = [/Купеческий/, /Купцов/, /Торговый/, /Рыночн/, /Базарн/, /Ярмарочн/];
    const seen = new Set();
    let regularTrading = 0;
    for (let seed = 1; seed <= 500; seed++) {
        const districts = terrainKinds.flatMap((terrain, i) => ['market', 'market-temple', 'regular'].map(kind => ({
            id: `${kind}-${i}`,
            kind, ...terrain
        })));
        const names = generateDistrictNames(seed, districts);
        for (const d of districts) {
            const name = names[d.id];
            if (d.kind === 'regular') regularTrading += Number(trading.test(name));
            else {
                assert.match(name, trading, `${seed}: ${d.id}: ${name}`);
                assert.ok(districtNameFitsWater(name, d), name);
                vocabulary.forEach((pattern, i) => {
                    if (pattern.test(name)) seen.add(i);
                });
            }
        }
        assert.equal(new Set(Object.values(names)).size, districts.length);
        assert.deepEqual(generateDistrictNames(seed, [...districts].reverse()), names);
    }
    assert.equal(seen.size, vocabulary.length);
    assert.ok(regularTrading > 0);
    assert.ok(regularTrading < 500 * terrainKinds.length / 2);
});

test('water vocabulary and inflected occupations require the appropriate local water', () => {
    const waterfront = [
        'Слобода Рыбаков', 'Рыбацкая слобода', 'Рыбачий район', 'Преображенское подворье Рыбаков',
        'Светлая торговая слобода Рыбаков', 'Тихая набережная', 'Белый берег', 'Прибрежный район',
        'Береженец', 'Тихая Гавань', 'Северный Порт', 'Новая Пристань', 'Бухта Лебедей',
        'Заливный район', 'Островной район', 'Камышовая слобода', 'Старая Коса', 'Тихая Заводь', 'Белый Мыс', 'Мысовой район',
        'Слобода Парусов', 'Якорная слобода', 'Слобода Кораблей', 'Маячный район', 'Слобода Чаек',
        'Старый Мост', 'Белый Брод', 'Волногород'
    ];
    const riverNames = [
        'Заречная слобода', 'Междуречный район', 'Волгоград', 'Усть-Луга', 'Амурск', 'Енисейск',
        'Ангарск', 'Иркутск', 'Томск', 'Северодвинск', 'Родниковый район', 'Белые Ключи',
        'Прудовый район', 'Болотная слобода'
    ];
    const seaNames = [
        'Слобода Моряков', 'Моряковский район', 'Моряцкая слобода', 'Морская слобода', 'Морской район', 'Морское подворье', 'Мореходный район',
        'Беломорск', 'Моринск', 'Приморская слобода', 'Поморский район', 'Мурманск',
        'Балтийский район', 'Проливный район', 'Рифовый район', 'Штормовой район'
    ];
    for (const name of waterfront) {
        assert.equal(districtNameFitsWater(name, {}), false, name);
        assert.equal(districtNameFitsWater(name, {river: true}), true, name);
        assert.equal(districtNameFitsWater(name, {coast: true}), true, name);
    }
    for (const name of riverNames) {
        assert.equal(districtNameFitsWater(name, {}), false, name);
        assert.equal(districtNameFitsWater(name, {river: true}), true, name);
        assert.equal(districtNameFitsWater(name, {coast: true}), false, name);
    }
    for (const name of seaNames) {
        assert.equal(districtNameFitsWater(name, {}), false, name);
        assert.equal(districtNameFitsWater(name, {river: true}), false, name);
        assert.equal(districtNameFitsWater(name, {coast: true}), true, name);
    }
    for (const terrain of terrainKinds) {
        for (const name of ['Морозовская слобода', 'Заводской район', 'Рудозаводский район', 'Кузнецкая слобода']) assert.equal(districtNameFitsWater(name, terrain), true, name);
        for (const name of ['Озёрная слобода', 'Заозёрье', 'Приозёрский район']) assert.equal(districtNameFitsWater(name, terrain), false, name);
    }
});

test('fishing names are assigned to waterfront districts across all naming templates', () => {
    const contexts = [{id: 'dry', coast: false, river: false}, {id: 'river', coast: false, river: true}, {
        id: 'sea',
        coast: true,
        river: false
    }];
    let fishingSlobodas = 0;
    for (let seed = 1; seed <= 300; seed++) for (const kind of ['regular', 'park', 'market', 'temple', 'market-temple', 'castle']) {
        const names = generateDistrictNames(seed, contexts.map(d => ({...d, kind})));
        assert.doesNotMatch(names.dry, /рыб|морск|моряк|прибреж|берег|набереж|пристан|гаван|порт|бухт|залив|реч|родник|оз[её]р|волг/i);
        for (const context of contexts) {
            assert.equal(districtNameFitsWater(names[context.id], context), true, names[context.id]);
            if (names[context.id] === 'Слобода Рыбаков') {
                assert.notEqual(context.id, 'dry');
                fishingSlobodas++;
            }
        }
        assert.deepEqual(generateDistrictNames(seed, [...contexts].reverse().map(d => ({...d, kind}))), names);
    }
    assert.ok(fishingSlobodas > 0);
});

test('water adjacency includes segment interiors and hole boundaries instead of just vertices', () => {
    const rectangle = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    const coastGeometry = {
        water: rectangle(10, 20, 20, 20), rivers: [], experimental: {
            districts: [
                {id: 'shore', type: 'regular', polygon: rectangle(0, 0, 40, 20)},
                {id: 'inland', type: 'regular', polygon: rectangle(0, -30, 40, 20)}
            ], specialBuildings: []
        }
    };
    assert.deepEqual(districtNameContexts(coastGeometry).map(d => d.coast), [true, false]);
    const riverGeometry = {
        water: [], rivers: [[[20, -10], [20, 30]]], riverWidths: [2], experimental: {
            districts: [
                {id: 'crossed', type: 'regular', polygon: rectangle(0, 0, 40, 20)},
                {id: 'away', type: 'regular', polygon: rectangle(50, 0, 40, 20)}
            ], specialBuildings: []
        }
    };
    assert.deepEqual(districtNameContexts(riverGeometry).map(d => d.river), [true, false]);
    const hole = rectangle(10, 10, 20, 20), outer = rectangle(0, 0, 100, 100);
    const holeGeometry = {
        water: hole,
        rivers: [],
        experimental: {
            districts: [{id: 'hole', type: 'regular', polygon: outer, rings: [outer, hole]}],
            specialBuildings: []
        }
    };
    assert.equal(districtNameContexts(holeGeometry)[0].coast, true);
});

test('district geography uses its boundary rather than city-wide water flags', () => {
    const rectangle = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    const geometry = {
        water: rectangle(0, -20, 100, 20), rivers: [[[0, 50], [100, 50]]], riverWidths: [4], experimental: {
            districts: [{id: 0, type: 'regular', polygon: rectangle(10, 0, 20, 10)},
                {id: 1, type: 'regular', polygon: rectangle(10, 40, 20, 10)},
                {id: 2, type: 'regular', polygon: rectangle(10, 15, 20, 10)},
                {id: 3, type: 'regular', polygon: rectangle(40, 15, 20, 10)}],
            specialBuildings: [{kind: 'temple', polygon: rectangle(45, 18, 5, 5)}]
        }
    };
    assert.deepEqual(districtNameContexts(geometry), [
        {
            id: '0',
            kind: 'regular',
            coast: true,
            river: false,
            landEdge: false,
            directions: ['south', 'west'],
            proximity: 'far'
        },
        {
            id: '1',
            kind: 'regular',
            coast: false,
            river: true,
            landEdge: false,
            directions: ['north', 'west'],
            proximity: 'far'
        },
        {id: '2', kind: 'regular', coast: false, river: false, landEdge: false, directions: ['west'], proximity: null},
        {id: '3', kind: 'temple', coast: false, river: false, landEdge: false, directions: ['east'], proximity: null}
    ]);
});

test('directional names follow district positions across waterfront and compound name templates', () => {
    const rectangle = (x, y) => [[x - 5, y - 5], [x + 5, y - 5], [x + 5, y + 5], [x - 5, y + 5]];
    const regions = [
        {id: 'north', type: 'regular', polygon: rectangle(0, 90)},
        {id: 'south', type: 'regular', polygon: rectangle(0, -90)},
        {id: 'east', type: 'regular', polygon: rectangle(90, 0)},
        {id: 'west', type: 'regular', polygon: rectangle(-90, 0)},
        {id: 'center', type: 'regular', polygon: rectangle(0, 0)},
        {id: 'northeast', type: 'regular', polygon: rectangle(90, 90)}
    ];
    const geometry = {water: [], rivers: [], experimental: {districts: regions, specialBuildings: []}};
    const contexts = districtNameContexts(geometry);
    assert.deepEqual(contexts.map(d => d.directions), [['north'], ['south'], ['east'], ['west'], [], ['north', 'east']]);
    const stems = {north: /север/i, south: /южн/i, east: /восточ/i, west: /запад/i};
    const seen = new Set();
    for (let seed = 1; seed <= 250; seed++) for (const kind of ['regular', 'castle', 'park', 'market']) {
        const districts = contexts.map(d => ({...d, kind, coast: kind === 'regular'}));
        for (const generate of [generateDistrictNames, generateCastleNames]) {
            const names = generate(seed, districts);
            for (const d of districts) {
                assert.doesNotMatch(names[d.id], /высок|низк/i);
                if (/верхн/i.test(names[d.id])) assert.ok(d.directions.includes('north'));
                if (/нижн/i.test(names[d.id])) assert.ok(d.directions.includes('south'));
                if (/ближн/i.test(names[d.id])) assert.equal(d.proximity, 'near');
                if (/дальн/i.test(names[d.id])) assert.equal(d.proximity, 'far');
                for (const [direction, stem] of Object.entries(stems)) if (stem.test(names[d.id])) {
                    assert.ok(d.directions.includes(direction), `${d.id}: ${names[d.id]}`);
                    seen.add(direction);
                }
            }
            assert.deepEqual(generate(seed, [...districts].reverse()), names);
        }
    }
    assert.deepEqual([...seen].sort(), Object.keys(stems).sort());
});

test('upper, lower, near and far names are available only where their geometry permits', () => {
    const box = (x, y) => [[x - 1, y - 1], [x + 1, y - 1], [x + 1, y + 1], [x - 1, y + 1]];
    const geometry = {
        water: [],
        rivers: [],
        cells: [{urban: true, polygon: [[-1000, -100], [1000, -100], [1000, 100], [-1000, 100]]}],
        experimental: {
            districts: [{id: 'upper', type: 'regular', polygon: box(0, 80)},
                {id: 'lower', type: 'regular', polygon: box(0, -80)},
                {id: 'near', type: 'regular', polygon: box(100, 0)},
                {id: 'middle', type: 'regular', polygon: box(500, 0)},
                {id: 'far', type: 'regular', polygon: box(800, 0)}], specialBuildings: []
        }
    };
    const contexts = districtNameContexts(geometry);
    assert.deepEqual(contexts.map(d => d.proximity), ['far', 'far', 'near', null, 'far']);
    const seen = new Set();
    for (let seed = 1; seed <= 1000; seed++) for (const kind of ['regular', 'castle']) {
        const names = generateDistrictNames(seed, contexts.map(d => ({...d, kind})));
        for (const d of contexts) {
            const name = names[d.id];
            if (/верхн/i.test(name)) {
                assert.equal(d.id, 'upper');
                seen.add('upper');
            }
            if (/нижн/i.test(name)) {
                assert.equal(d.id, 'lower');
                seen.add('lower');
            }
            if (/ближн/i.test(name)) {
                assert.equal(d.id, 'near');
                seen.add('near');
            }
            if (/дальн/i.test(name)) {
                assert.equal(d.proximity, 'far');
                seen.add('far');
            }
        }
    }
    assert.deepEqual([...seen].sort(), ['far', 'lower', 'near', 'upper']);
    const moved = structuredClone(geometry);
    for (const cell of moved.cells) cell.polygon = cell.polygon.map(([x, y]) => [x * 3 + 700, y * 3 - 900]);
    for (const d of moved.experimental.districts) d.polygon = d.polygon.map(([x, y]) => [x * 3 + 700, y * 3 - 900]);
    assert.deepEqual(districtNameContexts(moved), contexts);
});

test('spatial modifiers always precede a noun, including bare adjective results from Perchance', () => {
    const districts = [
        {id: 'upper', kind: 'regular', coast: false, river: false, directions: ['north'], proximity: 'far'},
        {id: 'lower', kind: 'regular', coast: false, river: false, directions: ['south'], proximity: 'near'}
    ];
    assert.equal(generateDistrictNames(16, districts).lower, 'Нижняя слобода');
    const seen = new Set();
    for (let seed = 1; seed <= 1200; seed++) for (const kind of ['regular', 'castle']) {
        const names = generateDistrictNames(seed, districts.map(d => ({...d, kind})));
        assert.equal(new Set(Object.values(names)).size, districts.length);
        for (const [id, name] of Object.entries(names)) {
            const modifier = name.match(/^(верхн|нижн|ближн|дальн)(?:ий|яя|ее|ие)(?=\s|$)/i);
            if (!modifier) continue;
            assert.match(name, /^(?:верхн|нижн|ближн|дальн)(?:ий|яя|ее|ие)\s+\p{L}+/iu);
            seen.add(modifier[1].toLowerCase());
            if (/^Верхн/i.test(name)) assert.equal(id, 'upper');
            if (/^Нижн/i.test(name)) assert.equal(id, 'lower');
            if (/^Ближн/i.test(name)) assert.equal(id, 'lower');
            if (/^Дальн/i.test(name)) assert.equal(id, 'upper');
        }
    }
    assert.deepEqual([...seen].sort(), ['ближн', 'верхн', 'дальн', 'нижн']);
});

test('real map labels agree with screen coordinates including the north/south Y inversion', () => {
    const directions = {north: /север/i, south: /южн/i, east: /восточ/i, west: /запад/i};
    for (const terrain of terrainKinds) for (const urban_castle of [false, true]) {
        const city = generateCity({seed: '1931200012', size: 34, ...terrain, urban_castle});
        const contexts = districtNameContexts(city.generatedGeometry);
        if (terrain.coast && terrain.river && !urban_castle) {
            const reported = city.districts.find(d => d.id === '5-1');
            assert.ok(centroid(reported.polygon)[1] > city.center[1]);
            assert.doesNotMatch(reported.name, /север/i);
        }
        for (const d of city.districts) {
            const context = contexts.find(c => c.id === d.id);
            for (const [direction, stem] of Object.entries(directions)) if (stem.test(d.name)) {
                assert.ok(context.directions.includes(direction), `${d.id}: ${d.name}`);
                const center = centroid(d.polygon);
                if (direction === 'north') assert.ok(center[1] < city.center[1]);
                if (direction === 'south') assert.ok(center[1] > city.center[1]);
                if (direction === 'east') assert.ok(center[0] > city.center[0]);
                if (direction === 'west') assert.ok(center[0] < city.center[0]);
            }
        }
    }
});

test('generated names reach the map and survive project round trips without changing geometry', () => {
    for (const terrain of terrainKinds) {
        const city = generateCity({seed: '1931200012', size: 16, ...terrain});
        assert.equal(city.name, generateCityName(city.options.seed, city.options));
        assert.equal(new Set(city.districts.map(d => d.name)).size, city.districts.length);
        const svg = renderMap(city, {}, {interactive: true});
        assert.ok(svg.includes(city.name));
        for (const d of city.districts.filter(d => d.castleCell === undefined)) assert.ok(svg.includes(d.name));
        assert.equal(LAYERS.labels, 'Подписи');
        const renamed = cityFromGeometry(city.generatedGeometry, city.options, {name: 'Имя из ссылки'});
        assert.equal(renamed.name, 'Имя из ссылки');
        assert.deepEqual(renamed.generatedGeometry, city.generatedGeometry);
        city.name = 'Ручное имя';
        city.districts[0].name = 'Район мастеров';
        const restored = parseProject(serializeProject(city, {})).city;
        assert.equal(restored.name, city.name);
        assert.deepEqual(restored.districts.map(d => d.name), city.districts.map(d => d.name));
        assert.deepEqual(restored.generatedGeometry, city.generatedGeometry);
    }
});

test('fortress names belong to castle objects and their own map labels, including saved projects', () => {
    for (const urban_castle of [false, true]) for (const terrain of terrainKinds) {
        const city = generateCity({seed: '1931200012', size: 34, urban_castle, ...terrain});
        assert.ok(city.castle?.name);
        assert.ok(city.special.includes(city.castle));
        assert.ok(city.districts.every(d => d.name !== city.castle.name));
        const svg = renderMap(city, {});
        assert.ok(svg.includes(`<title>${city.castle.name}</title>`));
        assert.match(svg, /data-label-landmark="castle"/);
        assert.ok(svg.includes(`aria-label="${city.castle.name}"`));
        assert.doesNotMatch(renderMap(city, {layers: {castle: false}}), /data-label-landmark="castle"/);
        assert.doesNotMatch(renderMap(city, {labels: false}), /data-label-landmark="castle"/);
        const restored = parseProject(serializeProject(city, {})).city;
        assert.equal(restored.castle.name, city.castle.name);
        assert.deepEqual(restored.generatedGeometry, city.generatedGeometry);
    }
    const city = generateCity({seed: '1931200012', size: 16, citadel: false});
    assert.equal(city.castle, null);
    assert.doesNotMatch(renderMap(city, {}), /data-label-landmark="castle"/);
});

test('old project placeholders are replaced without rebuilding its saved geometry', () => {
    const city = generateCity({seed: '1931200012', size: 16, coast: false, river: false});
    const project = JSON.parse(serializeProject(city, {}));
    delete project.namesVersion;
    const [first, second] = city.districts.filter(d => d.castleCell === undefined);
    project.name = `Город ${city.options.seed}`;
    project.districtNames[first.id] = 'Квартал 1';
    project.districtNames[second.id] = 'Сохранённый район';
    const restored = parseProject(JSON.stringify(project)).city;
    assert.equal(restored.name, city.name);
    assert.equal(restored.districts.find(d => d.id === first.id).name, first.name);
    assert.equal(restored.districts.find(d => d.id === second.id).name, 'Сохранённый район');
    assert.deepEqual(restored.generatedGeometry, city.generatedGeometry);
});
