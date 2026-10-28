import {generateCity} from './interactive-city.js';

self.onmessage = ({data: options}) => {
    try {
        self.postMessage({phase: 'generating'});
        self.postMessage({city: generateCity(options)});
    } catch (error) {
        self.postMessage({error: error.message});
    }
};
