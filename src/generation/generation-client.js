export function generateCityInWorker(options, onProgress = () => {
}, {fallback, startupTimeout = 5000} = {}) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./generation-worker.js', import.meta.url), {type: 'module'});
        const timer = setTimeout(() => {
            worker.terminate();
            try {
                if (fallback) resolve(fallback(options));
                else reject(new Error('Не удалось запустить генератор.'));
            } catch (error) {
                reject(error);
            }
        }, startupTimeout);
        const finish = (callback, value) => {
            clearTimeout(timer);
            worker.terminate();
            callback(value);
        };
        worker.onmessage = ({data}) => {
            if (data.phase) {
                clearTimeout(timer);
                onProgress(data.phase);
            } else if (data.error) finish(reject, new Error(data.error));
            else finish(resolve, data.city);
        };
        worker.onerror = event => finish(reject, new Error(event.message || 'Не удалось запустить генератор.'));
        worker.onmessageerror = () => finish(reject, new Error('Не удалось получить построенный город.'));
        worker.postMessage(options);
    });
}
