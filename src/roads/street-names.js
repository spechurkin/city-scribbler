import {hashSeed} from '../core/random.js';
import {groupStreets} from './street-groups.js';
import {streetNamePool} from './street-name-pool.js';

const named = new WeakMap();

export function ensureStreetNames(city) {
    if (named.get(city) === city.streets) return;
    groupStreets(city.streets);
    const names = new Map(), counters = new Map(),
        used = new Set(city.streets.map(r => r.name).filter(n => typeof n === 'string' && n));
    const available = new Set(streetNamePool.filter(name => !used.has(name)));
    for (const road of city.streets) if (typeof road.name === 'string' && road.name && !names.has(road.streetId)) names.set(road.streetId, road.name);
    for (const road of city.streets) {
        const id = road.streetId;
        if (!names.has(id)) {
            const hash = hashSeed(`${city.options?.seed}:street:${id}`);
            let index = hash % streetNamePool.length, name;
            if (available.size) {
                while (!available.has(streetNamePool[index])) index = (index + 1) % streetNamePool.length;
                name = streetNamePool[index];
                available.delete(name);
            } else {
                const base = streetNamePool[index];
                let number = counters.get(base) || 2;
                do {
                    name = `${number}-я ${base[0].toLowerCase()}${base.slice(1)}`;
                    number++;
                } while (used.has(name));
                counters.set(base, number);
            }
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
