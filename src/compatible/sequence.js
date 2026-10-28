const MODULUS = 2147483647;
const MULTIPLIER = 48271;

export class Sequence {
    constructor(seed) {
        const value = Number(seed);
        if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Совместимый сид должен быть положительным безопасным целым числом.');
        this.state = value;
        this.draws = 0;
    }

    next() {
        this.state = Math.trunc((this.state * MULTIPLIER) % MODULUS);
        this.draws++;
        return this.state / MODULUS;
    }

    checkpoint() {
        return {state: this.state, draws: this.draws};
    }

    restore({state, draws}) {
        this.state = state;
        this.draws = draws;
    }

    checkpointOnError(callback) {
        try {
            return callback(this);
        } catch (cause) {
            const error = cause instanceof Error ? cause : new Error(String(cause));
            error.generationCheckpoint ??= this.checkpoint();
            throw error;
        }
    }

    isolated(callback) {
        const checkpoint = this.checkpoint();
        try {
            return callback(this);
        } finally {
            this.restore(checkpoint);
        }
    }

    branch(callback) {
        const checkpoint = this.checkpoint(), value = callback(this);
        this.restore(checkpoint);
        return value;
    }
}
