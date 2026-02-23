class StateManager {
    constructor() {
        this.states = new Map();
    }

    set(userId, state) {
        this.states.set(userId, state);
    }

    get(userId) {
        return this.states.get(userId) || null;
    }

    clear(userId) {
        this.states.delete(userId);
    }
}

module.exports = new StateManager();