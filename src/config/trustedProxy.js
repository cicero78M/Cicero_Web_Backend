// Production nginx forwards requests to the application over the loopback interface.
// Do not use a hop count here: the application port may also be reachable directly,
// and a hop-count policy would trust forwarding headers supplied by that client.
export const trustedProxy = ['loopback'];
