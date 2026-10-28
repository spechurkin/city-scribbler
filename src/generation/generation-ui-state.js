import {DEFAULT_OPTIONS} from './interactive-city.js';

export function generationUiState(city, {busy = false} = {}) {
    const imported = city?.source?.format === 'mfcg';
    const knownSeed = imported && /^\d+$/.test(String(city.options.seed)) && Number.isSafeInteger(Number(city.options.seed)) && Number(city.options.seed) > 0;
    const options = imported ? {
        ...DEFAULT_OPTIONS, ...Object.fromEntries(Object.entries(city.options).filter(([key, value]) => Object.hasOwn(DEFAULT_OPTIONS, key) && value !== null && value !== undefined)),
        seed: knownSeed ? String(city.options.seed) : ''
    } : city?.options || DEFAULT_OPTIONS;
    return {
        options, imported, seedReadOnly: false, buildDisabled: busy, randomDisabled: busy,
        buildLabel: busy ? 'Строим город…' : imported ? 'Построить новую карту' : 'Построить по сиду',
        seedPlaceholder: imported ? 'Сид или ссылка для новой карты' : '',
        seedHint: imported ? (knownSeed ? 'Сид указан в проекте. Построение создаст новую карту своим движком.' : 'В JSON нет исходного сида. Введите сид или ссылку MFCG для новой карты. Импорт можно сохранить как проект.') : 'Полная ссылка переносит размер и параметры города.',
        draftHint: imported ? 'Открыта геометрия из файла. Настройки ниже относятся к новой генерации.' : city?.generationWarnings?.length ? city.generationWarnings.join(' ') : 'Настройки применены к карте.'
    };
}
