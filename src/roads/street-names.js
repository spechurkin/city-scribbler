import {hashSeed} from '../core/random.js';
import {groupStreets} from './street-groups.js';

const subjects = ['Кузнецов', 'Гончаров', 'Ткачей', 'Пекарей', 'Сапожников', 'Плотников', 'Каменщиков', 'Садоводов', 'Рыбаков', 'Охотников', 'Купцов', 'Мельников', 'Красильщиков', 'Ювелиров', 'Стекольщиков', 'Бондарей', 'Фонарей', 'Колодцев', 'Ворот', 'Башен', 'Садов', 'Мостов', 'Вязов', 'Лип', 'Дубов', 'Ив', 'Клёнов', 'Сосен', 'Ясеней', 'Роз', 'Лилий', 'Ирисов'];
const named = new WeakMap();

export function ensureStreetNames(city) {
    if (named.get(city) === city.streets) return;
    groupStreets(city.streets);
    const names = new Map(), counters = new Map(),
        used = new Set(city.streets.map(r => r.name).filter(n => typeof n === 'string' && n));
    for (const road of city.streets) if (typeof road.name === 'string' && road.name && !names.has(road.streetId)) names.set(road.streetId, road.name);
    for (const road of city.streets) {
        const id = road.streetId;
        if (!names.has(id)) {
            const hash = hashSeed(`${city.options?.seed}:street:${id}`);
            const subject = subjects[hash % subjects.length];
            let number = counters.get(subject) || 1, name;
            do {
                name = number === 1 ? `Улица ${subject}` : `${number}-я улица ${subject}`;
                number++;
            } while (used.has(name));
            counters.set(subject, number);
            names.set(id, name);
            used.add(name);
        }
        road.name = names.get(id);
    }
    named.set(city, city.streets);
}

export function renameStreet(city, id, name) {
    ensureStreetNames(city);
    const group = city.streets.find(r => r.streetId === id || String(r.id) === id)?.streetId;
    const value = name.trim().slice(0, 80);
    if (value) for (const road of city.streets) if (road.streetId === group) road.name = value;
}

export function restoreStreetNames(city, names) {
    for (const road of city.streets) if (typeof names?.[road.id] === 'string') road.name = names[road.id].slice(0, 80);
    ensureStreetNames(city);
}
