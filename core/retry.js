

export function calculateBackoff(attempts, base = 2){
    return Math.pow(base, attempts) * 1000;
}

export function calculateNextRetry(attempts, base = 2, fromTime = Date.now()){
    const delay = calculateBackoff(attempts, base);
    return fromTime + delay;
}