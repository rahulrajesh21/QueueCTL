

export function calculateBackoff(attempts,base = 2){
    return Math.pow(base,attempts)*1000;
}


export function calculateNextRetry(attempts,base=2){
    const delay = calculateBackoff(attempts,base);
    return Date.now() + delay;
}